import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { DiscoveryClientService } from "../services/discovery-client.service.js";
import { FriendClientService } from "../services/friend-client.service.js";

const DROP_IN_EVENT_TYPES = [
  "participant_joined",
  "participant_joined_via_pull_stranger",
  "participant_joined_via_waitlist"
] as const;

export type CallType = "Squad" | "Broadcast";
export type UserStatus = "SQUAD" | "BROADCAST" | "DROP_IN";

export interface HistoryParticipant {
  userId: string;
  username: string | null;
  displayPictureUrl: string | null;
  role: "HOST" | "PARTICIPANT";
  userStatus: UserStatus;
  location: string | null;
  durationSeconds: number;
  videoOn: boolean | null;
  isFriend: boolean;
  conversationId: string | null;
  messageCost: number | null;
}

export interface HistoryCall {
  sessionId: string;
  roomId: string;
  startedAt: string | null;
  endedAt: string | null;
  callType: CallType;
  participants: HistoryParticipant[];
}

export interface GetCallHistoryResult {
  calls: HistoryCall[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface HistoryTimelineItem {
  at: string;
  eventType: string;
  title: string;
  description: string;
  userId: string | null;
  username: string | null;
  displayPictureUrl: string | null;
  metadata: Record<string, unknown> | null;
}

export interface HistoryTimelineCall extends HistoryCall {
  timeline: HistoryTimelineItem[];
}

function safeParseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function toEventPresentation(eventType: string): { title: string; description: string } {
  const map: Record<string, { title: string; description: string }> = {
    room_created: { title: "Call started", description: "Room was created" },
    participant_joined: { title: "Participant joined", description: "A participant joined the call" },
    participant_left: { title: "Participant left", description: "A participant left the call" },
    participant_kicked: { title: "Participant removed", description: "A participant was removed from the call" },
    broadcast_started: { title: "Broadcast started", description: "Broadcasting was started in this room" },
    broadcast_stopped: { title: "Broadcast stopped", description: "Broadcasting was stopped in this room" },
    pull_stranger_enabled: { title: "Pull stranger enabled", description: "Host enabled pull-stranger mode" },
    pull_stranger_expired: { title: "Pull stranger expired", description: "Pull-stranger window expired" },
    participant_joined_via_pull_stranger: { title: "Stranger pulled in", description: "A stranger joined via pull-stranger" },
    waitlist_requested: { title: "Join requested", description: "A viewer requested to join" },
    waitlist_cancelled: { title: "Join request cancelled", description: "A viewer cancelled their join request" },
    participant_joined_via_waitlist: { title: "Viewer joined from waitlist", description: "A viewer joined from the waitlist" },
    call_ended: { title: "Call ended", description: "Room was ended" }
  };
  return map[eventType] ?? { title: eventType.replaceAll("_", " "), description: "Room event" };
}

@Injectable()
export class HistoryService {
  private readonly maxHistoryPerUser = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly discoveryClient: DiscoveryClientService,
    private readonly friendClient: FriendClientService
  ) {}

  private async enforcePerUserHistoryRetention(userId: string): Promise<void> {
    const oldSessions = await this.prisma.callSession.findMany({
      where: {
        status: "ENDED",
        startedAt: { not: null },
        participants: { some: { userId } }
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      skip: this.maxHistoryPerUser,
      select: { id: true }
    });

    if (oldSessions.length === 0) return;

    await this.prisma.userHiddenCallHistory.createMany({
      data: oldSessions.map((s) => ({ userId, sessionId: s.id })),
      skipDuplicates: true
    });
  }

  async getCallHistory(
    userId: string,
    limit: number,
    cursor?: string
  ): Promise<GetCallHistoryResult> {
    // Per-user retention: only last N calls should remain visible in history.
    // Older calls are hidden for this user only (not globally deleted).
    await this.enforcePerUserHistoryRetention(userId);

    const hidden = await this.prisma.userHiddenCallHistory.findMany({
      where: { userId },
      select: { sessionId: true }
    });
    const hiddenSessionIds = hidden.map((h) => h.sessionId);

    const where: {
      status: "ENDED";
      startedAt: { not: null };
      participants: { some: { userId: string } };
      id?: { notIn: string[] };
      OR?: Array<
        | { startedAt: { lt: Date } }
        | { startedAt: Date; id: { lt: string } }
      >;
    } = {
      status: "ENDED",
      startedAt: { not: null },
      participants: { some: { userId } }
    };
    if (hiddenSessionIds.length > 0) {
      where.id = { notIn: hiddenSessionIds };
    }

    let cursorStartedAt: Date | null = null;
    let cursorId: string | null = null;
    if (cursor && typeof cursor === "string" && cursor.length > 0) {
      const parts = cursor.split("_");
      if (parts.length >= 2) {
        const d = new Date(parts[0]);
        if (!Number.isNaN(d.getTime())) {
          cursorStartedAt = d;
          cursorId = parts.slice(1).join("_");
        }
      }
    }
    if (cursorStartedAt && cursorId) {
      where.OR = [
        { startedAt: { lt: cursorStartedAt } },
        { startedAt: cursorStartedAt, id: { lt: cursorId } }
      ];
    }

    const sessions = await this.prisma.callSession.findMany({
      where,
      include: {
        participants: {
          select: {
            userId: true,
            role: true,
            joinedAt: true,
            leftAt: true
          }
        },
        events: {
          where: {
            OR: [
              { eventType: { in: [...DROP_IN_EVENT_TYPES] }, userId: { not: null } },
              { eventType: "broadcast_started" }
            ]
          },
          select: { userId: true, eventType: true }
        }
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit + 1
    });

    const slice = sessions.slice(0, limit);

    const participantUserIds = new Set<string>();
    slice.forEach((s) => s.participants.forEach((p) => participantUserIds.add(p.userId)));
    const otherUserIds = [...participantUserIds].filter((id) => id !== userId);

    type RelMap = Record<
      string,
      { isFriend: boolean; conversationId: string; messageCost: number }
    >;
    const [profiles, relationships] = await Promise.all([
      this.discoveryClient.getUserProfilesBatch([...participantUserIds]),
      (otherUserIds.length > 0
        ? this.friendClient.getRelationshipsBatch(userId, otherUserIds)
        : Promise.resolve({}) as Promise<RelMap>)
    ]);

    const dropInBySession = new Map<string, Set<string>>();
    slice.forEach((s) => {
      const set = new Set<string>();
      s.events.forEach((e) => {
        if (e.userId && DROP_IN_EVENT_TYPES.includes(e.eventType as (typeof DROP_IN_EVENT_TYPES)[number])) {
          set.add(e.userId);
        }
      });
      dropInBySession.set(s.id, set);
    });

    const calls: HistoryCall[] = slice.map((session) => {
      const hasBroadcastStarted = session.events.some((e) => e.eventType === "broadcast_started");
      const callType: CallType = session.isBroadcasting || hasBroadcastStarted ? "Broadcast" : "Squad";
      const endedAt = session.endedAt ?? null;
      const dropIns = dropInBySession.get(session.id) ?? new Set<string>();

      const participants: HistoryParticipant[] = session.participants.map((p) => {
        const profile = profiles.get(p.userId);
        const rel = p.userId === userId ? null : relationships[p.userId];
        const isDropIn = dropIns.has(p.userId);
        let userStatus: UserStatus;
        if (isDropIn) {
          userStatus = "DROP_IN";
        } else if (p.role === "HOST") {
          userStatus = callType === "Broadcast" ? "BROADCAST" : "SQUAD";
        } else {
          userStatus = callType === "Broadcast" ? "BROADCAST" : "SQUAD";
        }
        const end = p.leftAt ?? endedAt;
        const durationSeconds = end
          ? Math.max(0, Math.floor((new Date(end).getTime() - new Date(p.joinedAt).getTime()) / 1000))
          : 0;

        return {
          userId: p.userId,
          username: profile?.username ?? null,
          displayPictureUrl: profile?.displayPictureUrl ?? null,
          role: p.role,
          userStatus,
          location: profile?.preferredCity ?? null,
          durationSeconds,
          videoOn: null,
          isFriend: rel?.isFriend ?? false,
          conversationId: rel?.conversationId ?? null,
          messageCost: rel != null ? rel.messageCost : null
        };
      });

      return {
        sessionId: session.id,
        roomId: session.roomId,
        startedAt: session.startedAt?.toISOString() ?? null,
        endedAt: endedAt?.toISOString() ?? null,
        callType,
        participants
      };
    });

    const hasMore = sessions.length > limit;
    const last = slice[slice.length - 1];
    const nextCursor =
      hasMore && last?.startedAt != null
        ? `${(last.startedAt as Date).toISOString()}_${last.id}`
        : undefined;
    const hasMoreSafe = !!nextCursor;

    return {
      calls,
      nextCursor,
      hasMore: hasMoreSafe
    };
  }

  async getCallById(userId: string, sessionId: string): Promise<HistoryCall | null> {
    const hidden = await this.prisma.userHiddenCallHistory.findUnique({
      where: { userId_sessionId: { userId, sessionId } }
    });
    if (hidden) {
      return null;
    }

    const session = await this.prisma.callSession.findFirst({
      where: {
        id: sessionId,
        status: "ENDED",
        participants: { some: { userId } }
      },
      include: {
        participants: {
          select: {
            userId: true,
            role: true,
            joinedAt: true,
            leftAt: true
          }
        },
        events: {
          where: {
            OR: [
              { eventType: { in: [...DROP_IN_EVENT_TYPES] }, userId: { not: null } },
              { eventType: "broadcast_started" }
            ]
          },
          select: { userId: true, eventType: true }
        }
      }
    });

    if (!session) {
      return null;
    }

    const participantUserIds = session.participants.map((p) => p.userId);
    const otherUserIds = participantUserIds.filter((id) => id !== userId);

    type RelMap = Record<
      string,
      { isFriend: boolean; conversationId: string; messageCost: number }
    >;
    const [profiles, relationships] = await Promise.all([
      this.discoveryClient.getUserProfilesBatch(participantUserIds),
      (otherUserIds.length > 0
        ? this.friendClient.getRelationshipsBatch(userId, otherUserIds)
        : (Promise.resolve({}) as Promise<RelMap>))
    ]);

    const dropIns = new Set<string>();
    session.events.forEach((e) => {
      if (e.userId && DROP_IN_EVENT_TYPES.includes(e.eventType as (typeof DROP_IN_EVENT_TYPES)[number])) {
        dropIns.add(e.userId);
      }
    });

    const hasBroadcastStarted = session.events.some((e) => e.eventType === "broadcast_started");
    const callType: CallType = session.isBroadcasting || hasBroadcastStarted ? "Broadcast" : "Squad";
    const endedAt = session.endedAt ?? null;

    const participants: HistoryParticipant[] = session.participants.map((p) => {
      const profile = profiles.get(p.userId);
      const rel = p.userId === userId ? null : relationships[p.userId];
      const isDropIn = dropIns.has(p.userId);
      let userStatus: UserStatus;
      if (isDropIn) {
        userStatus = "DROP_IN";
      } else if (p.role === "HOST") {
        userStatus = callType === "Broadcast" ? "BROADCAST" : "SQUAD";
      } else {
        userStatus = callType === "Broadcast" ? "BROADCAST" : "SQUAD";
      }
      const end = p.leftAt ?? endedAt;
      const durationSeconds = end
        ? Math.max(0, Math.floor((new Date(end).getTime() - new Date(p.joinedAt).getTime()) / 1000))
        : 0;

      return {
        userId: p.userId,
        username: profile?.username ?? null,
        displayPictureUrl: profile?.displayPictureUrl ?? null,
        role: p.role,
        userStatus,
        location: profile?.preferredCity ?? null,
        durationSeconds,
        videoOn: null,
        isFriend: rel?.isFriend ?? false,
        conversationId: rel?.conversationId ?? null,
        messageCost: rel != null ? rel.messageCost : null
      };
    });

    return {
      sessionId: session.id,
      roomId: session.roomId,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: endedAt?.toISOString() ?? null,
      callType,
      participants
    };
  }

  async getCallTimeline(userId: string, sessionId: string): Promise<HistoryTimelineCall | null> {
    const call = await this.getCallById(userId, sessionId);
    if (!call) return null;

    const session = await this.prisma.callSession.findFirst({
      where: {
        id: sessionId,
        status: "ENDED",
        participants: { some: { userId } }
      },
      include: {
        events: {
          orderBy: { createdAt: "asc" },
          select: {
            eventType: true,
            userId: true,
            metadata: true,
            createdAt: true
          }
        },
        participants: {
          select: {
            userId: true,
            joinedAt: true,
            leftAt: true
          }
        }
      }
    });

    if (!session) return null;

    const participantIds = [...new Set(session.participants.map((p) => p.userId))];
    const profiles = await this.discoveryClient.getUserProfilesBatch(participantIds);

    const participantJoinLeave: HistoryTimelineItem[] = session.participants.flatMap((participant) => {
      const profile = profiles.get(participant.userId);
      const username = profile?.username ?? null;
      const displayPictureUrl = profile?.displayPictureUrl ?? null;
      const items: HistoryTimelineItem[] = [
        {
          at: participant.joinedAt.toISOString(),
          eventType: "participant_joined_time",
          title: "Participant joined",
          description: `${username || "A participant"} joined this call`,
          userId: participant.userId,
          username,
          displayPictureUrl,
          metadata: null
        }
      ];
      if (participant.leftAt) {
        const durationSeconds = Math.max(
          0,
          Math.floor((participant.leftAt.getTime() - participant.joinedAt.getTime()) / 1000)
        );
        items.push({
          at: participant.leftAt.toISOString(),
          eventType: "participant_left_time",
          title: "Participant left",
          description: `${username || "A participant"} left after ${durationSeconds}s`,
          userId: participant.userId,
          username,
          displayPictureUrl,
          metadata: { durationSeconds }
        });
      }
      return items;
    });

    const eventTimeline: HistoryTimelineItem[] = session.events.map((event) => {
      const profile = event.userId ? profiles.get(event.userId) : null;
      const presentation = toEventPresentation(event.eventType);
      return {
        at: event.createdAt.toISOString(),
        eventType: event.eventType,
        title: presentation.title,
        description: presentation.description,
        userId: event.userId,
        username: profile?.username ?? null,
        displayPictureUrl: profile?.displayPictureUrl ?? null,
        metadata: safeParseMetadata(event.metadata)
      };
    });

    const timeline = [...eventTimeline, ...participantJoinLeave].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
    );

    return {
      ...call,
      timeline
    };
  }

  async hideFromHistory(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.callSession.findFirst({
      where: {
        id: sessionId,
        status: "ENDED",
        participants: { some: { userId } }
      }
    });
    if (!session) {
      throw new NotFoundException(`Call ${sessionId} not found or you did not participate`);
    }

    await this.prisma.userHiddenCallHistory.upsert({
      where: {
        userId_sessionId: { userId, sessionId }
      },
      create: { userId, sessionId },
      update: {}
    });
  }
}

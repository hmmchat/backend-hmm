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

@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discoveryClient: DiscoveryClientService,
    private readonly friendClient: FriendClientService
  ) {}

  async getCallHistory(
    userId: string,
    limit: number,
    cursor?: string
  ): Promise<GetCallHistoryResult> {
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
            eventType: { in: [...DROP_IN_EVENT_TYPES] },
            userId: { not: null }
          },
          select: { userId: true }
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
        if (e.userId) set.add(e.userId);
      });
      dropInBySession.set(s.id, set);
    });

    const calls: HistoryCall[] = slice.map((session) => {
      const callType: CallType = session.isBroadcasting ? "Broadcast" : "Squad";
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
            eventType: { in: [...DROP_IN_EVENT_TYPES] },
            userId: { not: null }
          },
          select: { userId: true }
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
      if (e.userId) dropIns.add(e.userId);
    });

    const callType: CallType = session.isBroadcasting ? "Broadcast" : "Squad";
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

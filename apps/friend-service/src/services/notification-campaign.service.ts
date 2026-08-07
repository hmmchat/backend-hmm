import {
  BadRequestException,
  Injectable,
  Logger
} from "@nestjs/common";
import {
  ConversationSection,
  NotificationCampaignStatus,
  NotificationLine
} from "../../node_modules/.prisma/client/index.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ConversationService } from "./conversation.service.js";
import { MessagingRealtimeService } from "./messaging-realtime.service.js";
import { RedisService } from "./redis.service.js";
import { UserClientService } from "./user-client.service.js";
import {
  getLineForSystemUserId,
  getSystemUserIdForLine,
  isSystemNotificationUserId,
  systemDisplayName,
  type SystemNotificationLine
} from "../config/system-notification.js";

export type NotificationCta = {
  label: string;
  url: string;
  kind: "deep" | "external";
};

export type CreateCampaignInput = {
  line: SystemNotificationLine;
  body: string;
  title?: string | null;
  images?: string[];
  ctas?: NotificationCta[];
  rich?: Record<string, unknown> | null;
  userIds?: string[];
  createdBy?: string | null;
};

@Injectable()
export class NotificationCampaignService {
  private readonly logger = new Logger(NotificationCampaignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly userClient: UserClientService,
    private readonly realtime: MessagingRealtimeService,
    private readonly redis: RedisService
  ) {}

  private lineEnum(line: SystemNotificationLine): NotificationLine {
    return line === "BEAM" ? NotificationLine.BEAM : NotificationLine.BEAM_MOD;
  }

  private parseJsonArray(raw: string | null | undefined): any[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  campaignToNotificationMeta(campaign: {
    id: string;
    title: string | null;
    body: string;
    imagesJson: string | null;
    ctasJson: string | null;
    richJson: string | null;
    line: NotificationLine;
  }) {
    return {
      campaignId: campaign.id,
      line: campaign.line === NotificationLine.BEAM ? "BEAM" : "BEAM_MOD",
      title: campaign.title,
      body: campaign.body,
      images: this.parseJsonArray(campaign.imagesJson) as string[],
      ctas: this.parseJsonArray(campaign.ctasJson) as NotificationCta[],
      rich: this.parseJsonObject(campaign.richJson)
    };
  }

  virtualMessageFromCampaign(
    campaign: {
      id: string;
      title: string | null;
      body: string;
      imagesJson: string | null;
      ctasJson: string | null;
      richJson: string | null;
      line: NotificationLine;
      sentAt: Date | null;
      createdAt: Date;
    },
    toUserId: string,
    isRead: boolean
  ) {
    const systemUserId = getSystemUserIdForLine(
      campaign.line === NotificationLine.BEAM ? "BEAM" : "BEAM_MOD"
    );
    const meta = this.campaignToNotificationMeta(campaign);
    return {
      id: campaign.id,
      fromUserId: systemUserId,
      toUserId,
      conversationId: null as string | null,
      message: campaign.title ? `${campaign.title}\n${campaign.body}` : campaign.body,
      messageType: "SYSTEM_NOTIFICATION",
      notificationMeta: meta,
      isRead,
      readAt: null as Date | null,
      giftId: null,
      giftAmount: null,
      gif: null,
      squadMeta: null,
      createdAt: campaign.sentAt || campaign.createdAt
    };
  }

  async listCampaigns(params: {
    line?: SystemNotificationLine;
    limit?: number;
    cursor?: string;
  }) {
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const where = params.line ? { line: this.lineEnum(params.line) } : {};
    const rows = await this.prisma.notificationCampaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(params.cursor
        ? {
            cursor: { id: params.cursor },
            skip: 1
          }
        : {})
    });
    const hasMore = rows.length > limit;
    const campaigns = hasMore ? rows.slice(0, limit) : rows;

    const withCounts = await Promise.all(
      campaigns.map(async (c) => {
        const recipientCount =
          c.line === NotificationLine.BEAM_MOD
            ? await this.prisma.notificationCampaignRecipient.count({
                where: { campaignId: c.id }
              })
            : null;
        return {
          id: c.id,
          line: c.line === NotificationLine.BEAM ? "BEAM" : "BEAM_MOD",
          status: c.status,
          title: c.title,
          body: c.body,
          images: this.parseJsonArray(c.imagesJson),
          ctas: this.parseJsonArray(c.ctasJson),
          rich: this.parseJsonObject(c.richJson),
          audienceRegisteredBefore: c.audienceRegisteredBefore,
          sentAt: c.sentAt,
          recalledAt: c.recalledAt,
          createdBy: c.createdBy,
          createdAt: c.createdAt,
          recipientCount
        };
      })
    );

    return {
      campaigns: withCounts,
      nextCursor: hasMore ? campaigns[campaigns.length - 1].id : undefined,
      hasMore
    };
  }

  async createAndSend(input: CreateCampaignInput) {
    const body = (input.body || "").trim();
    if (!body) {
      throw new BadRequestException("body is required");
    }
    if (body.length > 10000) {
      throw new BadRequestException("body too long");
    }

    const line = input.line;
    const images = (input.images || []).filter((u) => typeof u === "string" && u.length > 0).slice(0, 10);
    const ctas = (input.ctas || [])
      .filter((c) => c && typeof c.label === "string" && typeof c.url === "string")
      .map((c) => ({
        label: c.label.trim().slice(0, 80),
        url: c.url.trim().slice(0, 2048),
        kind: c.kind === "deep" ? ("deep" as const) : ("external" as const)
      }))
      .slice(0, 5);

    if (line === "BEAM") {
      if (input.userIds && input.userIds.length > 0) {
        throw new BadRequestException("BEAM campaigns target all users only");
      }
      return this.sendBeamCampaign({
        body,
        title: input.title?.trim() || null,
        images,
        ctas,
        rich: input.rich || null,
        createdBy: input.createdBy || null
      });
    }

    const rawIds = [...new Set((input.userIds || []).map((id) => String(id).trim()).filter(Boolean))];
    if (rawIds.length === 0) {
      throw new BadRequestException("BEAM MOD requires at least one userId");
    }
    if (rawIds.length > 5000) {
      throw new BadRequestException("BEAM MOD supports at most 5000 userIds per send");
    }

    const validated = await this.userClient.validateUserIds(rawIds);
    if (validated.validIds.length === 0) {
      throw new BadRequestException("No valid userIds found");
    }

    return this.sendBeamModCampaign({
      body,
      title: input.title?.trim() || null,
      images,
      ctas,
      rich: input.rich || null,
      userIds: validated.validIds,
      invalidUserIds: validated.invalidIds,
      createdBy: input.createdBy || null
    });
  }

  private async sendBeamCampaign(input: {
    body: string;
    title: string | null;
    images: string[];
    ctas: NotificationCta[];
    rich: Record<string, unknown> | null;
    createdBy: string | null;
  }) {
    const now = new Date();
    const campaign = await this.prisma.notificationCampaign.create({
      data: {
        line: NotificationLine.BEAM,
        status: NotificationCampaignStatus.SENT,
        body: input.body,
        title: input.title,
        imagesJson: input.images.length ? JSON.stringify(input.images) : null,
        ctasJson: input.ctas.length ? JSON.stringify(input.ctas) : null,
        richJson: input.rich ? JSON.stringify(input.rich) : null,
        audienceRegisteredBefore: now,
        sentAt: now,
        createdBy: input.createdBy
      }
    });

    // Lazy conversations — notify all currently connected users; offline discover on inbox load.
    this.realtime.emitBroadcast("friend:refresh", {
      reason: "notification_campaign_sent",
      line: "BEAM",
      campaignId: campaign.id,
      at: now.toISOString()
    });
    this.realtime.emitBroadcast("friend:campaign_sent", {
      line: "BEAM",
      campaignId: campaign.id,
      systemUserId: getSystemUserIdForLine("BEAM"),
      preview: input.title || input.body.slice(0, 120),
      at: now.toISOString()
    });

    this.logger.log(`BEAM campaign ${campaign.id} sent`);
    return {
      ok: true,
      campaign: {
        id: campaign.id,
        line: "BEAM",
        status: campaign.status,
        sentAt: campaign.sentAt,
        audienceRegisteredBefore: campaign.audienceRegisteredBefore
      }
    };
  }

  private async sendBeamModCampaign(input: {
    body: string;
    title: string | null;
    images: string[];
    ctas: NotificationCta[];
    rich: Record<string, unknown> | null;
    userIds: string[];
    invalidUserIds: string[];
    createdBy: string | null;
  }) {
    const now = new Date();
    const systemUserId = getSystemUserIdForLine("BEAM_MOD");

    const campaign = await this.prisma.notificationCampaign.create({
      data: {
        line: NotificationLine.BEAM_MOD,
        status: NotificationCampaignStatus.SENT,
        body: input.body,
        title: input.title,
        imagesJson: input.images.length ? JSON.stringify(input.images) : null,
        ctasJson: input.ctas.length ? JSON.stringify(input.ctas) : null,
        richJson: input.rich ? JSON.stringify(input.rich) : null,
        sentAt: now,
        createdBy: input.createdBy,
        recipients: {
          create: input.userIds.map((userId) => ({ userId }))
        }
      }
    });

    // Upsert conversations + update lastMessageAt for recipients (batched).
    const chunkSize = 200;
    for (let i = 0; i < input.userIds.length; i += chunkSize) {
      const chunk = input.userIds.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (userId) => {
          const { id: conversationId } = await this.conversationService.getOrCreateConversation(
            userId,
            systemUserId
          );
          await this.prisma.conversation.update({
            where: { id: conversationId },
            data: {
              section: ConversationSection.INBOX,
              lastMessageId: campaign.id,
              lastMessageAt: now
            }
          });
          await this.invalidateNotificationCache(userId);
          const virtual = this.virtualMessageFromCampaign(campaign, userId, false);
          virtual.conversationId = conversationId;
          this.realtime.emitToUser(userId, "friend:message", {
            ...virtual,
            unreadCountForConversation: await this.countUnreadForLine(userId, "BEAM_MOD")
          });
          this.realtime.emitToUser(userId, "friend:refresh", {
            reason: "notification_campaign_sent",
            line: "BEAM_MOD",
            campaignId: campaign.id,
            at: now.toISOString()
          });
        })
      );
    }

    this.logger.log(
      `BEAM MOD campaign ${campaign.id} sent to ${input.userIds.length} users (${input.invalidUserIds.length} invalid skipped)`
    );

    return {
      ok: true,
      campaign: {
        id: campaign.id,
        line: "BEAM_MOD",
        status: campaign.status,
        sentAt: campaign.sentAt,
        recipientCount: input.userIds.length,
        invalidUserIds: input.invalidUserIds
      }
    };
  }

  async recall(params: {
    line: SystemNotificationLine;
    mode: "last" | "last_n" | "all";
    n?: number;
  }) {
    const line = this.lineEnum(params.line);
    let toRecall: { id: string }[] = [];

    if (params.mode === "all") {
      toRecall = await this.prisma.notificationCampaign.findMany({
        where: { line, status: NotificationCampaignStatus.SENT },
        select: { id: true }
      });
    } else if (params.mode === "last") {
      const last = await this.prisma.notificationCampaign.findFirst({
        where: { line, status: NotificationCampaignStatus.SENT },
        orderBy: { sentAt: "desc" },
        select: { id: true }
      });
      if (last) toRecall = [last];
    } else {
      const n = Math.min(100, Math.max(1, params.n ?? 1));
      toRecall = await this.prisma.notificationCampaign.findMany({
        where: { line, status: NotificationCampaignStatus.SENT },
        orderBy: { sentAt: "desc" },
        take: n,
        select: { id: true }
      });
    }

    if (toRecall.length === 0) {
      return { ok: true, recalledCount: 0, campaignIds: [] as string[] };
    }

    const ids = toRecall.map((c) => c.id);
    const now = new Date();
    await this.prisma.notificationCampaign.updateMany({
      where: { id: { in: ids } },
      data: {
        status: NotificationCampaignStatus.RECALLED,
        recalledAt: now
      }
    });

    // Refresh affected users
    if (params.line === "BEAM") {
      this.realtime.emitBroadcast("friend:campaign_recalled", {
        line: "BEAM",
        campaignIds: ids,
        at: now.toISOString()
      });
      this.realtime.emitBroadcast("friend:refresh", {
        reason: "notification_campaign_recalled",
        line: "BEAM",
        campaignIds: ids,
        at: now.toISOString()
      });
    } else {
      const recipients = await this.prisma.notificationCampaignRecipient.findMany({
        where: { campaignId: { in: ids } },
        select: { userId: true },
        distinct: ["userId"]
      });
      for (const { userId } of recipients) {
        await this.invalidateNotificationCache(userId);
        this.realtime.emitToUser(userId, "friend:campaign_recalled", {
          line: "BEAM_MOD",
          campaignIds: ids,
          at: now.toISOString()
        });
        this.realtime.emitToUser(userId, "friend:refresh", {
          reason: "notification_campaign_recalled",
          line: "BEAM_MOD",
          campaignIds: ids,
          at: now.toISOString()
        });
      }
    }

    this.logger.log(`Recalled ${ids.length} ${params.line} campaign(s)`);
    return { ok: true, recalledCount: ids.length, campaignIds: ids };
  }

  /**
   * Visible SENT campaigns for a user on a line.
   */
  async getVisibleCampaignsForUser(
    userId: string,
    line: SystemNotificationLine,
    userCreatedAt: Date | null
  ) {
    if (line === "BEAM") {
      if (!userCreatedAt) return [];
      return this.prisma.notificationCampaign.findMany({
        where: {
          line: NotificationLine.BEAM,
          status: NotificationCampaignStatus.SENT,
          audienceRegisteredBefore: { gte: userCreatedAt }
        },
        orderBy: { sentAt: "desc" }
      });
    }

    return this.prisma.notificationCampaign.findMany({
      where: {
        line: NotificationLine.BEAM_MOD,
        status: NotificationCampaignStatus.SENT,
        recipients: { some: { userId } }
      },
      orderBy: { sentAt: "desc" }
    });
  }

  async countUnreadForLine(userId: string, line: SystemNotificationLine): Promise<number> {
    const userCreatedAt = await this.userClient.getUserCreatedAt(userId);
    const campaigns = await this.getVisibleCampaignsForUser(userId, line, userCreatedAt);
    if (campaigns.length === 0) return 0;

    const campaignIds = campaigns.map((c) => c.id);
    const deliveries = await this.prisma.notificationCampaignDelivery.findMany({
      where: { userId, campaignId: { in: campaignIds } },
      select: { campaignId: true, readAt: true }
    });
    const readSet = new Set(deliveries.filter((d) => d.readAt).map((d) => d.campaignId));
    return campaignIds.filter((id) => !readSet.has(id)).length;
  }

  async countTotalUnread(userId: string): Promise<number> {
    const [beam, mod] = await Promise.all([
      this.countUnreadForLine(userId, "BEAM"),
      this.countUnreadForLine(userId, "BEAM_MOD")
    ]);
    return beam + mod;
  }

  async markLineAsRead(userId: string, line: SystemNotificationLine): Promise<void> {
    const userCreatedAt = await this.userClient.getUserCreatedAt(userId);
    const campaigns = await this.getVisibleCampaignsForUser(userId, line, userCreatedAt);
    if (campaigns.length === 0) return;

    const now = new Date();
    await Promise.all(
      campaigns.map((c) =>
        this.prisma.notificationCampaignDelivery.upsert({
          where: {
            campaignId_userId: { campaignId: c.id, userId }
          },
          create: {
            campaignId: c.id,
            userId,
            readAt: now
          },
          update: {
            readAt: now
          }
        })
      )
    );
    await this.invalidateNotificationCache(userId);

    const systemUserId = getSystemUserIdForLine(line);
    this.realtime.emitToUser(userId, "friend:read", {
      fromUserId: systemUserId,
      toUserId: userId,
      systemLine: line
    });
  }

  /**
   * Ensure system conversations exist for lines with visible campaigns; return inbox overlay rows.
   */
  async getInboxSystemOverlays(userId: string): Promise<any[]> {
    const userCreatedAt = await this.userClient.getUserCreatedAt(userId);
    const overlays: any[] = [];

    for (const line of ["BEAM", "BEAM_MOD"] as SystemNotificationLine[]) {
      const campaigns = await this.getVisibleCampaignsForUser(userId, line, userCreatedAt);
      if (campaigns.length === 0) continue;

      const latest = campaigns[0];
      const systemUserId = getSystemUserIdForLine(line);
      const { id: conversationId } = await this.conversationService.getOrCreateConversation(
        userId,
        systemUserId
      );

      const lastAt = latest.sentAt || latest.createdAt;
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          section: ConversationSection.INBOX,
          lastMessageId: latest.id,
          lastMessageAt: lastAt
        }
      });

      const unreadCount = await this.countUnreadForLine(userId, line);
      const deliveries = await this.prisma.notificationCampaignDelivery.findMany({
        where: { userId, campaignId: latest.id },
        select: { readAt: true }
      });
      const latestRead = Boolean(deliveries[0]?.readAt);

      overlays.push({
        id: conversationId,
        conversationId,
        otherUserId: systemUserId,
        otherUser: {
          id: systemUserId,
          username: systemDisplayName(line),
          displayPictureUrl: null
        },
        systemLine: line,
        section: ConversationSection.INBOX,
        lastMessage: {
          id: latest.id,
          fromUserId: systemUserId,
          message: latest.title ? `${latest.title}\n${latest.body}` : latest.body,
          messageType: "SYSTEM_NOTIFICATION",
          notificationMeta: this.campaignToNotificationMeta(latest),
          giftId: null,
          giftAmount: null,
          squadMeta: null,
          createdAt: lastAt,
          isRead: latestRead
        },
        unreadCount,
        isFriend: true,
        userStatus: "offline",
        isBroadcasting: false,
        broadcastRoomId: null,
        broadcastUrl: null,
        lastMessageAt: lastAt,
        createdAt: lastAt
      });
    }

    return overlays;
  }

  async getSystemThreadMessages(
    userId: string,
    otherUserId: string,
    limit: number = 50,
    cursor?: string
  ): Promise<{ messages: any[]; nextCursor?: string; hasMore: boolean }> {
    const line = getLineForSystemUserId(otherUserId);
    if (!line) {
      throw new BadRequestException("Not a system notification thread");
    }

    const userCreatedAt = await this.userClient.getUserCreatedAt(userId);
    let campaigns = await this.getVisibleCampaignsForUser(userId, line, userCreatedAt);

    // Cursor = campaign id; return older than that campaign's sentAt
    if (cursor) {
      const cursorCampaign = campaigns.find((c) => c.id === cursor);
      if (cursorCampaign) {
        const cursorTime = (cursorCampaign.sentAt || cursorCampaign.createdAt).getTime();
        campaigns = campaigns.filter(
          (c) => (c.sentAt || c.createdAt).getTime() < cursorTime
        );
      }
    }

    const hasMore = campaigns.length > limit;
    const page = hasMore ? campaigns.slice(0, limit) : campaigns;

    const deliveries = await this.prisma.notificationCampaignDelivery.findMany({
      where: {
        userId,
        campaignId: { in: page.map((c) => c.id) }
      },
      select: { campaignId: true, readAt: true }
    });
    const readMap = new Map(deliveries.map((d) => [d.campaignId, Boolean(d.readAt)]));

    const { id: conversationId } = await this.conversationService.getOrCreateConversation(
      userId,
      otherUserId
    );

    // Match FriendMessage history: query newest-first for cursor, return ascending for UI.
    const messages = page
      .map((c) => {
        const msg = this.virtualMessageFromCampaign(c, userId, readMap.get(c.id) ?? false);
        msg.conversationId = conversationId;
        return msg;
      })
      .reverse();

    return {
      messages,
      nextCursor: hasMore ? page[page.length - 1].id : undefined,
      hasMore
    };
  }

  isSystemPeer(userId: string): boolean {
    return isSystemNotificationUserId(userId);
  }

  private async invalidateNotificationCache(userId: string): Promise<void> {
    if (this.redis.isAvailable()) {
      await this.redis.del(`notifications:${userId}`);
    }
  }
}

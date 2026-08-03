import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  SeasonClaimStatus,
  SeasonStatus,
  SeasonTaskType,
  Prisma
} from "../../node_modules/.prisma/client/index.js";

// Note: SeasonService is provided in AppModule alongside WalletService (forwardRef).

export type SeasonUiMode =
  | "NO_ACTIVE_SEASON"
  | "IN_PROGRESS"
  | "CLAIM_READY"
  | "PENDING"
  | "REJECTED"
  | "APPROVED"
  | "GIFT_SENT"
  | "SEASON_TEASER"
  | "ALL_CLAIMED";

const DEFAULT_TASKS: Array<{
  taskType: SeasonTaskType;
  target: number;
  label: string;
  sortOrder: number;
  enabled: boolean;
}> = [
  {
    taskType: SeasonTaskType.UNIQUE_STRANGERS,
    target: 30,
    label: "Talk to unique strangers",
    sortOrder: 0,
    enabled: true
  },
  {
    taskType: SeasonTaskType.BEAM_MINUTES,
    target: 60,
    label: "Beam minutes",
    sortOrder: 1,
    enabled: true
  },
  {
    taskType: SeasonTaskType.BEAMCAST_MINUTES,
    target: 30,
    label: "Beamcast minutes",
    sortOrder: 2,
    enabled: true
  },
  {
    taskType: SeasonTaskType.DIAMONDS_EARNED,
    target: 20,
    label: "Diamonds earned",
    sortOrder: 3,
    enabled: true
  }
];

const INDIA_PHONE_RE = /^[6-9]\d{9}$/;
const PINCODE_RE = /^[1-9]\d{5}$/;

@Injectable()
export class SeasonService {
  private readonly logger = new Logger(SeasonService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async getActiveSeason() {
    return this.prisma.season.findFirst({
      where: { status: SeasonStatus.ACTIVE },
      include: { tasks: { orderBy: { sortOrder: "asc" } } }
    });
  }

  private async getOrCreateProgress(seasonId: string, userId: string) {
    return this.prisma.userSeasonProgress.upsert({
      where: { seasonId_userId: { seasonId, userId } },
      create: { seasonId, userId },
      update: {}
    });
  }

  private progressValue(
    taskType: SeasonTaskType,
    progress: {
      uniqueStrangers: number;
      beamSeconds: number;
      beamcastSeconds: number;
      diamondsEarned: number;
    }
  ): number {
    switch (taskType) {
      case SeasonTaskType.UNIQUE_STRANGERS:
        return progress.uniqueStrangers;
      case SeasonTaskType.BEAM_MINUTES:
        return Math.floor(progress.beamSeconds / 60);
      case SeasonTaskType.BEAMCAST_MINUTES:
        return Math.floor(progress.beamcastSeconds / 60);
      case SeasonTaskType.DIAMONDS_EARNED:
        return progress.diamondsEarned;
      default:
        return 0;
    }
  }

  private async syncStrangerCount(userId: string, seasonId?: string) {
    const peerCount = await this.prisma.userCallPeer.count({ where: { userId } });
    const season = seasonId
      ? await this.prisma.season.findUnique({ where: { id: seasonId } })
      : await this.getActiveSeason();
    if (!season || season.status !== SeasonStatus.ACTIVE) {
      return peerCount;
    }
    await this.getOrCreateProgress(season.id, userId);
    await this.prisma.userSeasonProgress.update({
      where: { seasonId_userId: { seasonId: season.id, userId } },
      data: { uniqueStrangers: peerCount }
    });
    await this.maybeMarkTasksComplete(season.id, userId);
    return peerCount;
  }

  private async maybeMarkTasksComplete(seasonId: string, userId: string) {
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      include: { tasks: true }
    });
    if (!season || season.status !== SeasonStatus.ACTIVE) return;

    const progress = await this.prisma.userSeasonProgress.findUnique({
      where: { seasonId_userId: { seasonId, userId } }
    });
    if (!progress || progress.tasksCompletedAt) return;

    const enabled = season.tasks.filter((t) => t.enabled);
    const allDone = enabled.every(
      (t) => this.progressValue(t.taskType, progress) >= t.target
    );
    if (allDone && enabled.length > 0) {
      await this.prisma.userSeasonProgress.update({
        where: { seasonId_userId: { seasonId, userId } },
        data: { tasksCompletedAt: new Date() }
      });
    }
  }

  private validateAddress(body: {
    recipientName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string | null;
    addressLine3?: string | null;
    landmark?: string | null;
    state: string;
    city: string;
    pincode: string;
  }) {
    if (!body.recipientName?.trim()) {
      throw new HttpException("Recipient full name is required", HttpStatus.BAD_REQUEST);
    }
    const phone = body.phone.replace(/\D/g, "").replace(/^91/, "");
    if (!INDIA_PHONE_RE.test(phone)) {
      throw new HttpException("Valid Indian mobile number is required", HttpStatus.BAD_REQUEST);
    }
    if (!body.addressLine1?.trim()) {
      throw new HttpException("Address line 1 is required", HttpStatus.BAD_REQUEST);
    }
    if (!body.state?.trim() || !body.city?.trim()) {
      throw new HttpException("State and city are required", HttpStatus.BAD_REQUEST);
    }
    if (!PINCODE_RE.test(body.pincode?.trim() || "")) {
      throw new HttpException("Valid 6-digit Indian pincode is required", HttpStatus.BAD_REQUEST);
    }
    return {
      recipientName: body.recipientName.trim(),
      phone,
      addressLine1: body.addressLine1.trim(),
      addressLine2: body.addressLine2?.trim() || null,
      addressLine3: body.addressLine3?.trim() || null,
      landmark: body.landmark?.trim() || null,
      state: body.state.trim(),
      city: body.city.trim(),
      pincode: body.pincode.trim()
    };
  }

  // ─── User view ────────────────────────────────────────────────────────────

  async getMySeasonView(userId: string) {
    const active = await this.getActiveSeason();
    if (!active) {
      return {
        uiMode: "NO_ACTIVE_SEASON" as SeasonUiMode,
        holdingMessage:
          "Wait for the next season — we’re cooking the gifts and the tasks for you.",
        instagramUrl: "https://www.instagram.com/beam.place/",
        season: null,
        global: null,
        tasks: [],
        claim: null
      };
    }

    // Keep stranger count in sync with lifetime peers
    await this.syncStrangerCount(userId, active.id);
    const progress = await this.getOrCreateProgress(active.id, userId);
    const claim = await this.prisma.seasonClaim.findUnique({
      where: { seasonId_userId: { seasonId: active.id, userId } }
    });

    const enabledTasks = active.tasks.filter((t) => t.enabled);
    const taskViews = enabledTasks.map((t) => {
      const current = this.progressValue(t.taskType, progress);
      return {
        taskType: t.taskType,
        label: t.label,
        target: t.target,
        current: Math.min(current, t.target),
        rawCurrent: current,
        progressPercent: Math.min(100, Math.round((current / Math.max(t.target, 1)) * 100)),
        completed: current >= t.target
      };
    });

    const allTasksComplete =
      enabledTasks.length > 0 && taskViews.every((t) => t.completed);
    const slotsFull = active.approvedCount >= active.giftPoolSize;

    let uiMode: SeasonUiMode = "IN_PROGRESS";
    if (claim) {
      switch (claim.status) {
        case SeasonClaimStatus.PENDING:
          uiMode = "PENDING";
          break;
        case SeasonClaimStatus.REJECTED:
          uiMode = "REJECTED";
          break;
        case SeasonClaimStatus.APPROVED:
          uiMode = "APPROVED";
          break;
        case SeasonClaimStatus.GIFT_SENT:
          uiMode = "GIFT_SENT";
          break;
        case SeasonClaimStatus.GIFT_RECEIVED:
          uiMode = "SEASON_TEASER";
          break;
      }
    } else if (slotsFull) {
      uiMode = "ALL_CLAIMED";
    } else if (allTasksComplete) {
      uiMode = "CLAIM_READY";
    }

    return {
      uiMode,
      holdingMessage: null,
      instagramUrl: "https://www.instagram.com/beam.place/",
      season: {
        id: active.id,
        name: active.name,
        status: active.status,
        startedAt: active.startedAt
      },
      global: {
        approvedCount: active.approvedCount,
        giftPoolSize: active.giftPoolSize
      },
      tasks: taskViews,
      claim: claim
        ? {
            status: claim.status,
            recipientName: claim.recipientName,
            phone: claim.phone,
            addressLine1: claim.addressLine1,
            addressLine2: claim.addressLine2,
            addressLine3: claim.addressLine3,
            landmark: claim.landmark,
            state: claim.state,
            city: claim.city,
            pincode: claim.pincode,
            rejectMessage: claim.rejectMessage,
            courierName: claim.courierName,
            trackingNumber: claim.trackingNumber,
            submittedAt: claim.submittedAt,
            approvedAt: claim.approvedAt,
            giftSentAt: claim.giftSentAt
          }
        : null,
      allTasksComplete,
      slotsFull
    };
  }

  async submitClaim(userId: string, body: any) {
    const active = await this.getActiveSeason();
    if (!active) {
      throw new HttpException("No active season", HttpStatus.BAD_REQUEST);
    }
    if (active.approvedCount >= active.giftPoolSize) {
      throw new HttpException("All boxes claimed", HttpStatus.BAD_REQUEST);
    }

    await this.syncStrangerCount(userId, active.id);
    const progress = await this.getOrCreateProgress(active.id, userId);
    const enabled = active.tasks.filter((t) => t.enabled);
    const allDone =
      enabled.length > 0 &&
      enabled.every((t) => this.progressValue(t.taskType, progress) >= t.target);
    if (!allDone) {
      throw new HttpException("Complete all tasks before claiming", HttpStatus.BAD_REQUEST);
    }

    const address = this.validateAddress(body);
    const existing = await this.prisma.seasonClaim.findUnique({
      where: { seasonId_userId: { seasonId: active.id, userId } }
    });

    if (existing) {
      if (existing.status !== SeasonClaimStatus.REJECTED) {
        throw new HttpException("Claim already submitted", HttpStatus.BAD_REQUEST);
      }
      return this.prisma.seasonClaim.update({
        where: { id: existing.id },
        data: {
          ...address,
          status: SeasonClaimStatus.PENDING,
          rejectMessage: null,
          rejectedAt: null,
          submittedAt: new Date()
        }
      });
    }

    return this.prisma.seasonClaim.create({
      data: {
        seasonId: active.id,
        userId,
        ...address,
        status: SeasonClaimStatus.PENDING
      }
    });
  }

  // ─── Internal progress credits ────────────────────────────────────────────

  /**
   * Record a lifetime peer encounter (both directions recommended by caller).
   * Updates active-season stranger counter for the user.
   */
  async recordPeerEncounter(userId: string, peerUserId: string) {
    if (!userId || !peerUserId || userId === peerUserId) {
      return { created: false, peerCount: 0 };
    }

    let created = false;
    try {
      await this.prisma.userCallPeer.create({
        data: { userId, peerUserId }
      });
      created = true;
    } catch (e) {
      if (
        !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      ) {
        throw e;
      }
    }

    const peerCount = await this.syncStrangerCount(userId);
    return { created, peerCount };
  }

  /**
   * Credit beam / beamcast seconds for a session contribution (idempotent via eventKey).
   */
  async creditCallTime(params: {
    userId: string;
    beamSeconds?: number;
    beamcastSeconds?: number;
    eventKey: string;
  }) {
    const active = await this.getActiveSeason();
    if (!active) {
      return { credited: false, reason: "no_active_season" };
    }

    const beamSeconds = Math.max(0, Math.floor(params.beamSeconds || 0));
    const beamcastSeconds = Math.max(0, Math.floor(params.beamcastSeconds || 0));
    if (beamSeconds === 0 && beamcastSeconds === 0) {
      return { credited: false, reason: "zero_seconds" };
    }

    try {
      await this.prisma.seasonProgressEvent.create({
        data: {
          seasonId: active.id,
          userId: params.userId,
          eventKey: params.eventKey
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return { credited: false, reason: "duplicate_event" };
      }
      throw e;
    }

    await this.getOrCreateProgress(active.id, params.userId);
    await this.prisma.userSeasonProgress.update({
      where: { seasonId_userId: { seasonId: active.id, userId: params.userId } },
      data: {
        beamSeconds: { increment: beamSeconds },
        beamcastSeconds: { increment: beamcastSeconds }
      }
    });
    await this.maybeMarkTasksComplete(active.id, params.userId);
    return { credited: true, beamSeconds, beamcastSeconds };
  }

  /**
   * Credit diamonds earned from sticker/gift receive during active season.
   */
  async creditDiamondsEarned(userId: string, amount: number, sourceKey?: string) {
    if (amount <= 0) return { credited: false };
    const active = await this.getActiveSeason();
    if (!active || !active.startedAt) return { credited: false };

    if (sourceKey) {
      try {
        await this.prisma.seasonProgressEvent.create({
          data: {
            seasonId: active.id,
            userId,
            eventKey: `diamond:${sourceKey}`
          }
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return { credited: false, reason: "duplicate" };
        }
        throw e;
      }
    }

    await this.getOrCreateProgress(active.id, userId);
    await this.prisma.userSeasonProgress.update({
      where: { seasonId_userId: { seasonId: active.id, userId } },
      data: { diamondsEarned: { increment: amount } }
    });
    await this.maybeMarkTasksComplete(active.id, userId);
    return { credited: true };
  }

  // ─── Admin: seasons ───────────────────────────────────────────────────────

  async listSeasons() {
    return this.prisma.season.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        tasks: { orderBy: { sortOrder: "asc" } },
        _count: { select: { claims: true, progress: true } }
      }
    });
  }

  async getSeason(seasonId: string) {
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      include: { tasks: { orderBy: { sortOrder: "asc" } } }
    });
    if (!season) throw new HttpException("Season not found", HttpStatus.NOT_FOUND);
    return season;
  }

  async createSeason(body: {
    name: string;
    giftPoolSize?: number;
    tasks?: Array<{
      taskType: SeasonTaskType;
      enabled?: boolean;
      target: number;
      label: string;
      sortOrder?: number;
    }>;
  }) {
    const name = body.name?.trim();
    if (!name) throw new HttpException("Name is required", HttpStatus.BAD_REQUEST);
    const giftPoolSize = body.giftPoolSize ?? 1000;
    if (giftPoolSize < 1) {
      throw new HttpException("giftPoolSize must be >= 1", HttpStatus.BAD_REQUEST);
    }

    const taskDefs = body.tasks?.length
      ? body.tasks
      : DEFAULT_TASKS.map((t) => ({ ...t }));

    return this.prisma.season.create({
      data: {
        name,
        giftPoolSize,
        status: SeasonStatus.DRAFT,
        tasks: {
          create: taskDefs.map((t, i) => ({
            taskType: t.taskType,
            enabled: t.enabled !== false,
            target: t.target,
            label: t.label,
            sortOrder: t.sortOrder ?? i
          }))
        }
      },
      include: { tasks: { orderBy: { sortOrder: "asc" } } }
    });
  }

  async updateSeason(
    seasonId: string,
    body: {
      name?: string;
      giftPoolSize?: number;
      tasks?: Array<{
        taskType: SeasonTaskType;
        enabled?: boolean;
        target?: number;
        label?: string;
        sortOrder?: number;
      }>;
    }
  ) {
    const season = await this.getSeason(seasonId);
    if (season.status === SeasonStatus.ENDED) {
      throw new HttpException("Cannot edit an ended season", HttpStatus.BAD_REQUEST);
    }

    return this.prisma.$transaction(async (tx) => {
      if (body.name !== undefined || body.giftPoolSize !== undefined) {
        await tx.season.update({
          where: { id: seasonId },
          data: {
            ...(body.name !== undefined ? { name: body.name.trim() } : {}),
            ...(body.giftPoolSize !== undefined
              ? { giftPoolSize: body.giftPoolSize }
              : {})
          }
        });
      }

      if (body.tasks?.length) {
        for (const t of body.tasks) {
          await tx.seasonTask.upsert({
            where: {
              seasonId_taskType: { seasonId, taskType: t.taskType }
            },
            create: {
              seasonId,
              taskType: t.taskType,
              enabled: t.enabled !== false,
              target: t.target ?? 1,
              label: t.label ?? t.taskType,
              sortOrder: t.sortOrder ?? 0
            },
            update: {
              ...(t.enabled !== undefined ? { enabled: t.enabled } : {}),
              ...(t.target !== undefined ? { target: t.target } : {}),
              ...(t.label !== undefined ? { label: t.label } : {}),
              ...(t.sortOrder !== undefined ? { sortOrder: t.sortOrder } : {})
            }
          });
        }
      }

      return tx.season.findUnique({
        where: { id: seasonId },
        include: { tasks: { orderBy: { sortOrder: "asc" } } }
      });
    });
  }

  async startSeason(seasonId: string) {
    const season = await this.getSeason(seasonId);
    if (season.status === SeasonStatus.ACTIVE) {
      return season;
    }
    if (season.status === SeasonStatus.ENDED) {
      throw new HttpException("Cannot restart an ended season; create a new one", HttpStatus.BAD_REQUEST);
    }

    const otherActive = await this.prisma.season.findFirst({
      where: { status: SeasonStatus.ACTIVE, NOT: { id: seasonId } }
    });
    if (otherActive) {
      throw new HttpException(
        `Another season is already active: ${otherActive.name}`,
        HttpStatus.BAD_REQUEST
      );
    }

    return this.prisma.season.update({
      where: { id: seasonId },
      data: { status: SeasonStatus.ACTIVE, startedAt: new Date(), endedAt: null },
      include: { tasks: { orderBy: { sortOrder: "asc" } } }
    });
  }

  /** Normal end: keep fulfillment records, freeze progress. */
  async endSeason(seasonId: string) {
    const season = await this.getSeason(seasonId);
    if (season.status !== SeasonStatus.ACTIVE) {
      throw new HttpException("Only an active season can be ended", HttpStatus.BAD_REQUEST);
    }
    return this.prisma.season.update({
      where: { id: seasonId },
      data: { status: SeasonStatus.ENDED, endedAt: new Date() },
      include: { tasks: { orderBy: { sortOrder: "asc" } } }
    });
  }

  /** Test wipe: hard-delete progress + claims (+ events); delete season. */
  async wipeSeason(seasonId: string) {
    await this.getSeason(seasonId);
    await this.prisma.$transaction([
      this.prisma.seasonProgressEvent.deleteMany({ where: { seasonId } }),
      this.prisma.seasonClaim.deleteMany({ where: { seasonId } }),
      this.prisma.userSeasonProgress.deleteMany({ where: { seasonId } }),
      this.prisma.seasonTask.deleteMany({ where: { seasonId } }),
      this.prisma.season.delete({ where: { id: seasonId } })
    ]);
    return { wiped: true, seasonId };
  }

  // ─── Admin: analytics & claims ────────────────────────────────────────────

  async getSeasonAnalytics(seasonId: string) {
    const season = await this.getSeason(seasonId);
    const enabled = season.tasks.filter((t) => t.enabled);

    const [
      progressCount,
      completers,
      claimsByStatus,
      taskFunnels
    ] = await Promise.all([
      this.prisma.userSeasonProgress.count({ where: { seasonId } }),
      this.prisma.userSeasonProgress.count({
        where: { seasonId, tasksCompletedAt: { not: null } }
      }),
      this.prisma.seasonClaim.groupBy({
        by: ["status"],
        where: { seasonId },
        _count: true
      }),
      Promise.all(
        enabled.map(async (task) => {
          const progresses = await this.prisma.userSeasonProgress.findMany({
            where: { seasonId },
            select: {
              uniqueStrangers: true,
              beamSeconds: true,
              beamcastSeconds: true,
              diamondsEarned: true
            }
          });
          const started = progresses.filter(
            (p) => this.progressValue(task.taskType, p) > 0
          ).length;
          const completed = progresses.filter(
            (p) => this.progressValue(task.taskType, p) >= task.target
          ).length;
          return {
            taskType: task.taskType,
            label: task.label,
            target: task.target,
            usersStarted: started,
            usersCompleted: completed
          };
        })
      )
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of claimsByStatus) {
      statusMap[row.status] = row._count;
    }

    return {
      season: {
        id: season.id,
        name: season.name,
        status: season.status,
        giftPoolSize: season.giftPoolSize,
        approvedCount: season.approvedCount,
        startedAt: season.startedAt,
        endedAt: season.endedAt
      },
      usersWithProgress: progressCount,
      usersCompletedAllTasks: completers,
      claims: {
        pending: statusMap[SeasonClaimStatus.PENDING] || 0,
        rejected: statusMap[SeasonClaimStatus.REJECTED] || 0,
        approved: statusMap[SeasonClaimStatus.APPROVED] || 0,
        giftSent: statusMap[SeasonClaimStatus.GIFT_SENT] || 0,
        giftReceived: statusMap[SeasonClaimStatus.GIFT_RECEIVED] || 0,
        total: Object.values(statusMap).reduce((a, b) => a + b, 0)
      },
      taskFunnels
    };
  }

  async listProgress(
    seasonId: string,
    opts: { limit?: number; offset?: number; completedOnly?: boolean } = {}
  ) {
    await this.getSeason(seasonId);
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const where: Prisma.UserSeasonProgressWhereInput = {
      seasonId,
      ...(opts.completedOnly ? { tasksCompletedAt: { not: null } } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.userSeasonProgress.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.userSeasonProgress.count({ where })
    ]);
    return { items, total, limit, offset };
  }

  async listClaims(
    seasonId: string,
    opts: {
      status?: SeasonClaimStatus;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    await this.getSeason(seasonId);
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const where: Prisma.SeasonClaimWhereInput = {
      seasonId,
      ...(opts.status ? { status: opts.status } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.seasonClaim.findMany({
        where,
        orderBy: { submittedAt: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.seasonClaim.count({ where })
    ]);
    return { items, total, limit, offset };
  }

  async approveClaim(claimId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.seasonClaim.findUnique({ where: { id: claimId } });
      if (!claim) throw new HttpException("Claim not found", HttpStatus.NOT_FOUND);
      if (claim.status !== SeasonClaimStatus.PENDING) {
        throw new HttpException("Only pending claims can be approved", HttpStatus.BAD_REQUEST);
      }

      // Lock season row
      const seasons = await tx.$queryRaw<
        Array<{ id: string; approvedCount: number; giftPoolSize: number; status: string }>
      >`SELECT id, "approvedCount", "giftPoolSize", status FROM seasons WHERE id = ${claim.seasonId} FOR UPDATE`;

      const season = seasons[0];
      if (!season) throw new HttpException("Season not found", HttpStatus.NOT_FOUND);
      if (season.approvedCount >= season.giftPoolSize) {
        throw new HttpException("Gift pool is full", HttpStatus.BAD_REQUEST);
      }

      await tx.season.update({
        where: { id: claim.seasonId },
        data: { approvedCount: { increment: 1 } }
      });

      return tx.seasonClaim.update({
        where: { id: claimId },
        data: {
          status: SeasonClaimStatus.APPROVED,
          approvedAt: new Date(),
          rejectMessage: null
        }
      });
    });
  }

  async rejectClaim(claimId: string, rejectMessage?: string) {
    const claim = await this.prisma.seasonClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new HttpException("Claim not found", HttpStatus.NOT_FOUND);
    if (claim.status !== SeasonClaimStatus.PENDING) {
      throw new HttpException("Only pending claims can be rejected", HttpStatus.BAD_REQUEST);
    }
    return this.prisma.seasonClaim.update({
      where: { id: claimId },
      data: {
        status: SeasonClaimStatus.REJECTED,
        rejectMessage: rejectMessage?.trim() || "Address rejected — please update and try again",
        rejectedAt: new Date()
      }
    });
  }

  async markGiftSent(claimId: string, courierName: string, trackingNumber: string) {
    if (!courierName?.trim() || !trackingNumber?.trim()) {
      throw new HttpException("courierName and trackingNumber are required", HttpStatus.BAD_REQUEST);
    }
    const claim = await this.prisma.seasonClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new HttpException("Claim not found", HttpStatus.NOT_FOUND);
    if (
      claim.status !== SeasonClaimStatus.APPROVED &&
      claim.status !== SeasonClaimStatus.GIFT_SENT
    ) {
      throw new HttpException("Claim must be approved first", HttpStatus.BAD_REQUEST);
    }
    return this.prisma.seasonClaim.update({
      where: { id: claimId },
      data: {
        status: SeasonClaimStatus.GIFT_SENT,
        courierName: courierName.trim(),
        trackingNumber: trackingNumber.trim(),
        giftSentAt: new Date()
      }
    });
  }

  async markGiftReceived(claimId: string) {
    const claim = await this.prisma.seasonClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new HttpException("Claim not found", HttpStatus.NOT_FOUND);
    if (
      claim.status !== SeasonClaimStatus.GIFT_SENT &&
      claim.status !== SeasonClaimStatus.GIFT_RECEIVED
    ) {
      throw new HttpException("Claim must be gift-sent first", HttpStatus.BAD_REQUEST);
    }
    return this.prisma.seasonClaim.update({
      where: { id: claimId },
      data: {
        status: SeasonClaimStatus.GIFT_RECEIVED,
        giftReceivedAt: new Date()
      }
    });
  }

  /** Best-effort backfill peers from pairs; used by admin/internal. */
  async upsertPeerPairs(pairs: Array<{ userId: string; peerUserId: string }>) {
    let created = 0;
    for (const p of pairs) {
      if (!p.userId || !p.peerUserId || p.userId === p.peerUserId) continue;
      try {
        await this.prisma.userCallPeer.create({
          data: { userId: p.userId, peerUserId: p.peerUserId }
        });
        created++;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) {
          this.logger.warn(`Peer upsert failed: ${e}`);
        }
      }
    }
    return { created, total: pairs.length };
  }
}

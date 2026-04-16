import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post
} from "@nestjs/common";
import { z } from "zod";
import fetch from "node-fetch";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserService } from "../services/user.service.js";
import { BrandService } from "../services/brand.service.js";

const authBase = () => (process.env.AUTH_SERVICE_URL || "http://localhost:3001").replace(/\/$/, "");

type AuthAdminUser = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  accountStatus: string;
  bannedAt: string | null;
  banReason: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  deactivatedAt: string | null;
  deletedAt: string | null;
};

/** Relations used for admin merge (badges optional if DB predates user_badges migration). */
const adminUserProfileIncludeBase = {
  photos: { orderBy: { order: "asc" as const } },
  musicPreference: true,
  brandPreferences: {
    orderBy: { order: "asc" as const },
    include: { brand: true }
  },
  interests: {
    orderBy: { order: "asc" as const },
    include: { interest: true }
  },
  values: {
    orderBy: { order: "asc" as const },
    include: { value: true }
  }
} as const;

const adminUserProfileInclude = {
  ...adminUserProfileIncludeBase,
  badges: { orderBy: { receivedAt: "desc" as const } }
} as const;

function isMissingUserBadgesTableError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: string }).code;
  if (code === "P2021") {
    const table = (e as { meta?: { table?: string } }).meta?.table ?? "";
    if (table.includes("user_badges")) return true;
  }
  const msg = String((e as { message?: string }).message ?? "");
  return /user_badges/i.test(msg) && (/does not exist/i.test(msg) || /relation/i.test(msg));
}

/**
 * Subset of User + adminUserProfileInclude used by mergeAuthUserWithProfile.
 * Avoids Prisma.UserGetPayload — not exported on Prisma in some generated client builds (e.g. Docker).
 */
type ProfileWithAdminInclude = {
  username: string | null;
  displayPictureUrl: string | null;
  intent: string | null;
  createdAt: Date;
  dateOfBirth: Date | null;
  gender: string | null;
  reportCount: number;
  badgeMember: boolean;
  isModerator?: boolean;
  kycStatus?: string;
  kycRiskScore?: number;
  kycExpiresAt?: Date | null;
  preferredCity: string | null;
  profileCompleted: boolean;
  activeBadgeId: string | null;
  musicPreferenceId: string | null;
  status: string;
  musicPreference: {
    id: string;
    name: string;
    artist: string;
    albumArtUrl: string | null;
    spotifyId: string | null;
  } | null;
  photos: { id: string; url: string; order: number }[];
  brandPreferences: {
    order: number;
    brand: { id: string; name: string; domain: string | null; logoUrl: string | null };
  }[];
  interests: {
    order: number;
    interest: { id: string; name: string; genre: string | null };
  }[];
  values: { order: number; value: { id: string; name: string } }[];
  badges?: {
    id: string;
    giftId: string;
    giftName: string;
    giftEmoji: string | null;
    receivedAt: Date;
  }[];
};

function iso(d: Date | null | undefined): string | null {
  if (!d) return null;
  const s = d.toISOString?.();
  return s ?? null;
}

function mergeAuthUserWithProfile(
  a: AuthAdminUser,
  p: ProfileWithAdminInclude | null | undefined,
  resolveLogo?: (domain: string | null, logoUrl: string | null) => string | null
) {
  const banned = a.accountStatus === "BANNED";
  const inactive =
    a.accountStatus === "DEACTIVATED" ||
    a.accountStatus === "SUSPENDED" ||
    !!a.deletedAt;

  const music = p?.musicPreference;
  const musicPreference = music
    ? {
        id: music.id,
        name: music.name,
        artist: music.artist,
        albumArtUrl: music.albumArtUrl ?? null,
        spotifyId: music.spotifyId ?? null
      }
    : null;

  return {
    id: a.id,
    email: a.email ?? null,
    phone: a.phone ?? null,
    displayName: p?.username ?? a.name ?? null,
    username: p?.username ?? null,
    firstName: null as string | null,
    lastName: null as string | null,
    avatarUrl: p?.displayPictureUrl ?? null,
    bio: p?.intent ?? null,
    createdAt: p?.createdAt ? iso(p.createdAt) : a.createdAt ?? null,
    isActive: !inactive && !banned,
    banned,
    bannedAt: a.bannedAt ?? null,
    banReason: a.banReason ?? null,
    status: a.accountStatus,
    role: null as string | null,
    discoveryStatus: p?.status ?? null,
    dateOfBirth: p?.dateOfBirth ? iso(p.dateOfBirth) : null,
    gender: p?.gender ?? null,
    reportCount: p?.reportCount ?? null,
    kycStatus: p?.kycStatus ?? null,
    kycRiskScore: p?.kycRiskScore ?? null,
    kycExpiresAt: iso(p?.kycExpiresAt ?? null),
    isModerator: p?.isModerator ?? null,
    badgeMember: p?.badgeMember ?? null,
    preferredCity: p?.preferredCity ?? null,
    profileCompleted: p?.profileCompleted ?? null,
    activeBadgeId: p?.activeBadgeId ?? null,
    musicPreference,
    musicPreferenceId: p?.musicPreferenceId ?? null,
    photos: (p?.photos ?? []).map((ph) => ({
      id: ph.id,
      url: ph.url,
      order: ph.order
    })),
    brandPreferences: (p?.brandPreferences ?? [])
      .filter((ub) => ub.brand != null)
      .map((ub) => ({
        order: ub.order,
        brand: {
          id: ub.brand!.id,
          name: ub.brand!.name,
          domain: ub.brand!.domain ?? null,
          logoUrl: resolveLogo
            ? resolveLogo(ub.brand!.domain ?? null, ub.brand!.logoUrl ?? null)
            : ub.brand!.logoUrl ?? null
        }
      })),
    interests: (p?.interests ?? [])
      .filter((ui) => ui.interest != null)
      .map((ui) => ({
        order: ui.order,
        interest: {
          id: ui.interest!.id,
          name: ui.interest!.name,
          genre: ui.interest!.genre ?? null
        }
      })),
    values: (p?.values ?? [])
      .filter((uv) => uv.value != null)
      .map((uv) => ({
        order: uv.order,
        value: {
          id: uv.value!.id,
          name: uv.value!.name
        }
      })),
    badges: (p?.badges ?? []).map((b) => ({
      id: b.id,
      giftId: b.giftId,
      giftName: b.giftName,
      giftEmoji: b.giftEmoji ?? null,
      receivedAt: iso(b.receivedAt)
    }))
  };
}

const patchUserSchema = z.object({
  displayName: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  reportCount: z.number().int().min(0).optional(),
  isModerator: z.boolean().optional(),
  kycStatus: z.enum(["UNVERIFIED", "VERIFIED", "PENDING_REVIEW", "REVOKED", "EXPIRED"]).optional(),
  kycRiskScore: z.number().int().min(0).max(100).optional(),
  kycExpiresAt: z.string().datetime().nullable().optional(),
  moderationMeta: z.object({
    updatedBy: z.string().min(1),
    reason: z.string().min(1),
    notes: z.string().optional()
  }).optional()
});

const reportSchema = z.object({
  reason: z.string().min(1),
  notes: z.string().optional()
});

async function authFetch(path: string, init?: Parameters<typeof fetch>[1]) {
  const url = `${authBase()}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>)
  };
  if (init?.body) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }
  return fetch(url, { ...init, headers });
}

@Controller("admin/users")
export class UsersAdminController {
  private readonly logger = new Logger(UsersAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly brandService: BrandService
  ) {}

  private async findManyAdminProfiles(ids: string[]) {
    try {
      return await this.prisma.user.findMany({
        where: { id: { in: ids } },
        include: adminUserProfileInclude
      });
    } catch (e) {
      if (isMissingUserBadgesTableError(e)) {
        this.logger.warn(
          "user_badges table missing; loading admin users without badges. Run prisma migrate deploy on user-service DB."
        );
        return this.prisma.user.findMany({
          where: { id: { in: ids } },
          include: adminUserProfileIncludeBase
        });
      }
      throw e;
    }
  }

  private async findUniqueAdminProfile(id: string) {
    try {
      return await this.prisma.user.findUnique({
        where: { id },
        include: adminUserProfileInclude
      });
    } catch (e) {
      if (isMissingUserBadgesTableError(e)) {
        this.logger.warn(
          "user_badges table missing; loading admin user without badges. Run prisma migrate deploy on user-service DB."
        );
        return this.prisma.user.findUnique({
          where: { id },
          include: adminUserProfileIncludeBase
        });
      }
      throw e;
    }
  }

  /**
   * GET /admin/users — merged auth + profile for Beam dashboard
   */
  @Get()
  async list() {
    const authRes = await authFetch("/auth/admin/users", { method: "GET" });
    if (!authRes.ok) {
      const text = await authRes.text();
      throw new HttpException(
        `Auth service admin list failed: ${authRes.status} ${text}`,
        HttpStatus.BAD_GATEWAY
      );
    }
    let authJson: { ok?: boolean; users?: AuthAdminUser[] };
    try {
      authJson = (await authRes.json()) as { ok?: boolean; users?: AuthAdminUser[] };
    } catch {
      throw new HttpException("Auth service returned invalid JSON for admin user list", HttpStatus.BAD_GATEWAY);
    }
    const authUsers = Array.isArray(authJson.users) ? authJson.users : [];
    if (authUsers.length === 0) {
      return { ok: true, users: [] };
    }

    const ids = authUsers.map((u) => u.id);
    const profiles = await this.findManyAdminProfiles(ids);
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    const users = authUsers.map((a) =>
      mergeAuthUserWithProfile(a, profileById.get(a.id), (d, u) =>
        this.brandService.resolvePublicLogoUrl(d, u)
      )
    );

    return { ok: true, users };
  }

  /**
   * GET /admin/users/:id — merged auth + profile (richest row for dashboard detail)
   */
  @Get(":id")
  async getOne(@Param("id") id: string) {
    const authRes = await authFetch(`/auth/admin/users/${encodeURIComponent(id)}`, { method: "GET" });
    if (!authRes.ok) {
      if (authRes.status === 404) {
        throw new HttpException("User not found", HttpStatus.NOT_FOUND);
      }
      const text = await authRes.text();
      throw new HttpException(
        `Auth service admin user failed: ${authRes.status} ${text}`,
        HttpStatus.BAD_GATEWAY
      );
    }
    let authJson: { ok?: boolean; user?: AuthAdminUser };
    try {
      authJson = (await authRes.json()) as { ok?: boolean; user?: AuthAdminUser };
    } catch {
      throw new HttpException("Auth service returned invalid JSON for admin user", HttpStatus.BAD_GATEWAY);
    }
    const a = authJson.user;
    if (!a || a.id !== id) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }
    const p = await this.findUniqueAdminProfile(id);
    return {
      ok: true,
      user: mergeAuthUserWithProfile(a, p ?? undefined, (d, u) => this.brandService.resolvePublicLogoUrl(d, u))
    };
  }

  /**
   * PATCH /admin/users/:id
   */
  @Patch(":id")
  async patch(@Param("id") id: string, @Body() body: unknown) {
    const data = patchUserSchema.parse(body);
    const profile = await this.prisma.user.findUnique({ where: { id } });

    const prismaData: {
      username?: string | null;
      intent?: string | null;
    } = {};

    if (data.username !== undefined) {
      prismaData.username = data.username;
    } else if (data.displayName !== undefined) {
      prismaData.username = data.displayName;
    }

    if (data.bio !== undefined) {
      prismaData.intent = data.bio;
    }

    if (profile && Object.keys(prismaData).length > 0) {
      await this.prisma.user.update({
        where: { id },
        data: prismaData
      });
    } else if (!profile && Object.keys(prismaData).length > 0) {
      this.logger.warn(`PATCH ${id}: no user-service profile row; skipping profile fields`);
    }

    if (data.isActive === true) {
      const restoreRes = await authFetch(`/auth/admin/users/${id}/restore-login`, { method: "POST" });
      if (!restoreRes.ok) {
        const t = await restoreRes.text();
        throw new HttpException(
          `Restore login failed: ${restoreRes.status} ${t}. If the user is banned, use Unban instead of Edit → active.`,
          HttpStatus.BAD_GATEWAY
        );
      }
    } else if (data.isActive === false) {
      const deactivateRes = await authFetch(`/auth/admin/users/${id}/deactivate`, { method: "POST" });
      if (!deactivateRes.ok) {
        const t = await deactivateRes.text();
        throw new HttpException(`Deactivate failed: ${deactivateRes.status} ${t}`, HttpStatus.BAD_GATEWAY);
      }
    }

    if (data.reportCount !== undefined) {
      if (!data.moderationMeta?.updatedBy || !data.moderationMeta?.reason) {
        throw new HttpException("moderationMeta.updatedBy and moderationMeta.reason are required for report score changes", HttpStatus.BAD_REQUEST);
      }
      const auditMeta = {
        updatedBy: data.moderationMeta.updatedBy,
        reason: data.moderationMeta.reason,
        notes: data.moderationMeta.notes
      };
      await this.userService.adminSetReportScore(id, data.reportCount, auditMeta);
    }

    if (
      data.isModerator !== undefined ||
      data.kycStatus !== undefined ||
      data.kycRiskScore !== undefined ||
      data.kycExpiresAt !== undefined
    ) {
      if (!data.moderationMeta?.updatedBy || !data.moderationMeta?.reason) {
        throw new HttpException("moderationMeta.updatedBy and moderationMeta.reason are required for KYC/moderator changes", HttpStatus.BAD_REQUEST);
      }
      const auditMeta = {
        updatedBy: data.moderationMeta.updatedBy,
        reason: data.moderationMeta.reason,
        notes: data.moderationMeta.notes
      };
      await this.userService.adminSetKycState(id, {
        isModerator: data.isModerator,
        kycStatus: data.kycStatus as any,
        kycRiskScore: data.kycRiskScore,
        kycExpiresAt: data.kycExpiresAt !== undefined ? (data.kycExpiresAt ? new Date(data.kycExpiresAt) : null) : undefined
      }, auditMeta);
    }

    return { ok: true };
  }

  @Post(":id/ban")
  @HttpCode(HttpStatus.OK)
  async ban(@Param("id") id: string, @Body() body: unknown) {
    const { reason } = z.object({ reason: z.string().optional() }).parse(body ?? {});
    const res = await authFetch(`/auth/admin/users/${id}/ban`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? undefined })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new HttpException(`Ban failed: ${res.status} ${t}`, HttpStatus.BAD_GATEWAY);
    }
    return res.json();
  }

  @Post(":id/unban")
  @HttpCode(HttpStatus.OK)
  async unban(@Param("id") id: string) {
    const res = await authFetch(`/auth/admin/users/${id}/unban`, { method: "POST" });
    if (!res.ok) {
      const t = await res.text();
      throw new HttpException(`Unban failed: ${res.status} ${t}`, HttpStatus.BAD_GATEWAY);
    }
    return res.json();
  }

  @Post(":id/report")
  @HttpCode(HttpStatus.OK)
  async report(@Param("id") id: string, @Body() body: unknown) {
    const parsed = reportSchema.parse(body);
    const result = await this.userService.adminDashboardReportUser(id, {
      reason: parsed.reason,
      notes: parsed.notes
    });
    this.logger.warn(
      `Admin report user=${id} weight=${result.weightApplied} newScore=${result.reportCount} reason=${parsed.reason}${parsed.notes ? ` notes=${parsed.notes}` : ""}`
    );
    return {
      ok: true,
      recorded: true,
      reportCount: result.reportCount,
      weightApplied: result.weightApplied
    };
  }

  @Post(":id/report-score")
  @HttpCode(HttpStatus.OK)
  async setReportScore(@Param("id") id: string, @Body() body: unknown) {
    const { reportCount, moderationMeta } = z.object({
      reportCount: z.number().int().min(0),
      moderationMeta: z.object({
        updatedBy: z.string().min(1),
        reason: z.string().min(1),
        notes: z.string().optional()
      })
    }).parse(body);
    const result = await this.userService.adminSetReportScore(id, reportCount, {
      updatedBy: moderationMeta.updatedBy,
      reason: moderationMeta.reason,
      notes: moderationMeta.notes
    });
    return {
      ok: true,
      ...result
    };
  }

  @Post(":id/kyc")
  @HttpCode(HttpStatus.OK)
  async updateKyc(@Param("id") id: string, @Body() body: unknown) {
    const parsed = z.object({
      kycStatus: z.enum(["UNVERIFIED", "VERIFIED", "PENDING_REVIEW", "REVOKED", "EXPIRED"]).optional(),
      kycRiskScore: z.number().int().min(0).max(100).optional(),
      kycExpiresAt: z.string().datetime().nullable().optional(),
      isModerator: z.boolean().optional(),
      moderationMeta: z.object({
        updatedBy: z.string().min(1),
        reason: z.string().min(1),
        notes: z.string().optional()
      })
    }).parse(body ?? {});

    const result = await this.userService.adminSetKycState(id, {
      kycStatus: parsed.kycStatus as any,
      kycRiskScore: parsed.kycRiskScore,
      kycExpiresAt: parsed.kycExpiresAt !== undefined ? (parsed.kycExpiresAt ? new Date(parsed.kycExpiresAt) : null) : undefined,
      isModerator: parsed.isModerator
    }, {
      updatedBy: parsed.moderationMeta.updatedBy,
      reason: parsed.moderationMeta.reason,
      notes: parsed.moderationMeta.notes
    });
    return {
      ok: true,
      ...result
    };
  }

  /**
   * Hard delete — removes user-service profile row then auth user row (dashboard only).
   */
  @Delete(":id/hard")
  @HttpCode(HttpStatus.OK)
  async hardDelete(@Param("id") id: string) {
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (err) {
      this.logger.warn(`hardDelete ${id}: user-service profile missing or delete failed: ${String(err)}`);
    }
    const res = await authFetch(`/auth/admin/users/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      const t = await res.text();
      throw new HttpException(`Auth hard delete failed: ${res.status} ${t}`, HttpStatus.BAD_GATEWAY);
    }
    return { ok: true, deleted: true };
  }

  /**
   * Deactivate — same auth state as user self-deactivate; user can reactivate in app.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async softDelete(@Param("id") id: string) {
    const res = await authFetch(`/auth/admin/users/${id}/deactivate`, { method: "POST" });
    if (!res.ok) {
      const t = await res.text();
      throw new HttpException(`Deactivate failed: ${res.status} ${t}`, HttpStatus.BAD_GATEWAY);
    }
    return { ok: true, deactivated: true };
  }
}

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

const patchUserSchema = z.object({
  displayName: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  isActive: z.boolean().optional()
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

  constructor(private readonly prisma: PrismaService) {}

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
    const authJson = (await authRes.json()) as { ok?: boolean; users: AuthAdminUser[] };
    const authUsers = authJson.users ?? [];
    if (authUsers.length === 0) {
      return { ok: true, users: [] };
    }

    const ids = authUsers.map((u) => u.id);
    const profiles = await this.prisma.user.findMany({
      where: { id: { in: ids } }
    });
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    const users = authUsers.map((a) => {
      const p = profileById.get(a.id);
      const banned = a.accountStatus === "BANNED";
      const inactive =
        a.accountStatus === "DEACTIVATED" ||
        a.accountStatus === "SUSPENDED" ||
        !!a.deletedAt;

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
        createdAt: p?.createdAt?.toISOString?.() ?? a.createdAt ?? null,
        updatedAt: p?.updatedAt?.toISOString?.() ?? a.updatedAt ?? null,
        isActive: !inactive && !banned,
        banned,
        bannedAt: a.bannedAt ?? null,
        banReason: a.banReason ?? null,
        status: a.accountStatus,
        role: null as string | null
      };
    });

    return { ok: true, users };
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
      const unbanRes = await authFetch(`/auth/admin/users/${id}/unban`, { method: "POST" });
      if (!unbanRes.ok && unbanRes.status !== 404) {
        const t = await unbanRes.text();
        this.logger.warn(`unban ${id}: ${unbanRes.status} ${t}`);
      }
      const unsuspendRes = await authFetch(`/auth/admin/users/${id}/unsuspend`, { method: "POST" });
      if (!unsuspendRes.ok && unsuspendRes.status !== 404) {
        const t = await unsuspendRes.text();
        this.logger.warn(`unsuspend ${id}: ${unsuspendRes.status} ${t}`);
      }
    } else if (data.isActive === false) {
      const suspendRes = await authFetch(`/auth/admin/users/${id}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason: "Deactivated via admin dashboard" })
      });
      if (!suspendRes.ok) {
        const t = await suspendRes.text();
        throw new HttpException(`Suspend failed: ${suspendRes.status} ${t}`, HttpStatus.BAD_GATEWAY);
      }
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
    this.logger.warn(
      `Admin report user=${id} reason=${parsed.reason}${parsed.notes ? ` notes=${parsed.notes}` : ""}`
    );
    return { ok: true, recorded: true };
  }

  /**
   * Permanent removal — ban (auth); profile data remains for FK safety
   */
  @Delete(":id/hard")
  @HttpCode(HttpStatus.OK)
  async hardDelete(@Param("id") id: string) {
    const res = await authFetch(`/auth/admin/users/${id}/ban`, {
      method: "POST",
      body: JSON.stringify({ reason: "Permanent removal via admin dashboard" })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new HttpException(`Permanent ban failed: ${res.status} ${t}`, HttpStatus.BAD_GATEWAY);
    }
    return res.json();
  }

  /**
   * Soft deactivate — suspend auth account
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async softDelete(@Param("id") id: string) {
    const res = await authFetch(`/auth/admin/users/${id}/suspend`, {
      method: "POST",
      body: JSON.stringify({ reason: "Deactivated via admin dashboard" })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new HttpException(`Deactivate failed: ${res.status} ${t}`, HttpStatus.BAD_GATEWAY);
    }
    return { ok: true, deactivated: true };
  }
}

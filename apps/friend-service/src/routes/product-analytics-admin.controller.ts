import { Controller, Get, Headers, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

function assertAdminToken(token: string | string[] | undefined) {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) {
    throw new HttpException("Admin API not configured", HttpStatus.SERVICE_UNAVAILABLE);
  }
  const presented = Array.isArray(token) ? token[0] : token;
  if (!presented || presented !== expected) {
    throw new HttpException("Invalid admin token", HttpStatus.UNAUTHORIZED);
  }
}

function istDayStart(daysAgo: number, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return new Date(Date.UTC(y, m - 1, d - daysAgo, -5, -30, 0, 0));
}

function n(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

@Controller("admin/product-messages")
export class ProductAnalyticsAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async overview(@Headers("x-admin-token") token?: string | string[]) {
    assertAdminToken(token);
    const today = istDayStart(0);
    const last7 = istDayStart(6);
    const prior7 = istDayStart(13);
    const [row] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        COUNT(DISTINCT "fromUserId") FILTER (WHERE "createdAt" >= ${today})::int AS today,
        COUNT(DISTINCT "fromUserId") FILTER (WHERE "createdAt" >= ${last7})::int AS last7,
        COUNT(DISTINCT "fromUserId") FILTER (
          WHERE "createdAt" >= ${prior7} AND "createdAt" < ${last7}
        )::int AS prior7,
        COUNT(DISTINCT "fromUserId")::int AS lifetime
      FROM friend_messages
    `;
    return {
      ok: true as const,
      generatedAt: new Date().toISOString(),
      messagePeople: {
        today: n(row?.today),
        last7: n(row?.last7),
        prior7: n(row?.prior7),
        lifetime: n(row?.lifetime)
      }
    };
  }
}

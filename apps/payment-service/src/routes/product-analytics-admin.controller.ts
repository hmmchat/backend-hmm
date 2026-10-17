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

@Controller("admin/payments")
export class ProductAnalyticsAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("product-analytics")
  async overview(@Headers("x-admin-token") token?: string | string[]) {
    assertAdminToken(token);
    const today = istDayStart(0);
    const last7 = istDayStart(6);
    const prior7 = istDayStart(13);
    const [row] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        COUNT(DISTINCT "userId") FILTER (
          WHERE status = 'COMPLETED' AND COALESCE("completedAt", "createdAt") >= ${today}
        )::int AS payers_today,
        COUNT(DISTINCT "userId") FILTER (
          WHERE status = 'COMPLETED' AND COALESCE("completedAt", "createdAt") >= ${last7}
        )::int AS payers_last7,
        COUNT(DISTINCT "userId") FILTER (
          WHERE status = 'COMPLETED'
            AND COALESCE("completedAt", "createdAt") >= ${prior7}
            AND COALESCE("completedAt", "createdAt") < ${last7}
        )::int AS payers_prior7,
        COUNT(DISTINCT "userId") FILTER (WHERE status = 'COMPLETED')::int AS payers_lifetime,
        COALESCE(SUM("amountInr") FILTER (
          WHERE status = 'COMPLETED' AND COALESCE("completedAt", "createdAt") >= ${today}
        ), 0)::int AS paise_today,
        COALESCE(SUM("amountInr") FILTER (
          WHERE status = 'COMPLETED' AND COALESCE("completedAt", "createdAt") >= ${last7}
        ), 0)::int AS paise_last7,
        COALESCE(SUM("amountInr") FILTER (
          WHERE status = 'COMPLETED'
            AND COALESCE("completedAt", "createdAt") >= ${prior7}
            AND COALESCE("completedAt", "createdAt") < ${last7}
        ), 0)::int AS paise_prior7,
        COALESCE(SUM("amountInr") FILTER (WHERE status = 'COMPLETED'), 0)::int AS paise_lifetime
      FROM payment_orders
    `;
    const windowOf = (a: number, b: number, c: number, d: number) => ({
      today: a,
      last7: b,
      prior7: c,
      lifetime: d
    });
    return {
      ok: true as const,
      generatedAt: new Date().toISOString(),
      payers: windowOf(
        n(row?.payers_today),
        n(row?.payers_last7),
        n(row?.payers_prior7),
        n(row?.payers_lifetime)
      ),
      revenuePaise: windowOf(
        n(row?.paise_today),
        n(row?.paise_last7),
        n(row?.paise_prior7),
        n(row?.paise_lifetime)
      )
    };
  }
}

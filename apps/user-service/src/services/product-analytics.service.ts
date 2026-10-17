import { Injectable } from "@nestjs/common";
import { Prisma } from "../../node_modules/.prisma/client/index.js";
import { PrismaService } from "../prisma/prisma.service.js";

const TZ = "Asia/Kolkata";

export type CountWindow = {
  today: number;
  last7: number;
  prior7: number;
  lifetime: number;
};

/** IST calendar-day start, `daysAgo` days before today's IST date. */
export function istDayStart(daysAgo: number, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
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

function cityLabelSql() {
  return Prisma.sql`
    CASE
      WHEN "preferredCity" IS NULL OR btrim("preferredCity") = '' THEN 'No city'
      WHEN "preferredCity" = 'ANYWHERE_IN_INDIA' THEN 'Anywhere in India'
      ELSE "preferredCity"
    END
  `;
}

@Injectable()
export class ProductAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const today = istDayStart(0);
    const yesterday = istDayStart(1);
    const last7 = istDayStart(6);
    const prior7 = istDayStart(13);
    const recentSince = istDayStart(14);

    const [counts] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" >= ${today})::int AS signups_today,
        COUNT(*) FILTER (WHERE "createdAt" >= ${last7})::int AS signups_last7,
        COUNT(*) FILTER (WHERE "createdAt" >= ${prior7} AND "createdAt" < ${last7})::int AS signups_prior7,
        COUNT(*)::int AS signups_lifetime,
        COUNT(*) FILTER (WHERE "profileCompleted" AND "createdAt" >= ${today})::int AS facecard_today,
        COUNT(*) FILTER (WHERE "profileCompleted" AND "createdAt" >= ${last7})::int AS facecard_last7,
        COUNT(*) FILTER (WHERE "profileCompleted" AND "createdAt" >= ${prior7} AND "createdAt" < ${last7})::int AS facecard_prior7,
        COUNT(*) FILTER (WHERE "profileCompleted")::int AS facecard_lifetime,
        COUNT(*) FILTER (WHERE "lastActiveAt" >= ${today})::int AS active_today,
        COUNT(*) FILTER (WHERE "lastActiveAt" >= ${last7})::int AS active_last7,
        COUNT(*) FILTER (WHERE "lastActiveAt" IS NOT NULL)::int AS active_lifetime,
        COUNT(*) FILTER (WHERE "lastActiveAt" >= ${last7} AND gender::text = 'FEMALE')::int AS female_active7,
        COUNT(*) FILTER (WHERE "lastActiveAt" >= ${last7} AND gender::text = 'MALE')::int AS male_active7,
        COUNT(*) FILTER (
          WHERE "lastActiveAt" >= ${last7}
            AND (gender IS NULL OR gender::text NOT IN ('FEMALE', 'MALE'))
        )::int AS other_active7
      FROM users
      WHERE "isModerator" = false
    `;

    const cities = await this.prisma.$queryRaw<
      Array<{
        city: string;
        active7: number;
        signups7: number;
        female_active7: number;
        male_active7: number;
      }>
    >`
      SELECT
        ${cityLabelSql()} AS city,
        COUNT(*) FILTER (WHERE "lastActiveAt" >= ${last7})::int AS active7,
        COUNT(*) FILTER (WHERE "createdAt" >= ${last7})::int AS signups7,
        COUNT(*) FILTER (WHERE "lastActiveAt" >= ${last7} AND gender::text = 'FEMALE')::int AS female_active7,
        COUNT(*) FILTER (WHERE "lastActiveAt" >= ${last7} AND gender::text = 'MALE')::int AS male_active7
      FROM users
      WHERE "isModerator" = false
      GROUP BY 1
      ORDER BY active7 DESC, signups7 DESC
      LIMIT 8
    `;

    const recentRows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        createdAt: Date;
        lastActiveAt: Date | null;
        profileCompleted: boolean;
      }>
    >`
      SELECT id, "createdAt", "lastActiveAt", "profileCompleted"
      FROM users
      WHERE "isModerator" = false
        AND "createdAt" >= ${recentSince}
      ORDER BY "createdAt" DESC
      LIMIT 4001
    `;

    const recentSignupsTruncated = recentRows.length > 4000;
    const recentSignups = recentRows.slice(0, 4000).map((row) => ({
      id: row.id,
      createdAt: new Date(row.createdAt).toISOString(),
      lastActiveAt: row.lastActiveAt ? new Date(row.lastActiveAt).toISOString() : null,
      profileCompleted: Boolean(row.profileCompleted)
    }));

    let d1ByDay: Array<{ day: string; returned: number }> = [];
    let recordedDays: string[] = [];
    try {
      const recorded = await this.prisma.$queryRaw<Array<{ day: string }>>`
        SELECT DISTINCT day::text AS day
        FROM user_active_days
        WHERE day >= (timezone('Asia/Kolkata', ${recentSince}))::date
      `;
      recordedDays = recorded.map((row) => row.day);
      d1ByDay = await this.prisma.$queryRaw<Array<{ day: string; returned: number }>>`
        SELECT
          (timezone(${TZ}, u."createdAt"))::date::text AS day,
          COUNT(*) FILTER (
            WHERE EXISTS (
              SELECT 1
              FROM user_active_days a
              WHERE a."userId" = u.id
                AND a.day = (timezone(${TZ}, u."createdAt"))::date + 1
            )
          )::int AS returned
        FROM users u
        WHERE u."isModerator" = false
          AND u."createdAt" >= ${recentSince}
          AND u."createdAt" < ${today}
        GROUP BY 1
        ORDER BY 1
      `;
    } catch {
      d1ByDay = [];
      recordedDays = [];
    }

    const windowOf = (todayN: number, last7N: number, prior7N: number, lifetimeN: number): CountWindow => ({
      today: todayN,
      last7: last7N,
      prior7: prior7N,
      lifetime: lifetimeN
    });

    return {
      ok: true as const,
      generatedAt: new Date().toISOString(),
      timezone: TZ,
      bounds: {
        todayStart: today.toISOString(),
        yesterdayStart: yesterday.toISOString(),
        last7Start: last7.toISOString(),
        prior7Start: prior7.toISOString()
      },
      signups: windowOf(
        n(counts?.signups_today),
        n(counts?.signups_last7),
        n(counts?.signups_prior7),
        n(counts?.signups_lifetime)
      ),
      facecardCompleted: windowOf(
        n(counts?.facecard_today),
        n(counts?.facecard_last7),
        n(counts?.facecard_prior7),
        n(counts?.facecard_lifetime)
      ),
      active: {
        today: n(counts?.active_today),
        last7: n(counts?.active_last7),
        lifetime: n(counts?.active_lifetime)
      },
      genderActive7: {
        female: n(counts?.female_active7),
        male: n(counts?.male_active7),
        other: n(counts?.other_active7)
      },
      cities: cities.map((row) => ({
        city: row.city,
        active7: n(row.active7),
        signups7: n(row.signups7),
        femaleActive7: n(row.female_active7),
        maleActive7: n(row.male_active7)
      })),
      recentSignups,
      recentSignupsTruncated,
      d1ByDay: d1ByDay.map((row) => ({ day: row.day, returned: n(row.returned) })),
      recordedDays
    };
  }

  async citiesForUsers(userIds: string[]) {
    const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))].slice(0, 5000);
    if (ids.length === 0) {
      return { ok: true as const, cities: [] as Array<{ city: string; people: number }> };
    }

    const idList = Prisma.join(ids);
    const rows = await this.prisma.$queryRaw<Array<{ city: string; people: number }>>`
      SELECT
        ${cityLabelSql()} AS city,
        COUNT(*)::int AS people
      FROM users
      WHERE "isModerator" = false
        AND id IN (${idList})
      GROUP BY 1
      ORDER BY people DESC
      LIMIT 12
    `;

    return {
      ok: true as const,
      cities: rows.map((row) => ({ city: row.city, people: n(row.people) }))
    };
  }

  /**
   * How many of these call accounts are current non-moderator signups.
   * `activeSince` also requires a heartbeat in that window, so coverage
   * stays a share of the same people shown in the column.
   */
  async countKnownSignups(userIds: string[], activeSince: Date | null) {
    const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))].slice(0, 2000);
    if (ids.length === 0) return 0;
    const idList = Prisma.join(ids);
    const activeSql = activeSince
      ? Prisma.sql`AND "lastActiveAt" >= ${activeSince}`
      : Prisma.empty;
    const [row] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM users
      WHERE "isModerator" = false
        AND id IN (${idList})
        ${activeSql}
    `;
    return n(row?.n);
  }
}

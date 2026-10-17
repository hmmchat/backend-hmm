import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

const TZ = "Asia/Kolkata";
const REAL_MEETING_SECONDS = 120;
const BAIL_SECONDS = 15;

export type CountWindow = {
  today: number;
  last7: number;
  prior7: number;
  lifetime: number;
};

function istDayStart(daysAgo: number, now = new Date()): Date {
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

function nOrNull(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function windowOf(todayN: number, last7N: number, prior7N: number, lifetimeN: number): CountWindow {
  return { today: todayN, last7: last7N, prior7: prior7N, lifetime: lifetimeN };
}

@Injectable()
export class ProductAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const today = istDayStart(0);
    const last7 = istDayStart(6);
    const prior7 = istDayStart(13);
    const recentSince = istDayStart(21);

    const [sessions] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      WITH stays AS (
        SELECT
          s.id AS session_id,
          s."createdAt" AS created_at,
          s."isBroadcasting" AS is_broadcasting,
          GREATEST(
            EXTRACT(EPOCH FROM (COALESCE(p."leftAt", s."endedAt", NOW()) - p."joinedAt")),
            0
          ) AS stay_seconds,
          GREATEST(
            EXTRACT(EPOCH FROM (COALESCE(s."endedAt", NOW()) - COALESCE(s."startedAt", s."createdAt"))),
            0
          ) AS call_seconds
        FROM call_sessions s
        JOIN call_participants p ON p."sessionId" = s.id
      ),
      sessions AS (
        SELECT
          session_id,
          BOOL_OR(is_broadcasting) AS is_broadcasting,
          MIN(created_at) AS created_at,
          COUNT(*)::int AS participants,
          (ARRAY_AGG(stay_seconds ORDER BY stay_seconds DESC))[2] AS second_stay,
          MIN(stay_seconds) AS min_stay,
          MAX(call_seconds) AS call_seconds
        FROM stays
        GROUP BY session_id
      )
      SELECT
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 2 AND second_stay >= ${REAL_MEETING_SECONDS}
            AND created_at >= ${today}
        )::int AS real_today,
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 2 AND second_stay >= ${REAL_MEETING_SECONDS}
            AND created_at >= ${last7}
        )::int AS real_last7,
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 2 AND second_stay >= ${REAL_MEETING_SECONDS}
            AND created_at >= ${prior7} AND created_at < ${last7}
        )::int AS real_prior7,
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 2 AND second_stay >= ${REAL_MEETING_SECONDS}
        )::int AS real_lifetime,
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 1 AND created_at >= ${today}
        )::int AS calls_today,
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 1 AND created_at >= ${last7}
        )::int AS calls_last7,
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 1
            AND created_at >= ${prior7} AND created_at < ${last7}
        )::int AS calls_prior7,
        COUNT(*) FILTER (WHERE NOT is_broadcasting AND participants >= 1)::int AS calls_lifetime,
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 1 AND min_stay < ${BAIL_SECONDS}
            AND created_at >= ${today}
        )::int AS bail_today,
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 1 AND min_stay < ${BAIL_SECONDS}
            AND created_at >= ${last7}
        )::int AS bail_last7,
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 1 AND min_stay < ${BAIL_SECONDS}
            AND created_at >= ${prior7} AND created_at < ${last7}
        )::int AS bail_prior7,
        COUNT(*) FILTER (
          WHERE NOT is_broadcasting AND participants >= 1 AND min_stay < ${BAIL_SECONDS}
        )::int AS bail_lifetime,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY call_seconds) FILTER (
          WHERE NOT is_broadcasting AND participants >= 2 AND created_at >= ${today}
        ) AS median_today,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY call_seconds) FILTER (
          WHERE NOT is_broadcasting AND participants >= 2 AND created_at >= ${last7}
        ) AS median_last7,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY call_seconds) FILTER (
          WHERE NOT is_broadcasting AND participants >= 2
            AND created_at >= ${prior7} AND created_at < ${last7}
        ) AS median_prior7,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY call_seconds) FILTER (
          WHERE NOT is_broadcasting AND participants >= 2
        ) AS median_lifetime
      FROM sessions
    `;

    const [people] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      WITH qualified AS (
        SELECT s.id, s."createdAt" AS created_at
        FROM call_sessions s
        JOIN call_participants p ON p."sessionId" = s.id
        WHERE s."isBroadcasting" = false
        GROUP BY s.id, s."createdAt"
        HAVING COUNT(*) >= 2
          AND (ARRAY_AGG(
            GREATEST(EXTRACT(EPOCH FROM (COALESCE(p."leftAt", s."endedAt", NOW()) - p."joinedAt")), 0)
            ORDER BY GREATEST(EXTRACT(EPOCH FROM (COALESCE(p."leftAt", s."endedAt", NOW()) - p."joinedAt")), 0) DESC
          ))[2] >= ${REAL_MEETING_SECONDS}
      )
      SELECT
        COUNT(DISTINCT p."userId") FILTER (WHERE q.created_at >= ${today})::int AS people_today,
        COUNT(DISTINCT p."userId") FILTER (WHERE q.created_at >= ${last7})::int AS people_last7,
        COUNT(DISTINCT p."userId") FILTER (
          WHERE q.created_at >= ${prior7} AND q.created_at < ${last7}
        )::int AS people_prior7,
        COUNT(DISTINCT p."userId")::int AS people_lifetime
      FROM call_participants p
      JOIN qualified q ON q.id = p."sessionId"
    `;

    const [joined] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        COUNT(DISTINCT p."userId") FILTER (
          WHERE s."isBroadcasting" = false AND s."createdAt" >= ${today}
        )::int AS people_today,
        COUNT(DISTINCT p."userId") FILTER (
          WHERE s."isBroadcasting" = false AND s."createdAt" >= ${last7}
        )::int AS people_last7,
        COUNT(DISTINCT p."userId") FILTER (
          WHERE s."isBroadcasting" = false AND s."createdAt" >= ${prior7} AND s."createdAt" < ${last7}
        )::int AS people_prior7,
        COUNT(DISTINCT p."userId") FILTER (WHERE s."isBroadcasting" = false)::int AS people_lifetime
      FROM call_participants p
      JOIN call_sessions s ON s.id = p."sessionId"
    `;

    const qualifiedPeopleRows = await this.prisma.$queryRaw<
      Array<{ userId: string; today: boolean; last7: boolean }>
    >`
      WITH qualified AS (
        SELECT s.id, s."createdAt" AS created_at
        FROM call_sessions s
        JOIN call_participants p ON p."sessionId" = s.id
        WHERE s."isBroadcasting" = false
        GROUP BY s.id, s."createdAt"
        HAVING COUNT(*) >= 2
          AND (ARRAY_AGG(
            GREATEST(EXTRACT(EPOCH FROM (COALESCE(p."leftAt", s."endedAt", NOW()) - p."joinedAt")), 0)
            ORDER BY GREATEST(EXTRACT(EPOCH FROM (COALESCE(p."leftAt", s."endedAt", NOW()) - p."joinedAt")), 0) DESC
          ))[2] >= ${REAL_MEETING_SECONDS}
      )
      SELECT
        p."userId" AS "userId",
        BOOL_OR(q.created_at >= ${today}) AS today,
        BOOL_OR(q.created_at >= ${last7}) AS last7
      FROM call_participants p
      JOIN qualified q ON q.id = p."sessionId"
      GROUP BY p."userId"
      LIMIT 25001
    `;
    const qualifiedPeopleTruncated = qualifiedPeopleRows.length > 25000;

    const recentQualified = await this.prisma.$queryRaw<Array<{ userId: string; at: Date }>>`
      WITH qualified AS (
        SELECT s.id
        FROM call_sessions s
        JOIN call_participants p ON p."sessionId" = s.id
        WHERE s."isBroadcasting" = false
        GROUP BY s.id
        HAVING COUNT(*) >= 2
          AND (ARRAY_AGG(
            GREATEST(EXTRACT(EPOCH FROM (COALESCE(p."leftAt", s."endedAt", NOW()) - p."joinedAt")), 0)
            ORDER BY GREATEST(EXTRACT(EPOCH FROM (COALESCE(p."leftAt", s."endedAt", NOW()) - p."joinedAt")), 0) DESC
          ))[2] >= ${REAL_MEETING_SECONDS}
      )
      SELECT p."userId" AS "userId", MIN(p."joinedAt") AS at
      FROM call_participants p
      JOIN qualified q ON q.id = p."sessionId"
      WHERE p."joinedAt" >= ${recentSince}
      GROUP BY p."userId"
      ORDER BY MIN(p."joinedAt") DESC
      LIMIT 8001
    `;

    const [beam] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      WITH viewer_stays AS (
        SELECT
          v."userId" AS user_id,
          s."createdAt" AS created_at,
          GREATEST(
            EXTRACT(EPOCH FROM (COALESCE(v."leftAt", s."endedAt", NOW()) - v."joinedAt")),
            0
          ) AS stay_seconds
        FROM call_viewers v
        JOIN call_sessions s ON s.id = v."sessionId"
        WHERE s."isBroadcasting" = true
      ),
      host_rows AS (
        SELECT p."userId" AS user_id, s."createdAt" AS created_at
        FROM call_participants p
        JOIN call_sessions s ON s.id = p."sessionId"
        WHERE s."isBroadcasting" = true
      )
      SELECT
        (SELECT COUNT(DISTINCT user_id) FILTER (WHERE created_at >= ${today}) FROM host_rows)::int AS hosts_today,
        (SELECT COUNT(DISTINCT user_id) FILTER (WHERE created_at >= ${last7}) FROM host_rows)::int AS hosts_last7,
        (SELECT COUNT(DISTINCT user_id) FILTER (
          WHERE created_at >= ${prior7} AND created_at < ${last7}
        ) FROM host_rows)::int AS hosts_prior7,
        (SELECT COUNT(DISTINCT user_id) FROM host_rows)::int AS hosts_lifetime,
        (SELECT COUNT(DISTINCT user_id) FILTER (
          WHERE stay_seconds >= ${REAL_MEETING_SECONDS} AND created_at >= ${today}
        ) FROM viewer_stays)::int AS viewers_today,
        (SELECT COUNT(DISTINCT user_id) FILTER (
          WHERE stay_seconds >= ${REAL_MEETING_SECONDS} AND created_at >= ${last7}
        ) FROM viewer_stays)::int AS viewers_last7,
        (SELECT COUNT(DISTINCT user_id) FILTER (
          WHERE stay_seconds >= ${REAL_MEETING_SECONDS}
            AND created_at >= ${prior7} AND created_at < ${last7}
        ) FROM viewer_stays)::int AS viewers_prior7,
        (SELECT COUNT(DISTINCT user_id) FILTER (WHERE stay_seconds >= ${REAL_MEETING_SECONDS}) FROM viewer_stays)::int AS viewers_lifetime,
        (SELECT COALESCE(SUM(stay_seconds) FILTER (WHERE created_at >= ${today}), 0) / 3600 FROM viewer_stays) AS hours_today,
        (SELECT COALESCE(SUM(stay_seconds) FILTER (WHERE created_at >= ${last7}), 0) / 3600 FROM viewer_stays) AS hours_last7,
        (SELECT COALESCE(SUM(stay_seconds) FILTER (
          WHERE created_at >= ${prior7} AND created_at < ${last7}
        ), 0) / 3600 FROM viewer_stays) AS hours_prior7,
        (SELECT COALESCE(SUM(stay_seconds), 0) / 3600 FROM viewer_stays) AS hours_lifetime
    `;

    const rate = (bails: number, calls: number): number | null => (calls > 0 ? bails / calls : null);
    const recentTruncated = recentQualified.length > 8000;

    return {
      ok: true as const,
      generatedAt: new Date().toISOString(),
      realMeetingSessions: windowOf(
        n(sessions?.real_today),
        n(sessions?.real_last7),
        n(sessions?.real_prior7),
        n(sessions?.real_lifetime)
      ),
      realMeetingPeople: windowOf(
        n(people?.people_today),
        n(people?.people_last7),
        n(people?.people_prior7),
        n(people?.people_lifetime)
      ),
      callsJoinedPeople: windowOf(
        n(joined?.people_today),
        n(joined?.people_last7),
        n(joined?.people_prior7),
        n(joined?.people_lifetime)
      ),
      bailRate: {
        today: rate(n(sessions?.bail_today), n(sessions?.calls_today)),
        last7: rate(n(sessions?.bail_last7), n(sessions?.calls_last7)),
        prior7: rate(n(sessions?.bail_prior7), n(sessions?.calls_prior7)),
        lifetime: rate(n(sessions?.bail_lifetime), n(sessions?.calls_lifetime))
      },
      medianCallSeconds: {
        today: nOrNull(sessions?.median_today),
        last7: nOrNull(sessions?.median_last7),
        prior7: nOrNull(sessions?.median_prior7),
        lifetime: nOrNull(sessions?.median_lifetime)
      },
      beamTv: {
        hosts: windowOf(
          n(beam?.hosts_today),
          n(beam?.hosts_last7),
          n(beam?.hosts_prior7),
          n(beam?.hosts_lifetime)
        ),
        qualifiedViewers: windowOf(
          n(beam?.viewers_today),
          n(beam?.viewers_last7),
          n(beam?.viewers_prior7),
          n(beam?.viewers_lifetime)
        ),
        watchHours: {
          today: n(beam?.hours_today),
          last7: n(beam?.hours_last7),
          prior7: n(beam?.hours_prior7),
          lifetime: n(beam?.hours_lifetime)
        }
      },
      recentQualified: recentQualified.slice(0, 8000).map((row) => ({
        userId: row.userId,
        at: new Date(row.at).toISOString()
      })),
      recentQualifiedTruncated: recentTruncated,
      qualifiedPeople: qualifiedPeopleRows.slice(0, 25000).map((row) => ({
        userId: row.userId,
        today: Boolean(row.today),
        last7: Boolean(row.last7)
      })),
      qualifiedPeopleTruncated
    };
  }
}

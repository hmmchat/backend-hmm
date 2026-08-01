import test from "node:test";
import assert from "node:assert/strict";
import { buildReportAwareDiscoveryFilters } from "../src/config/discovery-pool-filters.js";

const baseArgs = {
  city: "Mumbai" as string | null,
  statuses: ["AVAILABLE"] as ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[],
  limit: 50
};

test("disguised moderator only requests critical-review pool", () => {
  const { filters, poolMode } = buildReportAwareDiscoveryFilters({
    ...baseArgs,
    requester: { isModerator: true, moderatorFaceCardActive: false }
  });
  assert.equal(filters.onlyCriticalReview, true);
  assert.equal(filters.moderatorWorkQueue, undefined);
  assert.ok(poolMode);
});

test("show-as-moderator requests work queue (needs KYC ∪ T1–T3)", () => {
  const { filters, poolMode } = buildReportAwareDiscoveryFilters({
    ...baseArgs,
    requester: { isModerator: true, moderatorFaceCardActive: true }
  });
  assert.equal(filters.moderatorWorkQueue, true);
  assert.equal(filters.excludeModerators, true);
  assert.equal(filters.onlyCriticalReview, undefined);
  assert.deepEqual(poolMode, { mode: "normal" });
});

test("normal user does not get moderatorWorkQueue", () => {
  const { filters } = buildReportAwareDiscoveryFilters({
    ...baseArgs,
    requester: { isModerator: false, reportCount: 0 }
  });
  assert.equal(filters.moderatorWorkQueue, undefined);
  assert.equal(filters.onlyCriticalReview, undefined);
});

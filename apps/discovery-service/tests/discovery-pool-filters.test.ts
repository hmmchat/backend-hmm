import test from "node:test";
import assert from "node:assert/strict";
import {
  applyReportPoolBucket,
  buildReportAwareDiscoveryFilters,
} from "../src/config/discovery-pool-filters.js";
import {
  canPairForMatchmaking,
  keepDiscoveryCandidate,
} from "../src/config/report-pool.config.js";
import { cardReportLayer, getDiscoveryReportLayerConfig } from "../src/config/report-layers.config.js";

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
  assert.equal(filters.excludeCriticalReview, undefined);
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
  assert.equal(filters.excludeCriticalReview, true);
});

test("critical review only requests hidden moderators and stays out of other decks", () => {
  const { filters, poolMode } = buildReportAwareDiscoveryFilters({
    ...baseArgs,
    requester: { criticalReviewActive: true, isModerator: false }
  });
  assert.deepEqual(poolMode, { mode: "critical_disguise" });
  assert.equal(filters.onlyModerators, true);
  assert.equal(filters.moderatorVisibility, "show_as_user");
  assert.equal(filters.excludeCriticalReview, true);
});

test("critical review pairs only with a hidden moderator", () => {
  const reviewed = { criticalReviewActive: true, isModerator: false };
  const hiddenMod = { isModerator: true, moderatorFaceCardActive: false };
  const normal = { isModerator: false, criticalReviewActive: false };
  const visibleMod = { isModerator: true, moderatorFaceCardActive: true };

  assert.equal(canPairForMatchmaking(reviewed, hiddenMod), true);
  assert.equal(canPairForMatchmaking(reviewed, normal), false);
  assert.equal(canPairForMatchmaking(reviewed, visibleMod), false);
  assert.equal(canPairForMatchmaking(hiddenMod, normal), false);
  assert.equal(canPairForMatchmaking(normal, normal), true);

  assert.equal(keepDiscoveryCandidate(hiddenMod, reviewed), true);
  assert.equal(keepDiscoveryCandidate(normal, reviewed), false);
  assert.equal(keepDiscoveryCandidate(reviewed, normal), false);
  assert.equal(keepDiscoveryCandidate(reviewed, hiddenMod), true);
  assert.equal(keepDiscoveryCandidate(normal, hiddenMod), false);
});

test("critical review facecard uses the strongest report glow", () => {
  const cfg = getDiscoveryReportLayerConfig();
  assert.equal(cardReportLayer(0, cfg, true), 3);
  assert.equal(cardReportLayer(10, cfg, true), 3);
  assert.equal(cardReportLayer(0, cfg, false), 0);
});
test("score_mix falls back when preferred bucket is empty", () => {
  const users = [
    { id: "u1", isModerator: false, moderatorFaceCardActive: false },
  ];
  // Force mod bucket preference with ratio 1 — only normals exist, so fall back.
  const out = applyReportPoolBucket(users, {
    mode: "score_mix",
    modRatio: 1,
    reportLayer: 3,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "u1");
});

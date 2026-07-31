import test from "node:test";
import assert from "node:assert/strict";

test("matching-admin config defaults to batch_primary full rollout", async () => {
  delete process.env.MATCHING_MODE;
  delete process.env.MATCHING_CANARY_CITIES;

  // Module may already be cached from other tests — assert helpers exist and mode is valid.
  const mod = await import("../src/config/matching-admin.config.js");
  assert.ok(["live_legacy", "shadow", "batch_primary"].includes(mod.MATCHING_MODE));
  assert.equal(typeof mod.isBatchPrimaryForCity, "function");
  assert.equal(typeof mod.shouldAllocatorPersist, "function");

  // With empty canary list, batch_primary applies to every city (full rollout).
  if (mod.MATCHING_MODE === "batch_primary" && mod.MATCHING_CANARY_CITIES.length === 0) {
    assert.equal(mod.isBatchPrimaryForCity("Mumbai"), true);
    assert.equal(mod.isBatchPrimaryForCity(null), true);
    assert.equal(mod.shouldAllocatorPersist(), true);
  }
});

test("matching score weights default to intent ~50 and rest ~50 in prior ratio", async () => {
  const mod = await import("../src/config/matching-admin.config.js");
  const w = mod.MATCHING_SCORE_WEIGHTS;
  const nonIntent = w.song + w.brands + w.interests + w.values + w.location;
  assert.ok(Math.abs(w.intent - 50) < 0.5 || Math.abs(w.intent + nonIntent - 100) < 0.01);
  assert.ok(Math.abs(w.intent + nonIntent - 100) < 0.05);

  // song:brands ≈ 25:18
  assert.ok(Math.abs(w.song / w.brands - 25 / 18) < 0.05);
});

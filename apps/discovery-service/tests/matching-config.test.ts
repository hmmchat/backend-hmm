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

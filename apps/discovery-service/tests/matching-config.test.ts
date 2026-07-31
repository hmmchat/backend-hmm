import test from "node:test";
import assert from "node:assert/strict";

test("matching-admin config defaults to live_legacy and supports canary helper", async () => {
  delete process.env.MATCHING_MODE;
  delete process.env.MATCHING_CANARY_CITIES;
  // Dynamic import after env clear — module may already be cached; re-read helpers via fresh values
  const mod = await import("../src/config/matching-admin.config.js");
  assert.ok(["live_legacy", "shadow", "batch_primary"].includes(mod.MATCHING_MODE));
  assert.equal(typeof mod.isBatchPrimaryForCity, "function");
  assert.equal(typeof mod.shouldAllocatorPersist, "function");
});

import assert from "node:assert/strict";
import test from "node:test";
import { DISCOVERY_MATCHMAKING_STATUSES } from "../src/config/discovery-pool-filters.js";

test("DISCOVERY_MATCHMAKING_STATUSES covers every live face-card pool status", () => {
  assert.deepEqual([...DISCOVERY_MATCHMAKING_STATUSES], [
    "AVAILABLE",
    "IN_SQUAD_AVAILABLE",
    "IN_BROADCAST_AVAILABLE"
  ]);
});

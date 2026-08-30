import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDiscoveryPoolCity,
  sameDiscoveryPoolCity,
  shouldOfferAutoCityHandoff,
  countImmobileDiscoveryUsers,
  rankShowableCities,
  SESSION_DISCOVERY_POOL_ANYWHERE
} from "../src/config/discovery-pool-city.js";

test("normalizeDiscoveryPoolCity - anywhere variants → null", () => {
  assert.equal(normalizeDiscoveryPoolCity(null), null);
  assert.equal(normalizeDiscoveryPoolCity(""), null);
  assert.equal(normalizeDiscoveryPoolCity("ANYWHERE_IN_INDIA"), null);
  assert.equal(normalizeDiscoveryPoolCity(SESSION_DISCOVERY_POOL_ANYWHERE), null);
});

test("normalizeDiscoveryPoolCity - real cities lowercase", () => {
  assert.equal(normalizeDiscoveryPoolCity("Bengaluru"), "bengaluru");
  assert.equal(normalizeDiscoveryPoolCity(" Jamshedpur "), "jamshedpur");
});

test("sameDiscoveryPoolCity - same city yes, cross-city no", () => {
  assert.equal(sameDiscoveryPoolCity("Bengaluru", "bengaluru"), true);
  assert.equal(sameDiscoveryPoolCity("Jamshedpur", "Bengaluru"), false);
  assert.equal(sameDiscoveryPoolCity("Jamshedpur", null), false);
  assert.equal(sameDiscoveryPoolCity(null, null), true);
  assert.equal(sameDiscoveryPoolCity("ANYWHERE_IN_INDIA", "*"), true);
});

test("shouldOfferAutoCityHandoff - Bangalore↔Delhi alone is one-sided", () => {
  // Lexicographically earlier city hosts; later city visits.
  assert.equal(
    shouldOfferAutoCityHandoff("Delhi", { city: "Bangalore", availableCount: 1 }),
    true,
  );
  assert.equal(
    shouldOfferAutoCityHandoff("Bangalore", { city: "Delhi", availableCount: 1 }),
    false,
  );
  assert.equal(
    shouldOfferAutoCityHandoff("Bengaluru", { city: "Delhi", availableCount: 1 }),
    false,
  );
});

test("shouldOfferAutoCityHandoff - fuller destinations always allowed", () => {
  assert.equal(
    shouldOfferAutoCityHandoff("Bangalore", { city: "Delhi", availableCount: 3 }),
    true,
  );
  assert.equal(
    shouldOfferAutoCityHandoff(null, { city: "Delhi", availableCount: 1 }),
    true,
  );
});

test("countImmobileDiscoveryUsers - pull-stranger and beamcast only", () => {
  assert.equal(
    countImmobileDiscoveryUsers([
      { status: "AVAILABLE" },
      { status: "IN_SQUAD_AVAILABLE" },
      { status: "IN_BROADCAST_AVAILABLE" },
      { status: "MATCHED" }
    ]),
    2
  );
  assert.equal(countImmobileDiscoveryUsers([]), 0);
});

test("shouldOfferAutoCityHandoff - immobile pull-stranger host is always visitable", () => {
  // Delhi empty + lone Mumbai pull-stranger host: Delhi must hop even though
  // delhi < mumbai (the lexico singleton rule would otherwise block it).
  assert.equal(
    shouldOfferAutoCityHandoff("Delhi", {
      city: "Mumbai",
      availableCount: 1,
      immobileCount: 1,
    }),
    true,
  );
  assert.equal(
    shouldOfferAutoCityHandoff("Mumbai", {
      city: "Delhi",
      availableCount: 1,
      immobileCount: 1,
    }),
    true,
  );
  // Same singleton without an in-call host still uses the lexico rule.
  assert.equal(
    shouldOfferAutoCityHandoff("Delhi", {
      city: "Mumbai",
      availableCount: 1,
      immobileCount: 0,
    }),
    false,
  );
});

test("shouldOfferAutoCityHandoff - Anywhere dest is a real city hop", () => {
  assert.equal(
    shouldOfferAutoCityHandoff("Jamshedpur", {
      city: "ANYWHERE_IN_INDIA",
      availableCount: 1,
      immobileCount: 1,
    }),
    true,
  );
  assert.equal(
    shouldOfferAutoCityHandoff("Delhi", {
      city: "ANYWHERE_IN_INDIA",
      availableCount: 1,
      immobileCount: 0,
    }),
    true,
  );
  assert.equal(
    shouldOfferAutoCityHandoff("ANYWHERE_IN_INDIA", {
      city: "ANYWHERE_IN_INDIA",
      availableCount: 1,
      immobileCount: 1,
    }),
    true,
  );
});

test("rankShowableCities - immobile host city outranks a fuller solo city", () => {
  const ranked = rankShowableCities([
    { city: "Bangalore", label: "Bangalore", availableCount: 5, immobileCount: 0 },
    { city: "Mumbai", label: "Mumbai", availableCount: 1, immobileCount: 1 },
    { city: "Pune", label: "Pune", availableCount: 3, immobileCount: 0 },
  ]);
  assert.equal(ranked[0].city, "Mumbai");
  assert.equal(ranked[1].city, "Bangalore");
  assert.equal(ranked[2].city, "Pune");
});

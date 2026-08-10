import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDiscoveryPoolCity,
  sameDiscoveryPoolCity,
  shouldOfferAutoCityHandoff,
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

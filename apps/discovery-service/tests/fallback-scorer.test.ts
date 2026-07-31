import test from "node:test";
import assert from "node:assert/strict";
import { FallbackScorerService } from "../src/services/fallback-scorer.service.js";

test("FallbackScorerService - exact song and brand overlap", () => {
  const scorer = new FallbackScorerService();
  const score = scorer.score(
    {
      userId: "a",
      intent: "gym buddy",
      musicPreferenceId: "song1",
      brandIds: ["b1", "b2"],
      interestIds: ["i1"],
      valueIds: ["v1"],
      city: "Mumbai"
    },
    {
      userId: "b",
      intent: "gym buddy",
      musicPreferenceId: "song1",
      brandIds: ["b1"],
      interestIds: ["i1"],
      valueIds: ["v1"],
      city: "Mumbai"
    }
  );
  assert.ok(score >= 70);
});

test("FallbackScorerService - empty profiles score zero", () => {
  const scorer = new FallbackScorerService();
  const score = scorer.score(
    { userId: "a", brandIds: [], interestIds: [], valueIds: [] },
    { userId: "b", brandIds: [], interestIds: [], valueIds: [] }
  );
  assert.equal(score, 0);
});

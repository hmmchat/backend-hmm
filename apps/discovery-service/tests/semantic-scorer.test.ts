import test from "node:test";
import assert from "node:assert/strict";
import { SemanticScorerService } from "../src/services/semantic-scorer.service.js";
import { FallbackScorerService } from "../src/services/fallback-scorer.service.js";

function unit(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

test("SemanticScorerService - hosted vectors use cosine for intent weight", async () => {
  const features = new Map<string, any>([
    [
      "u1",
      {
        userId: "u1",
        vector: unit([1, 0, 0]),
        checksum: "a",
        version: 1,
        provider: "hosted"
      }
    ],
    [
      "u2",
      {
        userId: "u2",
        vector: unit([1, 0, 0]),
        checksum: "b",
        version: 1,
        provider: "hosted"
      }
    ]
  ]);

  const prisma = {
    userFeature: {
      findMany: async ({ where }: any) =>
        (where.userId.in as string[]).map((id) => features.get(id)).filter(Boolean)
    }
  };

  process.env.MATCHING_SEMANTIC_ENABLED = "true";
  const scorer = new SemanticScorerService(prisma as any, new FallbackScorerService());
  const score = await scorer.score(
    {
      userId: "u1",
      intent: "looking for gym buddy",
      brandIds: [],
      interestIds: [],
      valueIds: []
    },
    {
      userId: "u2",
      intent: "want a workout partner",
      brandIds: [],
      interestIds: [],
      valueIds: []
    }
  );

  // Identical unit vectors → cosine 1 → full intent weight (default 50)
  const { MATCHING_SCORE_WEIGHTS } = await import("../src/config/matching-admin.config.js");
  assert.equal(score, Math.round(MATCHING_SCORE_WEIGHTS.intent));
});

test("SemanticScorerService - fallback provider does not use cosine", async () => {
  const features = new Map<string, any>([
    [
      "u1",
      {
        userId: "u1",
        vector: unit([1, 0, 0]),
        checksum: "a",
        version: 1,
        provider: "fallback"
      }
    ],
    [
      "u2",
      {
        userId: "u2",
        vector: unit([1, 0, 0]),
        checksum: "b",
        version: 1,
        provider: "fallback"
      }
    ]
  ]);

  const prisma = {
    userFeature: {
      findMany: async ({ where }: any) =>
        (where.userId.in as string[]).map((id) => features.get(id)).filter(Boolean)
    }
  };

  const scorer = new SemanticScorerService(prisma as any, new FallbackScorerService());
  const score = await scorer.score(
    {
      userId: "u1",
      intent: "looking for gym buddy",
      brandIds: [],
      interestIds: [],
      valueIds: []
    },
    {
      userId: "u2",
      intent: "want a workout partner",
      brandIds: [],
      interestIds: [],
      valueIds: []
    }
  );

  // Lexical paraphrase miss → intent contribution ~0
  assert.ok(score < 15, `fallback must not treat hash vectors as semantic, got ${score}`);
});

test("SemanticScorerService - preload merges full batch without early exit", async () => {
  const calls: string[][] = [];
  const prisma = {
    userFeature: {
      findMany: async ({ where }: any) => {
        calls.push(where.userId.in);
        return (where.userId.in as string[]).map((id: string) => ({
          userId: id,
          vector: unit([1, 0]),
          checksum: id,
          version: 1,
          provider: "hosted"
        }));
      }
    }
  };

  const scorer = new SemanticScorerService(prisma as any, new FallbackScorerService());
  await scorer.preloadFeatures(["a", "b"]);
  await scorer.preloadFeatures(["a", "b", "c", "d"]);
  assert.ok(calls.length >= 2);
  assert.ok(calls[1].includes("c") && calls[1].includes("d"));
});

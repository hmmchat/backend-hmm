import test from "node:test";
import assert from "node:assert/strict";
import { BatchAllocatorService } from "../src/services/batch-allocator.service.js";
import { FallbackScorerService } from "../src/services/fallback-scorer.service.js";

function makeAllocator(): BatchAllocatorService {
  return new BatchAllocatorService(
    {} as any,
    { get: async () => null, set: async () => {}, del: async () => {} } as any,
    {} as any,
    {} as any,
    {} as any
  );
}

test("BatchAllocatorService - allocate with no pairs returns empty", () => {
  const allocator = makeAllocator();
  assert.deepEqual(allocator.allocate([]), []);
});

test("BatchAllocatorService - allocate picks highest scoring non-conflicting pairs", () => {
  const allocator = makeAllocator();
  const pairs = [
    { user1: "a", user2: "b", score: 100 },
    { user1: "a", user2: "c", score: 50 },
    { user1: "b", user2: "c", score: 80 }
  ];
  allocator.setPairScoreMapForTest(pairs);
  const result = allocator.allocate(pairs);
  assert.equal(result.length, 1);
  assert.equal(result[0].user1, "a");
  assert.equal(result[0].user2, "b");
  assert.equal(result[0].score, 100);
});

test("BatchAllocatorService - allocate with non-conflicting pairs", () => {
  const allocator = makeAllocator();
  const pairs = [
    { user1: "a", user2: "b", score: 100 },
    { user1: "c", user2: "d", score: 80 },
    { user1: "e", user2: "f", score: 60 }
  ];
  allocator.setPairScoreMapForTest(pairs);
  const result = allocator.allocate(pairs);
  assert.equal(result.length, 3);
});

test("BatchAllocatorService - 2-opt improves total score", () => {
  const allocator = makeAllocator();
  // Greedy: a-b(100) + c-d(50) = 150
  // Better: a-c(80) + b-d(80) = 160
  const allPairs = [
    { user1: "a", user2: "b", score: 100 },
    { user1: "c", user2: "d", score: 50 },
    { user1: "a", user2: "c", score: 80 },
    { user1: "b", user2: "d", score: 80 },
    { user1: "a", user2: "d", score: 10 },
    { user1: "b", user2: "c", score: 10 }
  ];
  allocator.setPairScoreMapForTest(allPairs);
  // Feed greedy in score order so it picks a-b then c-d first
  const greedyOrder = [
    { user1: "a", user2: "b", score: 100 },
    { user1: "c", user2: "d", score: 50 },
    { user1: "a", user2: "c", score: 80 },
    { user1: "b", user2: "d", score: 80 }
  ];
  const result = allocator.allocate(greedyOrder);
  const total = result.reduce((s, m) => s + m.score, 0);
  assert.equal(result.length, 2);
  assert.ok(total >= 150, `expected improved or equal total, got ${total}`);
  // With working 2-opt, should reach 160
  assert.equal(total, 160);
});

test("FallbackScorerService - paraphrase without shared tokens scores low", () => {
  const fallback = new FallbackScorerService();
  const score = fallback.intentOverlap("looking for a gym buddy", "want a workout partner");
  assert.ok(score < 0.5, `lexical should miss paraphrase, got ${score}`);
});

test("FallbackScorerService - shared tokens score higher", () => {
  const fallback = new FallbackScorerService();
  const score = fallback.intentOverlap("looking for gym buddy", "looking for gym partner");
  assert.ok(score > 0.3, `expected token overlap, got ${score}`);
});

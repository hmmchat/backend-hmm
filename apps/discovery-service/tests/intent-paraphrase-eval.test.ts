import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { FallbackScorerService } from "../src/services/fallback-scorer.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/intent-paraphrase-eval.json"), "utf8")
);

test("intent paraphrase eval fixture is well-formed", () => {
  assert.ok(Array.isArray(fixture.pairs));
  assert.ok(fixture.pairs.length >= 20);
  for (const p of fixture.pairs) {
    assert.ok(p.a && p.b);
    assert.ok(["should_match", "borderline", "should_not"].includes(p.label));
  }
});

test("lexical baseline misses many should_match paraphrases (why semantic is needed)", () => {
  const fallback = new FallbackScorerService();
  const shouldMatch = fixture.pairs.filter((p: any) => p.label === "should_match");
  let misses = 0;
  for (const p of shouldMatch) {
    const score = fallback.intentOverlap(p.a, p.b);
    if (score < 0.25) misses++;
  }
  const missRate = misses / shouldMatch.length;
  assert.ok(
    missRate >= (fixture.gates?.minShouldMatchLexicalMissRate ?? 0.5),
    `expected lexical to miss paraphrases (missRate=${missRate})`
  );
});

test("lexical baseline keeps should_not pairs low", () => {
  const fallback = new FallbackScorerService();
  const shouldNot = fixture.pairs.filter((p: any) => p.label === "should_not");
  for (const p of shouldNot) {
    const score = fallback.intentOverlap(p.a, p.b);
    assert.ok(score < 0.35, `"${p.a}" vs "${p.b}" scored ${score}`);
  }
});

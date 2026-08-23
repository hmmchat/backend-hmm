/**
 * Smoke-check coin mining accrual math (no DB).
 * Run: node scripts/smoke-coin-mining-math.mjs
 */

function applyElapsed(remainder, elapsedSeconds, thresholdSeconds, rewardPerChunk) {
  if (elapsedSeconds <= 0) return { coinsCredited: 0, chunks: 0, remainder };
  const total = remainder + elapsedSeconds;
  const chunks = Math.floor(total / thresholdSeconds);
  return {
    coinsCredited: chunks * rewardPerChunk,
    chunks,
    remainder: total % thresholdSeconds
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const THRESHOLD = 15 * 60; // 15 min
const BROADCAST = 15;
const CALL = 10;
const VIEWER = 5;

// Partial session banks remainder
{
  const r = applyElapsed(0, 7 * 60, THRESHOLD, BROADCAST);
  assert(r.coinsCredited === 0 && r.remainder === 7 * 60, "7 min should bank remainder");
}

// Cross threshold across sessions
{
  const mid = applyElapsed(7 * 60, 8 * 60, THRESHOLD, BROADCAST);
  assert(mid.chunks === 1 && mid.coinsCredited === BROADCAST && mid.remainder === 0, "7+8 min broadcast → 15 coins");
}

// Cumulative across calls, not per-call (8 min + 2 min at a 10-min threshold)
{
  const mid = applyElapsed(8 * 60, 2 * 60, 10 * 60, CALL);
  assert(mid.chunks === 1 && mid.coinsCredited === CALL && mid.remainder === 0, "8+2 min call → credit");
}

// Mid-session multi-chunk
{
  const r = applyElapsed(0, 45 * 60, THRESHOLD, CALL);
  assert(r.chunks === 3 && r.coinsCredited === 3 * CALL && r.remainder === 0, "45 min call → 30 coins");
}

// Leftover persists
{
  const r = applyElapsed(0, 16 * 60, THRESHOLD, VIEWER);
  assert(r.chunks === 1 && r.coinsCredited === VIEWER && r.remainder === 60, "16 min viewer → 5 coins + 60s left");
}

// Exclusive buckets: independent remainders (simulated)
{
  const b = applyElapsed(100, 0, THRESHOLD, BROADCAST);
  const c = applyElapsed(200, 0, THRESHOLD, CALL);
  assert(b.remainder === 100 && c.remainder === 200, "bucket remainders independent");
}

console.log("✅ coin mining math smoke checks passed");

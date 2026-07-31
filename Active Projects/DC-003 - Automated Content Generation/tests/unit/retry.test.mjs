import test from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../../src/retry.mjs";

test("succeeds immediately on the first attempt without retrying", async () => {
  let calls = 0;
  const outcome = await withRetry(async () => {
    calls += 1;
    return { ok: true, value: "done" };
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.attemptCount, 1);
  assert.equal(calls, 1);
});

test("succeeds on the second attempt after the first fails", async () => {
  let calls = 0;
  const outcome = await withRetry(async () => {
    calls += 1;
    if (calls === 1) return { ok: false, message: "first attempt fails" };
    return { ok: true, value: "done" };
  }, { maxAttempts: 3 });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.attemptCount, 2);
  assert.equal(calls, 2, "must stop retrying immediately once an attempt succeeds");
  assert.equal(outcome.attempts.length, 2);
});

test("fails after exhausting the configured retry limit", async () => {
  let calls = 0;
  const outcome = await withRetry(async () => {
    calls += 1;
    return { ok: false, message: `attempt ${calls} fails` };
  }, { maxAttempts: 4 });

  assert.equal(outcome.ok, false);
  assert.equal(calls, 4, "must retry exactly maxAttempts times, no more and no fewer");
  assert.equal(outcome.attempts.length, 4);
  assert.equal(outcome.attemptCount, 4);
});

test("every failed attempt is preserved in order, not just the last one", async () => {
  const outcome = await withRetry(async (n) => ({ ok: false, message: `fail ${n}` }), { maxAttempts: 3 });
  assert.deepEqual(
    outcome.attempts.map((a) => a.message),
    ["fail 1", "fail 2", "fail 3"]
  );
});

test("defaults to 3 attempts when maxAttempts isn't given", async () => {
  let calls = 0;
  await withRetry(async () => {
    calls += 1;
    return { ok: false };
  });
  assert.equal(calls, 3);
});

test("rejects an invalid maxAttempts up front", async () => {
  await assert.rejects(() => withRetry(async () => ({ ok: true }), { maxAttempts: 0 }), RangeError);
  await assert.rejects(() => withRetry(async () => ({ ok: true }), { maxAttempts: -1 }), RangeError);
});

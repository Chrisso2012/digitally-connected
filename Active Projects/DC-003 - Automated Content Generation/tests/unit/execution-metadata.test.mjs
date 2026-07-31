import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionMetadata, generateExecutionId } from "../../src/execution-metadata.mjs";

test("creates a well-formed, immutable ExecutionMetadata with explicit fields", () => {
  const metadata = createExecutionMetadata({
    executionId: "exec_20260731_abc123def456",
    renderedAt: "2026-07-31T02:11:12.000Z",
    provider: "templated-http",
    renderDurationMs: 20570,
  });

  assert.deepEqual(metadata, {
    executionId: "exec_20260731_abc123def456",
    renderedAt: "2026-07-31T02:11:12.000Z",
    provider: "templated-http",
    renderDurationMs: 20570,
  });
  assert.throws(() => {
    metadata.provider = "tampered";
  }, TypeError);
});

test("generates executionId and renderedAt automatically when omitted", () => {
  const fixedNow = () => new Date("2026-08-01T00:00:00.000Z");
  const metadata = createExecutionMetadata({ provider: "mock-transport", renderDurationMs: 100 }, { now: fixedNow });

  assert.match(metadata.executionId, /^exec_20260801_[a-f0-9]{12}$/);
  assert.equal(metadata.renderedAt, "2026-08-01T00:00:00.000Z");
});

test("generateExecutionId produces the documented exec_YYYYMMDD_<id> shape", () => {
  const id = generateExecutionId(() => new Date("2026-01-05T00:00:00.000Z"));
  assert.match(id, /^exec_20260105_[a-f0-9]{12}$/);
});

test("two calls to generateExecutionId produce different IDs (trace-identity uniqueness)", () => {
  const now = () => new Date("2026-08-01T00:00:00.000Z");
  const first = generateExecutionId(now);
  const second = generateExecutionId(now);
  assert.notEqual(first, second);
});

test("throws TypeError for a missing provider", () => {
  assert.throws(() => createExecutionMetadata({ renderDurationMs: 100 }), TypeError);
});

test("throws TypeError for a blank provider", () => {
  assert.throws(() => createExecutionMetadata({ provider: "   ", renderDurationMs: 100 }), TypeError);
});

test("throws TypeError for a missing renderDurationMs", () => {
  assert.throws(() => createExecutionMetadata({ provider: "mock-transport" }), TypeError);
});

test("throws TypeError for a negative renderDurationMs", () => {
  assert.throws(() => createExecutionMetadata({ provider: "mock-transport", renderDurationMs: -1 }), TypeError);
});

test("throws TypeError for a non-numeric renderDurationMs", () => {
  assert.throws(() => createExecutionMetadata({ provider: "mock-transport", renderDurationMs: "100" }), TypeError);
});

test("throws TypeError for an executionId that doesn't match the documented pattern", () => {
  assert.throws(
    () =>
      createExecutionMetadata({
        executionId: "not-a-valid-id",
        provider: "mock-transport",
        renderDurationMs: 100,
      }),
    TypeError
  );
});

test("throws TypeError for a renderedAt that isn't a valid date-time string", () => {
  assert.throws(
    () =>
      createExecutionMetadata({
        renderedAt: "not-a-date",
        provider: "mock-transport",
        renderDurationMs: 100,
      }),
    TypeError
  );
});

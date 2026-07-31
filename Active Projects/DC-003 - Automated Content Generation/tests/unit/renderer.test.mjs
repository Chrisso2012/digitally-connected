import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderTemplatedPayload } from "../../src/renderer.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import {
  RendererError,
  AuthenticationError,
  RenderRejected,
  ValidationError,
  RetryLimitExceeded,
} from "../../src/renderer-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAYLOAD_FIXTURE = path.join(__dirname, "..", "fixtures", "templated-payload.example.json");

function loadPayload() {
  return JSON.parse(readFileSync(PAYLOAD_FIXTURE, "utf-8"));
}

// --- Successful render (mock) -------------------------------------------

test("a successful render (mock) returns a well-formed, immutable RenderResult", async () => {
  const payload = loadPayload();
  const result = await renderTemplatedPayload(payload, { transport: createMockTransport() });

  assert.equal(result.status, "completed");
  assert.equal(result.templateId, payload.template_id);
  assert.equal(result.slideType, payload.slide_type);
  assert.equal(result.provider, "mock-transport");
  assert.equal(typeof result.imageUrl, "string");
  assert.throws(() => {
    result.status = "tampered";
  }, TypeError);
});

test("the renderer never leaks the raw transport response — only documented RenderResult fields exist", async () => {
  const result = await renderTemplatedPayload(loadPayload(), { transport: createMockTransport() });
  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, [
    "completedAt",
    "durationMs",
    "imageUrl",
    "provider",
    "renderId",
    "requestedAt",
    "slideType",
    "status",
    "templateId",
  ]);
});

// --- Timeout --------------------------------------------------------------

test("a timeout is retried and eventually raises RetryLimitExceeded when it never recovers", async () => {
  const transport = createMockTransport({ mode: "timeout" });
  await assert.rejects(
    () => renderTemplatedPayload(loadPayload(), { transport, maxAttempts: 2, timeoutMs: 100 }),
    (error) => {
      assert.ok(error instanceof RetryLimitExceeded);
      assert.equal(error.attempts.length, 2);
      assert.ok(error.attempts.every((a) => a.error.name === "TimeoutError"));
      return true;
    }
  );
  assert.equal(transport.callCount(), 2);
});

// --- Retry exhaustion (general) -------------------------------------------

test("retry exhaustion calls the transport exactly maxAttempts times, no more and no fewer", async () => {
  const transport = createMockTransport({ mode: "transport-error" });
  await assert.rejects(
    () => renderTemplatedPayload(loadPayload(), { transport, maxAttempts: 4 }),
    RetryLimitExceeded
  );
  assert.equal(transport.callCount(), 4);
});

test("retry succeeds after transient transport failures, stopping as soon as it does", async () => {
  const transport = createMockTransport({ failuresBeforeSuccess: 2 });
  const result = await renderTemplatedPayload(loadPayload(), { transport, maxAttempts: 5 });
  assert.equal(result.status, "completed");
  assert.equal(transport.callCount(), 3, "must stop retrying immediately once an attempt succeeds");
});

// --- Transport failure ------------------------------------------------------

test("a transport failure is retried and reported with the underlying TransportError preserved", async () => {
  const transport = createMockTransport({ mode: "transport-error" });
  try {
    await renderTemplatedPayload(loadPayload(), { transport, maxAttempts: 2 });
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof RetryLimitExceeded);
    for (const attempt of error.attempts) {
      assert.equal(attempt.error.name, "TransportError");
    }
  }
});

// --- Malformed response / validation failure (hardened after the
// DC-003-I006 live-verification incident: this used to be retryable and
// fired three live calls instead of one) -------------------------------

test("a malformed response fails after exactly ONE transport call — NOT retried", async () => {
  const transport = createMockTransport({ mode: "malformed" });
  await assert.rejects(
    () => renderTemplatedPayload(loadPayload(), { transport, maxAttempts: 5 }),
    ValidationError
  );
  assert.equal(
    transport.callCount(),
    1,
    "a deterministic response-shape mismatch must never be retried, even with room left in maxAttempts"
  );
});

test("hardening regression check: only TimeoutError and TransportError are retried; every other failure stops at one attempt", async () => {
  const nonRetryableModes = ["malformed", "rejected", "auth-error"];
  for (const mode of nonRetryableModes) {
    const transport = createMockTransport({ mode });
    await assert.rejects(() => renderTemplatedPayload(loadPayload(), { transport, maxAttempts: 5 }));
    assert.equal(transport.callCount(), 1, `mode "${mode}" must fail after exactly one transport call`);
  }

  // Sanity check the other half of the same guarantee: genuinely transient
  // failures still retry normally — the hardening must not have collapsed
  // retry behavior across the board.
  const retryableTransport = createMockTransport({ mode: "timeout" });
  await assert.rejects(() => renderTemplatedPayload(loadPayload(), { transport: retryableTransport, maxAttempts: 3 }));
  assert.equal(retryableTransport.callCount(), 3, "TimeoutError must still retry up to maxAttempts");
});

// --- Validation failure (well-formed-but-rejected response) -----------------

test("a well-formed rejected render (RenderRejected) is NOT retried — fails on the first attempt", async () => {
  const transport = createMockTransport({ mode: "rejected" });
  await assert.rejects(
    () => renderTemplatedPayload(loadPayload(), { transport, maxAttempts: 5 }),
    RenderRejected
  );
  assert.equal(transport.callCount(), 1, "a rejected render must not be retried");
});

// --- Authentication failure (mock) -------------------------------------------

test("an authentication failure is NOT retried — fails on the first attempt", async () => {
  const transport = createMockTransport({ mode: "auth-error" });
  await assert.rejects(
    () => renderTemplatedPayload(loadPayload(), { transport, maxAttempts: 5 }),
    AuthenticationError
  );
  assert.equal(transport.callCount(), 1, "an authentication failure must not be retried");
});

// --- Contract / preconditions -------------------------------------------

test("throws RendererError immediately when no transport is provided", async () => {
  await assert.rejects(() => renderTemplatedPayload(loadPayload(), {}), RendererError);
});

test("throws RendererError immediately for a structurally unusable payload", async () => {
  await assert.rejects(
    () => renderTemplatedPayload({ not: "a payload" }, { transport: createMockTransport() }),
    RendererError
  );
});

test("timeoutMs is passed through to the transport, never hardcoded inside the renderer", async () => {
  let observedTimeout = null;
  const transport = {
    name: "spy-transport",
    async send(request, options) {
      observedTimeout = options.timeoutMs;
      return { id: "render_spy", status: "COMPLETED", url: "https://example.test/a.png" };
    },
  };
  await renderTemplatedPayload(loadPayload(), { transport, timeoutMs: 4242 });
  assert.equal(observedTimeout, 4242);
});

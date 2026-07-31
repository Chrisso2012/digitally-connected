import test from "node:test";
import assert from "node:assert/strict";
import { validateTransportResponse } from "../../src/renderer-response-validator.mjs";
import { ValidationError, RenderRejected } from "../../src/renderer-errors.mjs";

test("a well-formed completed response normalizes correctly", () => {
  const normalized = validateTransportResponse({ id: "render_1", status: "COMPLETED", url: "https://example.test/a.png" });
  assert.deepEqual(normalized, { id: "render_1", status: "completed", imageUrl: "https://example.test/a.png" });
});

test("a well-formed pending response normalizes with a null imageUrl", () => {
  const normalized = validateTransportResponse({ id: "render_2", status: "PENDING" });
  assert.deepEqual(normalized, { id: "render_2", status: "pending", imageUrl: null });
});

test("a non-object response is rejected with ValidationError", () => {
  assert.throws(() => validateTransportResponse("not an object"), ValidationError);
  assert.throws(() => validateTransportResponse(null), ValidationError);
  assert.throws(() => validateTransportResponse([1, 2, 3]), ValidationError);
});

test("a missing id is rejected with ValidationError carrying details", () => {
  try {
    validateTransportResponse({ status: "COMPLETED" });
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    assert.ok(error.details.some((d) => d.field === "id"));
  }
});

test("an invalid status is rejected with ValidationError", () => {
  try {
    validateTransportResponse({ id: "render_3", status: "not-a-real-status" });
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    assert.ok(error.details.some((d) => d.field === "status"));
  }
});

test("a non-string url is rejected with ValidationError", () => {
  assert.throws(() => validateTransportResponse({ id: "render_4", status: "COMPLETED", url: 12345 }), ValidationError);
});

test("a well-formed failed response is rejected with RenderRejected, not ValidationError", () => {
  try {
    validateTransportResponse({ id: "render_5", status: "FAILED", error: "bad template" });
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof RenderRejected);
    assert.ok(!(error instanceof ValidationError));
    assert.equal(error.renderId, "render_5");
    assert.equal(error.reason, "bad template");
  }
});

// --- Real Templated create-render response shape (confirmed via live
// verification research: https://templated.io/docs/renders/create/ — no
// explicit "status" field on the documented synchronous success response) ---

test("Templated's real response shape (id + url, no status field) is treated as completed", () => {
  const realShapeResponse = {
    id: "8f3a2e9c-1234-4abc-9def-0123456789ab",
    url: "https://cdn.templated.io/renders/8f3a2e9c.png",
    storage_url: null,
    width: 1080,
    height: 1350,
    format: "png",
    templateId: "748d17c5-c58e-48eb-9f12-434252a6d17f",
    templateName: "DC Carousel — 1. Cover",
    createdAt: "2026-08-01T00:00:00.000Z",
    externalId: null,
  };
  const normalized = validateTransportResponse(realShapeResponse);
  assert.equal(normalized.status, "completed");
  assert.equal(normalized.imageUrl, realShapeResponse.url);
});

test("a response with an id but no url and no status is inferred as processing, not an error", () => {
  const normalized = validateTransportResponse({ id: "render_6" });
  assert.equal(normalized.status, "processing");
  assert.equal(normalized.imageUrl, null);
});

test("an explicit status always wins over inference, even if a url is also present", () => {
  const normalized = validateTransportResponse({ id: "render_7", status: "PENDING", url: "https://example.test/a.png" });
  assert.equal(normalized.status, "pending");
});

// --- Provider status contract (corrective pass after the live-verification
// incident): Templated's official docs (https://templated.io/docs/renders/
// — "The render object") document status as PENDING, COMPLETED, or FAILED,
// always uppercase, with no PROCESSING value. The one authorized live call's
// response carried `status: "COMPLETED"`, matching the docs exactly — the
// validator, not Templated, was wrong (it only accepted lowercase at the
// time). These tests lock in the corrected contract and its normalization
// onto this codebase's canonical lowercase RenderResult vocabulary. --------

test("Templated's documented uppercase PENDING is accepted and normalized to internal lowercase 'pending'", () => {
  const normalized = validateTransportResponse({ id: "render_pending", status: "PENDING" });
  assert.equal(normalized.status, "pending");
});

test("Templated's documented uppercase COMPLETED is accepted and normalized to internal lowercase 'completed'", () => {
  const normalized = validateTransportResponse({
    id: "render_completed",
    status: "COMPLETED",
    url: "https://example.test/a.png",
  });
  assert.equal(normalized.status, "completed");
});

test("Templated's documented uppercase FAILED is normalized and surfaced as RenderRejected", () => {
  try {
    validateTransportResponse({ id: "render_failed", status: "FAILED", error: "bad template" });
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof RenderRejected);
    assert.equal(error.renderId, "render_failed");
  }
});

test("regression: the exact live-verification response shape (id + url + status: COMPLETED) validates and normalizes cleanly", () => {
  // Reproduces the shape of the one authorized live Templated response that
  // originally failed validation — status was uppercase on the wire, but
  // the validator only accepted lowercase. This is the incident this
  // corrective pass fixes.
  const normalized = validateTransportResponse({
    id: "8f3a2e9c-1234-4abc-9def-0123456789ab",
    url: "https://cdn.templated.io/renders/8f3a2e9c.png",
    status: "COMPLETED",
  });
  assert.equal(normalized.status, "completed");
  assert.equal(normalized.imageUrl, "https://cdn.templated.io/renders/8f3a2e9c.png");
});

test("a lowercase status value is rejected — Templated does not document lowercase, so it's not part of the accepted contract", () => {
  try {
    validateTransportResponse({ id: "render_lowercase", status: "completed" });
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    assert.ok(
      error.details.some((d) => d.field === "status"),
      "lowercase 'completed' must be rejected now that only the documented uppercase contract is accepted"
    );
  }
});

test("Templated's documented enum has no PROCESSING value — an explicit 'PROCESSING' is rejected, not silently accepted", () => {
  try {
    validateTransportResponse({ id: "render_processing", status: "PROCESSING" });
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    assert.ok(error.details.some((d) => d.field === "status"));
  }
});

// --- Diagnostic safety (DC-003-I006 hardening pass): every issue carries a
// field path and expected/received descriptor, but received is a safe
// type/reason descriptor for id/url — never the raw value — while status
// (a short, non-sensitive closed-enum string) may be shown verbatim. ------

test("a missing id issue reports field/expected/received without leaking any value", () => {
  try {
    validateTransportResponse({ status: "COMPLETED" });
    assert.fail("expected to throw");
  } catch (error) {
    const idIssue = error.details.find((d) => d.field === "id");
    assert.equal(idIssue.expected, "non-empty string");
    assert.equal(idIssue.received, "missing");
    assert.equal(typeof idIssue.message, "string");
  }
});

test("a wrongly-typed id reports its type, not its value", () => {
  try {
    validateTransportResponse({ id: 12345, status: "COMPLETED" });
    assert.fail("expected to throw");
  } catch (error) {
    const idIssue = error.details.find((d) => d.field === "id");
    assert.equal(idIssue.received, "number");
    // The actual value (12345) must never appear in the message.
    assert.doesNotMatch(idIssue.message, /12345/);
  }
});

test("an invalid status issue safely includes the received status value (non-sensitive closed enum)", () => {
  try {
    validateTransportResponse({ id: "render_8", status: "not-a-real-status" });
    assert.fail("expected to throw");
  } catch (error) {
    const statusIssue = error.details.find((d) => d.field === "status");
    assert.match(statusIssue.received, /not-a-real-status/);
    assert.match(statusIssue.expected, /PENDING|COMPLETED|FAILED/);
  }
});

test("a non-object response issue never includes the raw response value", () => {
  try {
    validateTransportResponse("some raw string that must never leak");
    assert.fail("expected to throw");
  } catch (error) {
    assert.doesNotMatch(error.message, /some raw string that must never leak/);
    for (const detail of error.details) {
      assert.doesNotMatch(detail.message, /some raw string that must never leak/);
    }
  }
});

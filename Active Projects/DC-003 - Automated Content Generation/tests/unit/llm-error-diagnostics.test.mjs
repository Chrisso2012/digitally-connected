// Unit tests for llm-error-diagnostics.mjs (DC-003-I019.1). Exercises
// buildSafeDiagnostic() in isolation, with hand-built response doubles —
// no fetch involved, no network. See llm-transport-http.test.mjs for the
// transport-level tests confirming this module is actually wired in.

import test from "node:test";
import assert from "node:assert/strict";
import { buildSafeDiagnostic } from "../../src/llm-error-diagnostics.mjs";

function fakeResponse(status, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (name) => lower[name.toLowerCase()] ?? null } };
}

test("a normal Anthropic invalid_request_error body yields a full safe diagnostic", () => {
  const response = fakeResponse(400, { "content-type": "application/json", "request-id": "req_abc123" });
  const body = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "model: field required" } });
  const diagnostic = buildSafeDiagnostic(response, body);
  assert.deepEqual(diagnostic, {
    status: 400,
    errorType: "invalid_request_error",
    requestId: "req_abc123",
    message: "model: field required",
  });
});

test("malformed (unparsable) JSON body degrades to a minimal diagnostic, never throws", () => {
  const response = fakeResponse(400, { "content-type": "application/json", "request-id": "req_malformed" });
  assert.doesNotThrow(() => buildSafeDiagnostic(response, "{ this is not valid json"));
  const diagnostic = buildSafeDiagnostic(response, "{ this is not valid json");
  assert.deepEqual(diagnostic, { status: 400, errorType: null, requestId: "req_malformed", message: null });
});

test("a non-JSON content-type response degrades to a minimal diagnostic — the body is never parsed", () => {
  const response = fakeResponse(400, { "content-type": "text/html", "request-id": "req_html" });
  const diagnostic = buildSafeDiagnostic(response, "<html><body>Bad Request: super-secret-detail-should-not-leak</body></html>");
  assert.deepEqual(diagnostic, { status: 400, errorType: null, requestId: "req_html", message: null });
});

test("no content-type header at all degrades to a minimal diagnostic", () => {
  const response = fakeResponse(400, { "request-id": "req_none" });
  const diagnostic = buildSafeDiagnostic(response, JSON.stringify({ type: "error", error: { type: "x", message: "y" } }));
  assert.deepEqual(diagnostic, { status: 400, errorType: null, requestId: "req_none", message: null });
});

test("an unexpected JSON shape (no error field) degrades to a minimal diagnostic", () => {
  const response = fakeResponse(400, { "content-type": "application/json" });
  const diagnostic = buildSafeDiagnostic(response, JSON.stringify({ something: "else" }));
  assert.deepEqual(diagnostic, { status: 400, errorType: null, requestId: null, message: null });
});

test("an error field that isn't an object degrades to a minimal diagnostic", () => {
  const response = fakeResponse(400, { "content-type": "application/json" });
  const diagnostic = buildSafeDiagnostic(response, JSON.stringify({ type: "error", error: "not an object" }));
  assert.deepEqual(diagnostic, { status: 400, errorType: null, requestId: null, message: null });
});

test("an empty body string degrades to a minimal diagnostic", () => {
  const response = fakeResponse(400, { "content-type": "application/json", "request-id": "req_empty" });
  const diagnostic = buildSafeDiagnostic(response, "");
  assert.deepEqual(diagnostic, { status: 400, errorType: null, requestId: "req_empty", message: null });
});

test("a null/undefined body degrades to a minimal diagnostic", () => {
  const response = fakeResponse(400, { "content-type": "application/json" });
  assert.deepEqual(buildSafeDiagnostic(response, null), { status: 400, errorType: null, requestId: null, message: null });
  assert.deepEqual(buildSafeDiagnostic(response, undefined), { status: 400, errorType: null, requestId: null, message: null });
});

// --- Request ID handling ---------------------------------------------------

test("request-id header is read when present", () => {
  const response = fakeResponse(400, { "content-type": "application/json", "request-id": "req_present" });
  const diagnostic = buildSafeDiagnostic(response, JSON.stringify({ type: "error", error: { type: "t", message: "m" } }));
  assert.equal(diagnostic.requestId, "req_present");
});

test("falls back to anthropic-request-id when request-id is absent", () => {
  const response = fakeResponse(400, { "content-type": "application/json", "anthropic-request-id": "req_fallback" });
  const diagnostic = buildSafeDiagnostic(response, JSON.stringify({ type: "error", error: { type: "t", message: "m" } }));
  assert.equal(diagnostic.requestId, "req_fallback");
});

test("requestId is null when no request-id header of any kind is present", () => {
  const response = fakeResponse(400, { "content-type": "application/json" });
  const diagnostic = buildSafeDiagnostic(response, JSON.stringify({ type: "error", error: { type: "t", message: "m" } }));
  assert.equal(diagnostic.requestId, null);
});

// --- Message capping and redaction -----------------------------------------

test("an oversized provider message is length-capped", () => {
  const response = fakeResponse(400, { "content-type": "application/json" });
  const longMessage = "x".repeat(500) + "TAIL_MARKER_MUST_BE_TRUNCATED";
  const diagnostic = buildSafeDiagnostic(response, JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: longMessage } }));
  assert.ok(diagnostic.message.length <= 301, "message must be capped at 300 chars plus the ellipsis marker");
  assert.doesNotMatch(diagnostic.message, /TAIL_MARKER_MUST_BE_TRUNCATED/);
});

test("secret-like content in the provider message is redacted", () => {
  const response = fakeResponse(400, { "content-type": "application/json" });
  const secretLike = "sk-ant-api03-THIS_LOOKS_LIKE_A_REAL_ANTHROPIC_KEY_1234567890";
  const message = `invalid credential: ${secretLike}`;
  const diagnostic = buildSafeDiagnostic(response, JSON.stringify({ type: "error", error: { type: "authentication_error", message } }));
  assert.doesNotMatch(diagnostic.message, new RegExp(secretLike));
  assert.match(diagnostic.message, /\[REDACTED\]/);
});

test("a long bearer-token-shaped substring in the message is redacted even without an sk- prefix", () => {
  const response = fakeResponse(400, { "content-type": "application/json" });
  const tokenLike = "aVeryLongOpaqueToken1234567890abcdef1234567890";
  const diagnostic = buildSafeDiagnostic(response, JSON.stringify({ type: "error", error: { type: "t", message: `token=${tokenLike}` } }));
  assert.doesNotMatch(diagnostic.message, new RegExp(tokenLike));
  assert.match(diagnostic.message, /\[REDACTED\]/);
});

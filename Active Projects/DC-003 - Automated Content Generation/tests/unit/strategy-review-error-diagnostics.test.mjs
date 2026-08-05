import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenAiSafeDiagnostic } from "../../src/strategy-review-error-diagnostics.mjs";

function fakeResponse({ status, headers = {} }) {
  return { status, headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
}

test("buildOpenAiSafeDiagnostic(): extracts status/errorType/code/requestId/message from a well-formed error body", () => {
  const response = fakeResponse({ status: 400, headers: { "content-type": "application/json", "x-request-id": "req_123" } });
  const bodyText = JSON.stringify({ error: { type: "invalid_request_error", code: "schema_error", message: "bad schema" } });
  const diagnostic = buildOpenAiSafeDiagnostic(response, bodyText);
  assert.deepEqual(diagnostic, { status: 400, errorType: "invalid_request_error", code: "schema_error", requestId: "req_123", message: "bad schema" });
});

test("buildOpenAiSafeDiagnostic(): redacts an API-key-shaped string inside the message", () => {
  const response = fakeResponse({ status: 401, headers: { "content-type": "application/json" } });
  const bodyText = JSON.stringify({ error: { type: "invalid_api_key", message: "Invalid key: sk-abcdefghijklmnopqrstuvwx" } });
  const diagnostic = buildOpenAiSafeDiagnostic(response, bodyText);
  assert.doesNotMatch(diagnostic.message, /sk-abcdefghijklmnopqrstuvwx/);
  assert.match(diagnostic.message, /\[REDACTED\]/);
});

test("buildOpenAiSafeDiagnostic(): degrades to a minimal diagnostic for a non-JSON content-type", () => {
  const response = fakeResponse({ status: 502, headers: { "content-type": "text/html" } });
  const diagnostic = buildOpenAiSafeDiagnostic(response, "<html>Bad Gateway</html>");
  assert.deepEqual(diagnostic, { status: 502, errorType: null, code: null, requestId: null, message: null });
});

test("buildOpenAiSafeDiagnostic(): never throws for malformed JSON or an unexpected shape", () => {
  const response = fakeResponse({ status: 500, headers: { "content-type": "application/json" } });
  assert.doesNotThrow(() => buildOpenAiSafeDiagnostic(response, "{ not valid json"));
  assert.doesNotThrow(() => buildOpenAiSafeDiagnostic(response, JSON.stringify([1, 2, 3])));
  assert.doesNotThrow(() => buildOpenAiSafeDiagnostic(response, JSON.stringify({ error: "not an object" })));
});

test("buildOpenAiSafeDiagnostic(): truncates an overly long message", () => {
  const response = fakeResponse({ status: 400, headers: { "content-type": "application/json" } });
  const bodyText = JSON.stringify({ error: { type: "x", message: "y".repeat(1000) } });
  const diagnostic = buildOpenAiSafeDiagnostic(response, bodyText);
  assert.ok(diagnostic.message.length <= 302);
});

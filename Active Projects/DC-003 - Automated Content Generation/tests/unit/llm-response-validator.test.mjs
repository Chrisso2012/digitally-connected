import test from "node:test";
import assert from "node:assert/strict";
import { validateLlmTransportResponse } from "../../src/llm-response-validator.mjs";
import { LlmMalformedResponseError, LlmProviderRejectedError } from "../../src/llm-provider-errors.mjs";

const TOOL_NAME = "return_carousel_slides";

function toolUseResponse(input, overrides = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "tool_1", name: TOOL_NAME, input }],
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    ...overrides,
  };
}

test("a well-formed tool_use response normalizes to a raw JSON string of its input", () => {
  const input = { slides: [{ slide_type: "cover", content: {} }] };
  const { slidesJson } = validateLlmTransportResponse(toolUseResponse(input), TOOL_NAME);
  assert.equal(typeof slidesJson, "string");
  assert.equal(slidesJson, JSON.stringify(input));
  assert.deepEqual(JSON.parse(slidesJson), input);
});

test("a non-object response is rejected with LlmMalformedResponseError", () => {
  assert.throws(() => validateLlmTransportResponse("not an object", TOOL_NAME), LlmMalformedResponseError);
  assert.throws(() => validateLlmTransportResponse(null, TOOL_NAME), LlmMalformedResponseError);
  assert.throws(() => validateLlmTransportResponse([1, 2, 3], TOOL_NAME), LlmMalformedResponseError);
  assert.throws(() => validateLlmTransportResponse(42, TOOL_NAME), LlmMalformedResponseError);
});

test("stop_reason: refusal is rejected with LlmProviderRejectedError, not LlmMalformedResponseError", () => {
  try {
    validateLlmTransportResponse({ content: [], stop_reason: "refusal" }, TOOL_NAME);
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof LlmProviderRejectedError);
    assert.ok(!(error instanceof LlmMalformedResponseError));
    assert.equal(error.reason, "refusal");
    assert.equal(error.retryable, false);
  }
});

test("a missing/non-array content field is rejected with LlmMalformedResponseError carrying details", () => {
  try {
    validateLlmTransportResponse({ stop_reason: "tool_use" }, TOOL_NAME);
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof LlmMalformedResponseError);
    assert.ok(error.details.some((d) => d.field === "content"));
    assert.equal(error.retryable, false);
  }
});

test("a response with no matching tool_use block (wrong tool name) is rejected", () => {
  const response = toolUseResponse({ slides: [] });
  response.content[0].name = "some_other_tool";
  assert.throws(() => validateLlmTransportResponse(response, TOOL_NAME), LlmMalformedResponseError);
});

test("a response whose content array has no tool_use block at all is rejected", () => {
  const response = toolUseResponse({ slides: [] });
  response.content[0].type = "text";
  assert.throws(() => validateLlmTransportResponse(response, TOOL_NAME), LlmMalformedResponseError);
});

test("a tool_use block whose input is not an object is rejected", () => {
  assert.throws(() => validateLlmTransportResponse(toolUseResponse("not an object"), TOOL_NAME), LlmMalformedResponseError);
  assert.throws(() => validateLlmTransportResponse(toolUseResponse(42), TOOL_NAME), LlmMalformedResponseError);
  assert.throws(() => validateLlmTransportResponse(toolUseResponse(null), TOOL_NAME), LlmMalformedResponseError);
});

test("a tool_use block whose input is an array is rejected (arrays are not the expected object shape)", () => {
  assert.throws(() => validateLlmTransportResponse(toolUseResponse([1, 2, 3]), TOOL_NAME), LlmMalformedResponseError);
});

// --- Diagnostic safety: never leak the raw response body or values --------

test("a non-object response's error never includes the raw response value", () => {
  try {
    validateLlmTransportResponse("some raw string that must never leak", TOOL_NAME);
    assert.fail("expected to throw");
  } catch (error) {
    assert.doesNotMatch(error.message, /some raw string that must never leak/);
    for (const detail of error.details) {
      assert.doesNotMatch(detail.message, /some raw string that must never leak/);
    }
  }
});

test("a malformed input's error never leaks the actual input value, only its type", () => {
  try {
    validateLlmTransportResponse(toolUseResponse("secret-fragment-that-must-not-leak"), TOOL_NAME);
    assert.fail("expected to throw");
  } catch (error) {
    assert.doesNotMatch(error.message, /secret-fragment-that-must-not-leak/);
    for (const detail of error.details) {
      assert.doesNotMatch(detail.message, /secret-fragment-that-must-not-leak/);
    }
  }
});

// --- DC-003-I023: token usage preservation ---------------------------

test("a response with a well-formed usage object normalizes it to { inputTokens, outputTokens, totalTokens }", () => {
  const input = { slides: [] };
  const { usage } = validateLlmTransportResponse(toolUseResponse(input, { usage: { input_tokens: 150, output_tokens: 320 } }), TOOL_NAME);
  assert.deepEqual(usage, { inputTokens: 150, outputTokens: 320, totalTokens: 470 });
});

test("a response with no usage field at all yields usage: null, not an error", () => {
  const { usage } = validateLlmTransportResponse(toolUseResponse({ slides: [] }), TOOL_NAME);
  assert.equal(usage, null);
});

test("a malformed usage object (non-numeric fields) degrades to usage: null rather than throwing", () => {
  const { usage } = validateLlmTransportResponse(toolUseResponse({ slides: [] }, { usage: { input_tokens: "many", output_tokens: 10 } }), TOOL_NAME);
  assert.equal(usage, null);
});

test("usage: 0 input/output tokens is preserved as real zero-token evidence, not treated as missing", () => {
  const { usage } = validateLlmTransportResponse(toolUseResponse({ slides: [] }, { usage: { input_tokens: 0, output_tokens: 0 } }), TOOL_NAME);
  assert.deepEqual(usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
});

test("slidesJson's own contract is unaffected by the presence or absence of usage", () => {
  const input = { slides: [{ slide_type: "cover", content: {} }] };
  const withUsage = validateLlmTransportResponse(toolUseResponse(input, { usage: { input_tokens: 1, output_tokens: 1 } }), TOOL_NAME);
  const withoutUsage = validateLlmTransportResponse(toolUseResponse(input), TOOL_NAME);
  assert.equal(withUsage.slidesJson, withoutUsage.slidesJson);
});

// --- DC-003-I032.3: stop_reason preservation -------------------------
// Additive, mirroring I023's own usage-preservation precedent exactly:
// stop_reason was already returned by Anthropic on every real response
// but previously read only to check for "refusal" then discarded. A
// "max_tokens" value is safe, content-free diagnostic evidence that the
// model's structured tool-call output was cut off mid-object.

test('a tool_use response with stop_reason: "tool_use" surfaces it verbatim as stopReason', () => {
  const { stopReason } = validateLlmTransportResponse(toolUseResponse({ slides: [] }), TOOL_NAME);
  assert.equal(stopReason, "tool_use");
});

test('a response with stop_reason: "max_tokens" surfaces it verbatim — the truncation signal this milestone exists to catch', () => {
  const { stopReason } = validateLlmTransportResponse(toolUseResponse({ slides: [] }, { stop_reason: "max_tokens" }), TOOL_NAME);
  assert.equal(stopReason, "max_tokens");
});

test("a response with no stop_reason field at all yields stopReason: null, not an error", () => {
  const response = toolUseResponse({ slides: [] });
  delete response.stop_reason;
  const { stopReason } = validateLlmTransportResponse(response, TOOL_NAME);
  assert.equal(stopReason, null);
});

test("a non-string stop_reason degrades to stopReason: null rather than throwing", () => {
  const { stopReason } = validateLlmTransportResponse(toolUseResponse({ slides: [] }, { stop_reason: 42 }), TOOL_NAME);
  assert.equal(stopReason, null);
});

test("slidesJson's own contract is unaffected by the presence or value of stop_reason", () => {
  const input = { slides: [{ slide_type: "cover", content: {} }] };
  const a = validateLlmTransportResponse(toolUseResponse(input, { stop_reason: "tool_use" }), TOOL_NAME);
  const b = validateLlmTransportResponse(toolUseResponse(input, { stop_reason: "max_tokens" }), TOOL_NAME);
  assert.equal(a.slidesJson, b.slidesJson);
});

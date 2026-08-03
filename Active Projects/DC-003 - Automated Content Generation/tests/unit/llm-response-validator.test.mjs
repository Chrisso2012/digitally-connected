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

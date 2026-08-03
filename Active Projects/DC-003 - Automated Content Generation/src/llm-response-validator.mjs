// DC-003-I019 — validates a transport's raw response before it's allowed
// anywhere near the domain layer. External responses (from any transport,
// mock or HTTP) are never trusted directly — this is the one boundary
// every response, regardless of transport, must cross. Mirrors
// DC-003-I006's renderer-response-validator.mjs exactly, including its
// non-retryable-on-shape-mismatch reasoning.
//
// Anthropic's Messages API (https://docs.anthropic.com/en/api/messages)
// returns `content: [{ type, ... }]` — when a tool call is forced via
// `tool_choice`, the response contains a `{ type: "tool_use", name,
// input }` block whose `input` is already a parsed JSON object matching
// the tool's declared input_schema, not a string requiring a second
// parse. That `input` — the structured carousel slides object — is this
// module's one normalization target: JSON.stringify()'d back into a raw
// string so llm-provider-anthropic.mjs's generateCarousel() return value
// matches DC-003-I004's own mock-provider contract exactly (a raw JSON
// string, never a pre-parsed object) — no change needed anywhere
// downstream.
//
// Non-retryable, mirroring the DC-003-I006 live-verification incident's
// lesson: a shape mismatch here is deterministic — the same malformed
// response will recur identically on retry — so LlmMalformedResponseError
// is thrown, never treated as transient.
//
// Diagnostics never include the raw response body, the API key, or any
// authorization header — only a safe, type-level descriptor of what was
// found.

import { LlmMalformedResponseError, LlmProviderRejectedError } from "./llm-provider-errors.mjs";

const REFUSAL_STOP_REASONS = new Set(["refusal"]);

function describeReceived(value) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "string" && value.trim() === "") return "empty string";
  return typeof value;
}

function issue(field, expected, received) {
  return { field, expected, received, message: `${field}: expected ${expected}, received ${received}` };
}

/**
 * Validates and normalizes a raw Anthropic Messages API response into
 * `{ slidesJson }` — a raw JSON string, matching
 * createMockProvider().generateCarousel()'s own return contract exactly.
 *
 * `toolName` — the tool name the request forced via `tool_choice`; the
 * response's `tool_use` block must match it, or the response is treated
 * as untrustworthy rather than silently accepted from a differently-named
 * block.
 *
 * Throws LlmMalformedResponseError if the response isn't a JSON object,
 * has no usable `content` array, or contains no matching `tool_use` block
 * with an object `input` — never retried; see the module header for why.
 *
 * Throws LlmProviderRejectedError if `stop_reason` indicates the model
 * declined to complete the request (a content-policy refusal) — also
 * never retried, since the same prompt would be declined again.
 */
export function validateLlmTransportResponse(rawResponse, toolName) {
  if (rawResponse === null || typeof rawResponse !== "object" || Array.isArray(rawResponse)) {
    throw new LlmMalformedResponseError("LLM transport response is not a JSON object", [
      issue("(root)", "object", Array.isArray(rawResponse) ? "array" : describeReceived(rawResponse)),
    ]);
  }

  if (REFUSAL_STOP_REASONS.has(rawResponse.stop_reason)) {
    throw new LlmProviderRejectedError(
      "The provider declined to complete this request (stop_reason: refusal)",
      rawResponse.stop_reason
    );
  }

  if (!Array.isArray(rawResponse.content)) {
    throw new LlmMalformedResponseError("LLM transport response has no usable \"content\" array", [
      issue("content", "array", describeReceived(rawResponse.content)),
    ]);
  }

  const toolUseBlock = rawResponse.content.find((block) => block?.type === "tool_use" && block?.name === toolName);
  if (!toolUseBlock) {
    throw new LlmMalformedResponseError(
      `LLM transport response has no "tool_use" block named "${toolName}" — the model may not have used the forced tool`,
      [issue("content[].type/name", `a tool_use block named "${toolName}"`, "not found")]
    );
  }

  if (toolUseBlock.input === null || typeof toolUseBlock.input !== "object" || Array.isArray(toolUseBlock.input)) {
    throw new LlmMalformedResponseError("The tool_use block's \"input\" is not a JSON object", [
      issue("content[].input", "object", describeReceived(toolUseBlock.input)),
    ]);
  }

  return { slidesJson: JSON.stringify(toolUseBlock.input) };
}

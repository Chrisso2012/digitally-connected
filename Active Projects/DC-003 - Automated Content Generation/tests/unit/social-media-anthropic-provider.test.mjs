// Covers both social-media-transport-http.mjs and
// social-media-anthropic-provider.mjs together via a mocked global fetch —
// mirrors editorial-analysis-anthropic-provider.test.mjs's own precedent
// of testing an HTTP transport + its provider as one unit.

import test from "node:test";
import assert from "node:assert/strict";
import { createSocialMediaHttpTransport, TOOL_NAME } from "../../src/social-media-transport-http.mjs";
import { createAnthropicSocialMediaProvider } from "../../src/social-media-anthropic-provider.mjs";
import { LlmAuthenticationError, LlmRateLimitError, LlmClientError, LlmConfigurationError, LlmProviderError } from "../../src/llm-provider-errors.mjs";

const VALID_TOOL_INPUT = {
  hook: "H",
  callToAction: "CTA",
  tone: "T",
  audience: "A",
  platforms: {
    linkedin: { postText: "L", hashtags: ["a"] },
    facebook: { postText: "F", hashtags: ["b"] },
    x: { postText: "X", hashtags: [] },
    instagram: { caption: "I", hashtags: ["c"] },
  },
  carousel: {
    headings: ["1", "2", "3", "4", "5", "6"],
    slideCopy: ["1", "2", "3", "4", "5", "6"],
    imageGuidance: ["1", "2", "3", "4", "5", "6"],
  },
};

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const originalFetch = global.fetch;
test.afterEach(() => {
  global.fetch = originalFetch;
});

test("createSocialMediaHttpTransport() throws LlmConfigurationError without an apiKey", () => {
  assert.throws(() => createSocialMediaHttpTransport({}), LlmConfigurationError);
});

test("transport.send() returns the parsed response body on success", async () => {
  global.fetch = async () => jsonResponse(200, { content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_TOOL_INPUT }] });
  const transport = createSocialMediaHttpTransport({ apiKey: "key" });
  const body = await transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME });
  assert.deepEqual(body.content[0].input, VALID_TOOL_INPUT);
});

test("transport.send() throws LlmAuthenticationError on HTTP 401/403", async () => {
  global.fetch = async () => jsonResponse(401, {});
  const transport = createSocialMediaHttpTransport({ apiKey: "key" });
  await assert.rejects(() => transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME }), LlmAuthenticationError);
});

test("transport.send() throws LlmRateLimitError on HTTP 429", async () => {
  global.fetch = async () => jsonResponse(429, {}, { "retry-after": "2" });
  const transport = createSocialMediaHttpTransport({ apiKey: "key" });
  await assert.rejects(() => transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME }), LlmRateLimitError);
});

test("transport.send() throws LlmClientError on a bare HTTP 400", async () => {
  global.fetch = async () => jsonResponse(400, { type: "error", error: { type: "invalid_request_error", message: "bad request" } }, { "content-type": "application/json" });
  const transport = createSocialMediaHttpTransport({ apiKey: "key" });
  await assert.rejects(() => transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME }), LlmClientError);
});

test("createAnthropicSocialMediaProvider() requires fields.transport and fields.model", () => {
  assert.throws(() => createAnthropicSocialMediaProvider({}), LlmProviderError);
  assert.throws(() => createAnthropicSocialMediaProvider({ transport: {} }), LlmProviderError);
});

test("generateSocialMedia() returns a raw JSON string matching the mock provider's own contract", async () => {
  global.fetch = async () => jsonResponse(200, { content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_TOOL_INPUT }], usage: { input_tokens: 10, output_tokens: 20 } });
  const transport = createSocialMediaHttpTransport({ apiKey: "key" });

  let capturedUsage;
  const provider = createAnthropicSocialMediaProvider({ transport, model: "claude-sonnet-5", onUsage: (u) => (capturedUsage = u) });
  const raw = await provider.generateSocialMedia("prompt");

  assert.equal(typeof raw, "string");
  assert.deepEqual(JSON.parse(raw), VALID_TOOL_INPUT);
  assert.deepEqual(capturedUsage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  assert.equal(provider.name, "anthropic-social-media-claude-sonnet-5");
});

test("generateSocialMedia() propagates a transport error unmodified", async () => {
  global.fetch = async () => jsonResponse(401, {});
  const transport = createSocialMediaHttpTransport({ apiKey: "key" });
  const provider = createAnthropicSocialMediaProvider({ transport, model: "claude-sonnet-5" });
  await assert.rejects(() => provider.generateSocialMedia("prompt"), LlmAuthenticationError);
});

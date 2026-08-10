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
  industryContext: null,
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

// --- DC-003-I032.3: onStopReason ---------------------------------------
// Additive callback, mirroring onUsage's own established pattern exactly.
// A "max_tokens" stop_reason is the safe, content-free diagnostic signal
// this milestone exists to surface for the real live carousel failure.

test("generateSocialMedia() surfaces Anthropic's raw stop_reason via onStopReason", async () => {
  global.fetch = async () => jsonResponse(200, { content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_TOOL_INPUT }], stop_reason: "tool_use" });
  const transport = createSocialMediaHttpTransport({ apiKey: "key" });

  let capturedStopReason;
  const provider = createAnthropicSocialMediaProvider({ transport, model: "claude-sonnet-5", onStopReason: (r) => (capturedStopReason = r) });
  await provider.generateSocialMedia("prompt");

  assert.equal(capturedStopReason, "tool_use");
});

test("generateSocialMedia() surfaces a max_tokens stop_reason unmodified, even alongside an otherwise-valid tool_use block", async () => {
  global.fetch = async () => jsonResponse(200, { content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_TOOL_INPUT }], stop_reason: "max_tokens" });
  const transport = createSocialMediaHttpTransport({ apiKey: "key" });

  let capturedStopReason;
  const provider = createAnthropicSocialMediaProvider({ transport, model: "claude-sonnet-5", onStopReason: (r) => (capturedStopReason = r) });
  await provider.generateSocialMedia("prompt");

  assert.equal(capturedStopReason, "max_tokens");
});

test("generateSocialMedia() works without onStopReason supplied at all (optional, mirrors onUsage)", async () => {
  global.fetch = async () => jsonResponse(200, { content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_TOOL_INPUT }], stop_reason: "tool_use" });
  const transport = createSocialMediaHttpTransport({ apiKey: "key" });
  const provider = createAnthropicSocialMediaProvider({ transport, model: "claude-sonnet-5" });
  await assert.doesNotReject(() => provider.generateSocialMedia("prompt"));
});

// --- DC-003-I032.4: token budget ----------------------------------------
// Raised from the shared 4096 default (still used unmodified by I004's
// llm-provider-anthropic.mjs and I031's own
// editorial-analysis-anthropic-provider.mjs — see each file's own test
// suite) after I032.3's controlled live diagnostic confirmed
// stop_reason: "max_tokens" with `carousel` missing entirely. Mirrors
// llm-provider-anthropic.test.mjs's own "defaults: ... maxTokens is 4096"
// spy-transport pattern exactly, asserting 8192 here instead.

test("request construction: maxTokens defaults to 8192 (DC-003-I032.4) when not overridden", async () => {
  let observedRequest = null;
  const spyTransport = {
    name: "spy",
    async send(request) {
      observedRequest = request;
      return { content: [{ type: "tool_use", name: request.toolName, input: VALID_TOOL_INPUT }], stop_reason: "tool_use" };
    },
  };
  const provider = createAnthropicSocialMediaProvider({ transport: spyTransport, model: "claude-sonnet-5" });
  await provider.generateSocialMedia("prompt");
  assert.equal(observedRequest.maxTokens, 8192);
});

test("an explicit maxTokens override still takes priority over the 8192 default", async () => {
  let observedRequest = null;
  const spyTransport = {
    name: "spy",
    async send(request) {
      observedRequest = request;
      return { content: [{ type: "tool_use", name: request.toolName, input: VALID_TOOL_INPUT }], stop_reason: "tool_use" };
    },
  };
  const provider = createAnthropicSocialMediaProvider({ transport: spyTransport, model: "claude-sonnet-5", maxTokens: 2048 });
  await provider.generateSocialMedia("prompt");
  assert.equal(observedRequest.maxTokens, 2048);
});

// --- DC-003-I031.8 — the forced tool's own input_schema must require
// industryContext explicitly (null-or-string, mirrors statistic/quote's
// own honest-evidence pattern), so a real live call cannot silently omit
// it. Mirrors editorial-analysis-anthropic-provider.test.mjs's own
// I031.2 captureSentSchema() pattern exactly.

function captureSentSchema() {
  let capturedBody;
  global.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return jsonResponse(200, { content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_TOOL_INPUT }] });
  };
  return () => capturedBody.tools[0].input_schema;
}

test("the tool input_schema sent to Anthropic requires industryContext and allows null-or-string, never fabricating a value", async () => {
  const getSchema = captureSentSchema();
  const transport = createSocialMediaHttpTransport({ apiKey: "key" });
  await transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME });

  const schema = getSchema();
  assert.ok(schema.required.includes("industryContext"), "industryContext must be a required field — the model must explicitly choose null, never silently omit it");
  const industryContextSchema = schema.properties.industryContext;
  assert.deepEqual(industryContextSchema.anyOf, [{ type: "null" }, { type: "string", minLength: 1 }]);
});

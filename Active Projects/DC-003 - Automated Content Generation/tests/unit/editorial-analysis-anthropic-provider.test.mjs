// Covers both editorial-analysis-transport-http.mjs and
// editorial-analysis-anthropic-provider.mjs together via a mocked global
// fetch — mirrors this project's own precedent of testing an HTTP
// transport + its provider as one unit (google-docs-source-adapter.test.mjs)
// rather than a separate transport-only file.

import test from "node:test";
import assert from "node:assert/strict";
import { createEditorialAnalysisHttpTransport, TOOL_NAME } from "../../src/editorial-analysis-transport-http.mjs";
import { createAnthropicEditorialAnalysisProvider } from "../../src/editorial-analysis-anthropic-provider.mjs";
import { LlmAuthenticationError, LlmRateLimitError, LlmClientError, LlmConfigurationError, LlmProviderError } from "../../src/llm-provider-errors.mjs";

const VALID_TOOL_INPUT = {
  primaryHeadline: "H",
  supportingHeadline: "SH",
  executiveSummary: "ES",
  coreMessage: "CM",
  primaryAudience: "PA",
  primaryProblem: "PP",
  desiredOutcome: "DO",
  keyInsights: ["a"],
  pullQuotes: ["b"],
  callToAction: "CTA",
  keywords: ["k"],
  seoTitle: "ST",
  seoDescription: "SD",
  suggestedHashtags: ["h"],
  editorialThemes: ["t"],
  contentCategories: ["c"],
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

test("createEditorialAnalysisHttpTransport() throws LlmConfigurationError without an apiKey", () => {
  assert.throws(() => createEditorialAnalysisHttpTransport({}), LlmConfigurationError);
});

test("transport.send() returns the parsed response body on success", async () => {
  global.fetch = async () => jsonResponse(200, { content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_TOOL_INPUT }] });
  const transport = createEditorialAnalysisHttpTransport({ apiKey: "key" });
  const body = await transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME });
  assert.deepEqual(body.content[0].input, VALID_TOOL_INPUT);
});

test("transport.send() throws LlmAuthenticationError on HTTP 401/403", async () => {
  global.fetch = async () => jsonResponse(401, {});
  const transport = createEditorialAnalysisHttpTransport({ apiKey: "key" });
  await assert.rejects(() => transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME }), LlmAuthenticationError);
});

test("transport.send() throws LlmRateLimitError on HTTP 429", async () => {
  global.fetch = async () => jsonResponse(429, {}, { "retry-after": "2" });
  const transport = createEditorialAnalysisHttpTransport({ apiKey: "key" });
  await assert.rejects(() => transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME }), LlmRateLimitError);
});

test("transport.send() throws LlmClientError on a bare HTTP 400", async () => {
  global.fetch = async () => jsonResponse(400, { type: "error", error: { type: "invalid_request_error", message: "bad request" } }, { "content-type": "application/json" });
  const transport = createEditorialAnalysisHttpTransport({ apiKey: "key" });
  await assert.rejects(() => transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME }), LlmClientError);
});

test("createAnthropicEditorialAnalysisProvider() requires fields.transport and fields.model", () => {
  assert.throws(() => createAnthropicEditorialAnalysisProvider({}), LlmProviderError);
  assert.throws(() => createAnthropicEditorialAnalysisProvider({ transport: {} }), LlmProviderError);
});

test("analyzeContent() returns a raw JSON string matching the mock provider's own contract", async () => {
  global.fetch = async () => jsonResponse(200, { content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_TOOL_INPUT }], usage: { input_tokens: 10, output_tokens: 20 } });
  const transport = createEditorialAnalysisHttpTransport({ apiKey: "key" });

  let capturedUsage;
  const provider = createAnthropicEditorialAnalysisProvider({ transport, model: "claude-sonnet-5", onUsage: (u) => (capturedUsage = u) });
  const raw = await provider.analyzeContent("prompt");

  assert.equal(typeof raw, "string");
  assert.deepEqual(JSON.parse(raw), VALID_TOOL_INPUT);
  assert.deepEqual(capturedUsage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  assert.equal(provider.name, "anthropic-editorial-claude-sonnet-5");
});

test("analyzeContent() propagates a transport error unmodified", async () => {
  global.fetch = async () => jsonResponse(401, {});
  const transport = createEditorialAnalysisHttpTransport({ apiKey: "key" });
  const provider = createAnthropicEditorialAnalysisProvider({ transport, model: "claude-sonnet-5" });
  await assert.rejects(() => provider.analyzeContent("prompt"), LlmAuthenticationError);
});

// --- DC-003-I031.2 — the forced tool's own input_schema must reject an
// empty string at the source, not merely after a local re-validation.
// Regression coverage for the discovered live failure: Anthropic's
// structured-output enforcement previously allowed a blank keyInsights
// entry (or any other string field) because this schema had no
// minLength, even though editorial-analysis-provider.mjs's own
// assertValidEditorialAnalysisResult() has always rejected it. -------

function captureSentSchema() {
  let capturedBody;
  global.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return jsonResponse(200, { content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_TOOL_INPUT }] });
  };
  return () => capturedBody.tools[0].input_schema;
}

test("the tool input_schema sent to Anthropic requires minLength: 1 on every top-level string field", async () => {
  const getSchema = captureSentSchema();
  const transport = createEditorialAnalysisHttpTransport({ apiKey: "key" });
  await transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME });

  const schema = getSchema();
  const stringFields = ["primaryHeadline", "supportingHeadline", "executiveSummary", "coreMessage", "primaryAudience", "primaryProblem", "desiredOutcome", "callToAction", "seoTitle", "seoDescription"];
  for (const field of stringFields) {
    assert.equal(schema.properties[field].type, "string", `${field} must be typed string`);
    assert.equal(schema.properties[field].minLength, 1, `${field} must require minLength: 1`);
  }
});

test("the tool input_schema sent to Anthropic requires minLength: 1 on every array field's own string items", async () => {
  const getSchema = captureSentSchema();
  const transport = createEditorialAnalysisHttpTransport({ apiKey: "key" });
  await transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME });

  const schema = getSchema();
  const arrayFields = ["keyInsights", "pullQuotes", "keywords", "suggestedHashtags", "editorialThemes", "contentCategories"];
  for (const field of arrayFields) {
    assert.equal(schema.properties[field].type, "array", `${field} must be typed array`);
    assert.equal(schema.properties[field].minItems, 1, `${field} must require minItems: 1`);
    assert.equal(schema.properties[field].items.type, "string", `${field} items must be typed string`);
    assert.equal(schema.properties[field].items.minLength, 1, `${field} items must require minLength: 1 — this is the exact gap that let a live response's blank keyInsights entry through`);
  }
});

// --- DC-003-I031.6 — root cause of the "<item>...</item>"-tagged live
// failure: neither the schema nor the prompt ever told Anthropic these
// six fields must be genuine JSON arrays, not XML-tagged prose inside a
// single string. Regression coverage for the fix at the schema boundary. -

test("the tool input_schema sent to Anthropic gives every canonical array field a description forbidding XML tags and pseudo-lists", async () => {
  const getSchema = captureSentSchema();
  const transport = createEditorialAnalysisHttpTransport({ apiKey: "key" });
  await transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME });

  const schema = getSchema();
  const arrayFields = ["keyInsights", "pullQuotes", "keywords", "suggestedHashtags", "editorialThemes", "contentCategories"];
  for (const field of arrayFields) {
    const description = schema.properties[field].description;
    assert.equal(typeof description, "string", `${field} must carry a description`);
    assert.ok(description.length > 0, `${field}'s description must not be blank`);
    assert.match(description, /native JSON array/i, `${field}'s description must require a native JSON array`);
    assert.match(description, /<item>/, `${field}'s description must explicitly name the discovered <item> tag pattern`);
    assert.match(description, /not.*single string/i, `${field}'s description must forbid a single-string representation`);
  }
});

test("the tool input_schema sent to Anthropic never gives a scalar string field an array-style description", async () => {
  const getSchema = captureSentSchema();
  const transport = createEditorialAnalysisHttpTransport({ apiKey: "key" });
  await transport.send({ model: "m", prompt: "p", maxTokens: 100, toolName: TOOL_NAME });

  const schema = getSchema();
  const scalarFields = ["primaryHeadline", "supportingHeadline", "executiveSummary", "coreMessage", "primaryAudience", "primaryProblem", "desiredOutcome", "callToAction", "seoTitle", "seoDescription"];
  for (const field of scalarFields) {
    assert.equal(schema.properties[field].description, undefined, `${field} is a scalar string, not one of the six canonical array fields — it must not gain an array-style description`);
  }
});

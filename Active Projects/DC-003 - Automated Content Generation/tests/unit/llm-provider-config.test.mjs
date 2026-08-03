import test from "node:test";
import assert from "node:assert/strict";
import { loadLlmProviderConfig, resolveLiveMaxAttempts, DEFAULT_LIVE_MAX_ATTEMPTS } from "../../src/llm-provider-config.mjs";

test("loadLlmProviderConfig applies documented defaults when no env vars are set", () => {
  const config = loadLlmProviderConfig({});
  assert.equal(config.provider, "anthropic");
  assert.equal(config.apiKey, null);
  assert.equal(config.model, "claude-sonnet-5");
  assert.equal(config.baseUrl, "https://api.anthropic.com/v1");
  assert.equal(config.requestTimeoutMs, 15000);
  assert.equal(config.maxAttempts, 3);
});

test("loadLlmProviderConfig reads every value from the given env object", () => {
  const config = loadLlmProviderConfig({
    LLM_PROVIDER: "anthropic",
    LLM_API_KEY: "sk-test-not-a-real-key",
    LLM_MODEL: "claude-test-model",
    LLM_API_BASE_URL: "https://example.test/v1",
    LLM_REQUEST_TIMEOUT_MS: "5000",
    LLM_MAX_ATTEMPTS: "7",
  });
  assert.equal(config.provider, "anthropic");
  assert.equal(config.apiKey, "sk-test-not-a-real-key");
  assert.equal(config.model, "claude-test-model");
  assert.equal(config.baseUrl, "https://example.test/v1");
  assert.equal(config.requestTimeoutMs, 5000);
  assert.equal(config.maxAttempts, 7);
});

// --- Live-verification safety: default to exactly one attempt, decoupled
// from the normal production retry default ------------------------------

test("DEFAULT_LIVE_MAX_ATTEMPTS is 1", () => {
  assert.equal(DEFAULT_LIVE_MAX_ATTEMPTS, 1);
});

test("resolveLiveMaxAttempts defaults to 1 when no override is given", () => {
  assert.equal(resolveLiveMaxAttempts(undefined), 1);
  assert.equal(resolveLiveMaxAttempts(null), 1);
  assert.equal(resolveLiveMaxAttempts(""), 1);
});

test("resolveLiveMaxAttempts is completely independent of LLM_MAX_ATTEMPTS", () => {
  // loadLlmProviderConfig would resolve maxAttempts: 7 from this env, but
  // resolveLiveMaxAttempts must never read it — the two are deliberately
  // disconnected so a live run can't inherit a production retry ceiling.
  const productionConfig = loadLlmProviderConfig({ LLM_MAX_ATTEMPTS: "7" });
  assert.equal(productionConfig.maxAttempts, 7);
  assert.equal(resolveLiveMaxAttempts(undefined), 1);
});

test("resolveLiveMaxAttempts honors an explicit positive-integer override", () => {
  assert.equal(resolveLiveMaxAttempts("1"), 1);
  assert.equal(resolveLiveMaxAttempts("2"), 2);
  assert.equal(resolveLiveMaxAttempts("5"), 5);
});

test("resolveLiveMaxAttempts rejects a non-positive-integer override", () => {
  assert.throws(() => resolveLiveMaxAttempts("0"), RangeError);
  assert.throws(() => resolveLiveMaxAttempts("-1"), RangeError);
  assert.throws(() => resolveLiveMaxAttempts("abc"), RangeError);
  assert.throws(() => resolveLiveMaxAttempts("1.5"), RangeError);
});

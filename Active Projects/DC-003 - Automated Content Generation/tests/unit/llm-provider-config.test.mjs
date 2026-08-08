import test from "node:test";
import assert from "node:assert/strict";
import {
  loadLlmProviderConfig,
  resolveLiveMaxAttempts,
  DEFAULT_LIVE_MAX_ATTEMPTS,
  resolveLiveRequestTimeoutMs,
  DEFAULT_LIVE_REQUEST_TIMEOUT_MS,
} from "../../src/llm-provider-config.mjs";

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

// --- DC-003-I031.1 — live request timeout, decoupled from the shared
// loadLlmProviderConfig().requestTimeoutMs default (still 15000, still
// what I032's own --live path uses unchanged) -----------------------

test("DEFAULT_LIVE_REQUEST_TIMEOUT_MS is 60000", () => {
  assert.equal(DEFAULT_LIVE_REQUEST_TIMEOUT_MS, 60000);
});

test("resolveLiveRequestTimeoutMs defaults to 60000 when no override is given", () => {
  assert.equal(resolveLiveRequestTimeoutMs(undefined), 60000);
  assert.equal(resolveLiveRequestTimeoutMs(null), 60000);
  assert.equal(resolveLiveRequestTimeoutMs(""), 60000);
});

test("resolveLiveRequestTimeoutMs is completely independent of LLM_REQUEST_TIMEOUT_MS", () => {
  // loadLlmProviderConfig would resolve requestTimeoutMs: 5000 from this
  // env (this is exactly what I032's own --live path still reads), but
  // resolveLiveRequestTimeoutMs must never read it — I031's own live
  // timeout is deliberately disconnected from the shared config value.
  const productionConfig = loadLlmProviderConfig({ LLM_REQUEST_TIMEOUT_MS: "5000" });
  assert.equal(productionConfig.requestTimeoutMs, 5000);
  assert.equal(resolveLiveRequestTimeoutMs(undefined), 60000);
});

test("resolveLiveRequestTimeoutMs honors an explicit positive-integer override", () => {
  assert.equal(resolveLiveRequestTimeoutMs("1000"), 1000);
  assert.equal(resolveLiveRequestTimeoutMs("30000"), 30000);
  assert.equal(resolveLiveRequestTimeoutMs("90000"), 90000);
});

test("resolveLiveRequestTimeoutMs rejects a non-positive-integer override", () => {
  assert.throws(() => resolveLiveRequestTimeoutMs("0"), RangeError);
  assert.throws(() => resolveLiveRequestTimeoutMs("-1"), RangeError);
  assert.throws(() => resolveLiveRequestTimeoutMs("abc"), RangeError);
  assert.throws(() => resolveLiveRequestTimeoutMs("1.5"), RangeError);
});

test("resolveLiveRequestTimeoutMs accepts an injected default distinct from DEFAULT_LIVE_REQUEST_TIMEOUT_MS", () => {
  // Confirms the function is generically reusable (a future milestone
  // could call it with its own default) without hardcoding 60000 as the
  // only possible value.
  assert.equal(resolveLiveRequestTimeoutMs(undefined, 15000), 15000);
});

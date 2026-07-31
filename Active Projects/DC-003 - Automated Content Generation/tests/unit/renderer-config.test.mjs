import test from "node:test";
import assert from "node:assert/strict";
import { loadRendererConfig, resolveLiveMaxAttempts, DEFAULT_LIVE_MAX_ATTEMPTS } from "../../src/renderer-config.mjs";

test("loadRendererConfig applies documented defaults when no env vars are set", () => {
  const config = loadRendererConfig({});
  assert.equal(config.apiKey, null);
  assert.equal(config.baseUrl, "https://api.templated.io/v1");
  assert.equal(config.requestTimeoutMs, 15000);
  assert.equal(config.maxAttempts, 3);
});

test("loadRendererConfig reads every value from the given env object", () => {
  const config = loadRendererConfig({
    TEMPLATED_API_KEY: "sk-test-not-a-real-key",
    TEMPLATED_API_BASE_URL: "https://example.test/v1",
    TEMPLATED_REQUEST_TIMEOUT_MS: "5000",
    TEMPLATED_RENDER_MAX_ATTEMPTS: "7",
  });
  assert.equal(config.apiKey, "sk-test-not-a-real-key");
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

test("resolveLiveMaxAttempts is completely independent of TEMPLATED_RENDER_MAX_ATTEMPTS", () => {
  // loadRendererConfig would resolve maxAttempts: 7 from this env, but
  // resolveLiveMaxAttempts must never read it — the two are deliberately
  // disconnected so a live run can't inherit a production retry ceiling.
  const productionConfig = loadRendererConfig({ TEMPLATED_RENDER_MAX_ATTEMPTS: "7" });
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

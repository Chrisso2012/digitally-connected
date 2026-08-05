import test from "node:test";
import assert from "node:assert/strict";
import { loadInstagramPublisherConfig, resolveLiveMaxAttempts, DEFAULT_LIVE_MAX_ATTEMPTS } from "../../src/instagram-publisher-config.mjs";

test("loadInstagramPublisherConfig applies documented defaults when no env vars are set", () => {
  const config = loadInstagramPublisherConfig({});
  assert.equal(config.accessToken, null);
  assert.equal(config.userId, null);
  assert.equal(config.apiBaseUrl, "https://graph.facebook.com");
  assert.equal(config.apiVersion, "v21.0");
  assert.equal(config.requestTimeoutMs, 15000);
});

test("loadInstagramPublisherConfig reads every value from the given env object", () => {
  const config = loadInstagramPublisherConfig({
    INSTAGRAM_ACCESS_TOKEN: "not-a-real-token",
    INSTAGRAM_USER_ID: "17800000000000000",
    INSTAGRAM_API_BASE_URL: "https://example.test",
    INSTAGRAM_API_VERSION: "v99.0",
    INSTAGRAM_REQUEST_TIMEOUT_MS: "5000",
  });
  assert.equal(config.accessToken, "not-a-real-token");
  assert.equal(config.userId, "17800000000000000");
  assert.equal(config.apiBaseUrl, "https://example.test");
  assert.equal(config.apiVersion, "v99.0");
  assert.equal(config.requestTimeoutMs, 5000);
});

test("DEFAULT_LIVE_MAX_ATTEMPTS is 1", () => {
  assert.equal(DEFAULT_LIVE_MAX_ATTEMPTS, 1);
});

test("resolveLiveMaxAttempts defaults to 1 with no override", () => {
  assert.equal(resolveLiveMaxAttempts(undefined), 1);
  assert.equal(resolveLiveMaxAttempts(null), 1);
  assert.equal(resolveLiveMaxAttempts(""), 1);
});

test("resolveLiveMaxAttempts accepts an explicit positive integer override", () => {
  assert.equal(resolveLiveMaxAttempts("3"), 3);
});

test("resolveLiveMaxAttempts throws RangeError for a non-positive-integer override", () => {
  assert.throws(() => resolveLiveMaxAttempts("0"), RangeError);
  assert.throws(() => resolveLiveMaxAttempts("-1"), RangeError);
  assert.throws(() => resolveLiveMaxAttempts("not-a-number"), RangeError);
});

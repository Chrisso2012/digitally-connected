import test from "node:test";
import assert from "node:assert/strict";
import { loadLinkedInPublisherConfig, classifyAuthorUrn, resolveLiveMaxAttempts, DEFAULT_LIVE_MAX_ATTEMPTS } from "../../src/linkedin-publisher-config.mjs";

test("loadLinkedInPublisherConfig applies documented defaults when no env vars are set", () => {
  const config = loadLinkedInPublisherConfig({});
  assert.equal(config.accessToken, null);
  assert.equal(config.authorUrn, null);
  assert.equal(config.apiBaseUrl, "https://api.linkedin.com");
  assert.equal(config.apiVersion, null, "no plausible default version is guessed — must be explicitly configured");
  assert.equal(config.requestTimeoutMs, 15000);
});

test("loadLinkedInPublisherConfig reads every value from the given env object", () => {
  const config = loadLinkedInPublisherConfig({
    LINKEDIN_ACCESS_TOKEN: "not-a-real-token",
    LINKEDIN_AUTHOR_URN: "urn:li:person:abc123",
    LINKEDIN_API_BASE_URL: "https://example.test",
    LINKEDIN_API_VERSION: "202401",
    LINKEDIN_REQUEST_TIMEOUT_MS: "5000",
  });
  assert.equal(config.accessToken, "not-a-real-token");
  assert.equal(config.authorUrn, "urn:li:person:abc123");
  assert.equal(config.apiBaseUrl, "https://example.test");
  assert.equal(config.apiVersion, "202401");
  assert.equal(config.requestTimeoutMs, 5000);
});

// --- explicit member-vs-organisation classification, never inferred ------

test("classifyAuthorUrn recognises a member URN", () => {
  assert.equal(classifyAuthorUrn("urn:li:person:abc123"), "member");
});

test("classifyAuthorUrn recognises an organisation URN", () => {
  assert.equal(classifyAuthorUrn("urn:li:organization:456"), "organization");
});

test("classifyAuthorUrn returns null for an unrecognised or malformed shape — never guessed", () => {
  assert.equal(classifyAuthorUrn("not-a-urn"), null);
  assert.equal(classifyAuthorUrn("urn:li:company:456"), null);
  assert.equal(classifyAuthorUrn(""), null);
  assert.equal(classifyAuthorUrn(null), null);
  assert.equal(classifyAuthorUrn(undefined), null);
});

test("DEFAULT_LIVE_MAX_ATTEMPTS is 1", () => {
  assert.equal(DEFAULT_LIVE_MAX_ATTEMPTS, 1);
});

test("resolveLiveMaxAttempts defaults to 1, accepts an override, rejects an invalid one", () => {
  assert.equal(resolveLiveMaxAttempts(undefined), 1);
  assert.equal(resolveLiveMaxAttempts("2"), 2);
  assert.throws(() => resolveLiveMaxAttempts("0"), RangeError);
});

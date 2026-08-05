// Unit tests for instagram-insights-adapter.mjs (DC-003-I028).
// global.fetch is stubbed for every test — no real network anywhere in
// this file, matching instagram-carousel-publisher-adapter.test.mjs (I027).

import test from "node:test";
import assert from "node:assert/strict";
import { createInstagramInsightsAdapter } from "../../src/instagram-insights-adapter.mjs";
import {
  InstagramAnalyticsConfigurationError,
  InstagramAnalyticsAuthenticationError,
  InstagramAnalyticsRateLimitError,
  InstagramInsightsMalformedResponseError,
} from "../../src/instagram-analytics-errors.mjs";

function buildConfig(overrides = {}) {
  return {
    accessToken: "fake-token-not-real",
    apiBaseUrl: "https://graph.example.test",
    apiVersion: "v21.0",
    requestTimeoutMs: 5000,
    ...overrides,
  };
}

function buildPublisherResult(overrides = {}) {
  return {
    publisher_result_id: "pub_igtest0000000001",
    carousel_id: "car_igtest0000000001",
    provider: "instagram",
    destination: "17800000000000001",
    provider_reference: "17800000000000099",
    ...overrides,
  };
}

function withStubbedFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test("requires INSTAGRAM_ACCESS_TOKEN before any request", () =>
  withStubbedFetch(
    () => {
      throw new Error("fetch must never be called");
    },
    async () => {
      const adapter = createInstagramInsightsAdapter(buildConfig({ accessToken: null }));
      await assert.rejects(() => adapter.collectAnalytics({ publisherResult: buildPublisherResult() }), InstagramAnalyticsConfigurationError);
    }
  ));

test("normalizes a complete response: reach available, engagement from likes/comments/shares/saved, views not-supported without a request", () =>
  withStubbedFetch(
    (url) => {
      assert.match(url, /\/17800000000000099\/insights\?/);
      assert.doesNotMatch(url, /impressions/);
      assert.doesNotMatch(url, /metric=[^&]*\bviews\b/); // "views" itself never requested
      return jsonResponse(200, {
        data: [
          { name: "reach", values: [{ value: 1240 }] },
          { name: "likes", values: [{ value: 85 }] },
          { name: "comments", values: [{ value: 12 }] },
          { name: "shares", values: [{ value: 6 }] },
          { name: "saved", values: [{ value: 20 }] },
        ],
      });
    },
    async (calls) => {
      const adapter = createInstagramInsightsAdapter(buildConfig());
      const result = await adapter.collectAnalytics({ publisherResult: buildPublisherResult(), collectedAt: "2026-08-06T00:00:00Z" });
      assert.equal(calls.length, 1, "exactly one request for the whole collection");
      assert.deepEqual(result.metrics.reach, { value: 1240, availability: "available" });
      assert.deepEqual(result.metrics.views, { value: null, availability: "not-supported" });
      assert.deepEqual(result.engagement.reactions, { value: 85, availability: "available" });
      assert.deepEqual(result.engagement.saves, { value: 20, availability: "available" });
      assert.equal(result.sourceType, "provider-api");
      assert.equal(result.sourceApiVersion, "v21.0");
    }
  ));

test("a metric absent from the response data array is normalized to unavailable, never zero — Meta's own documented behavior", () =>
  withStubbedFetch(
    () => jsonResponse(200, { data: [{ name: "reach", values: [{ value: 500 }] }] }), // likes/comments/shares/saved all missing
    async () => {
      const adapter = createInstagramInsightsAdapter(buildConfig());
      const result = await adapter.collectAnalytics({ publisherResult: buildPublisherResult() });
      assert.deepEqual(result.engagement.reactions, { value: null, availability: "unavailable" });
      assert.deepEqual(result.engagement.comments, { value: null, availability: "unavailable" });
    }
  ));

test("a legitimate zero value is preserved as available:0, distinct from an absent (unavailable) metric", () =>
  withStubbedFetch(
    () => jsonResponse(200, { data: [{ name: "reach", values: [{ value: 0 }] }, { name: "likes", values: [{ value: 0 }] }] }),
    async () => {
      const adapter = createInstagramInsightsAdapter(buildConfig());
      const result = await adapter.collectAnalytics({ publisherResult: buildPublisherResult() });
      assert.deepEqual(result.metrics.reach, { value: 0, availability: "available" });
      assert.deepEqual(result.engagement.reactions, { value: 0, availability: "available" });
    }
  ));

test("throws InstagramInsightsMalformedResponseError when the top-level data array is missing", () =>
  withStubbedFetch(
    () => jsonResponse(200, { notData: [] }),
    async () => {
      const adapter = createInstagramInsightsAdapter(buildConfig());
      await assert.rejects(() => adapter.collectAnalytics({ publisherResult: buildPublisherResult() }), InstagramInsightsMalformedResponseError);
    }
  ));

test("throws InstagramInsightsMalformedResponseError when a present metric has no valid numeric value", () =>
  withStubbedFetch(
    () => jsonResponse(200, { data: [{ name: "reach", values: [] }] }),
    async () => {
      const adapter = createInstagramInsightsAdapter(buildConfig());
      await assert.rejects(() => adapter.collectAnalytics({ publisherResult: buildPublisherResult() }), InstagramInsightsMalformedResponseError);
    }
  ));

test("HTTP 401/403 throws InstagramAnalyticsAuthenticationError", () =>
  withStubbedFetch(
    () => jsonResponse(401, {}),
    async () => {
      const adapter = createInstagramInsightsAdapter(buildConfig());
      await assert.rejects(() => adapter.collectAnalytics({ publisherResult: buildPublisherResult() }), InstagramAnalyticsAuthenticationError);
    }
  ));

test("HTTP 429 throws InstagramAnalyticsRateLimitError", () =>
  withStubbedFetch(
    () => ({ ...jsonResponse(429, {}), headers: { get: (name) => (name.toLowerCase() === "retry-after" ? "30" : null) } }),
    async () => {
      const adapter = createInstagramInsightsAdapter(buildConfig());
      await assert.rejects(() => adapter.collectAnalytics({ publisherResult: buildPublisherResult() }), InstagramAnalyticsRateLimitError);
    }
  ));

test("the access token is never leaked in a thrown error's message or diagnostic", () =>
  withStubbedFetch(
    () => jsonResponse(400, { error: { message: "Invalid parameter", type: "OAuthException" } }),
    async () => {
      const adapter = createInstagramInsightsAdapter(buildConfig({ accessToken: "EAABSECRETTOKENVALUE1234567890" }));
      try {
        await adapter.collectAnalytics({ publisherResult: buildPublisherResult() });
        assert.fail("expected an error");
      } catch (error) {
        const serialized = JSON.stringify(error) + error.message + JSON.stringify(error.diagnostic ?? {});
        assert.doesNotMatch(serialized, /EAABSECRETTOKENVALUE1234567890/);
      }
    }
  ));

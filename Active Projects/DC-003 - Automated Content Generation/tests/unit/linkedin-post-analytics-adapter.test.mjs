// Unit tests for linkedin-post-analytics-adapter.mjs (DC-003-I028).
// global.fetch is stubbed for every test — no real network anywhere in
// this file, matching linkedin-multi-image-publisher-adapter.test.mjs (I027).

import test from "node:test";
import assert from "node:assert/strict";
import { createLinkedInPostAnalyticsAdapter } from "../../src/linkedin-post-analytics-adapter.mjs";
import {
  LinkedInAnalyticsConfigurationError,
  LinkedInMemberAnalyticsNotEnabledError,
  LinkedInAnalyticsAuthenticationError,
  LinkedInAnalyticsMalformedResponseError,
} from "../../src/linkedin-analytics-errors.mjs";

function buildConfig(overrides = {}) {
  return {
    accessToken: "fake-token-not-real",
    apiBaseUrl: "https://api.example.test",
    apiVersion: "202601",
    requestTimeoutMs: 5000,
    memberPostAnalyticsEnabled: false,
    ...overrides,
  };
}

function orgPublisherResult(overrides = {}) {
  return {
    publisher_result_id: "pub_litest00000001",
    carousel_id: "car_litest00000001",
    provider: "linkedin",
    destination: "urn:li:organization:12345",
    provider_reference: "urn:li:share:7000000000000000001",
    ...overrides,
  };
}

function memberPublisherResult(overrides = {}) {
  return {
    publisher_result_id: "pub_litest00000002",
    carousel_id: "car_litest00000002",
    provider: "linkedin",
    destination: "urn:li:person:98765",
    provider_reference: "urn:li:share:7000000000000000002",
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

// --- configuration -----------------------------------------------------

test("requires LINKEDIN_ACCESS_TOKEN / LINKEDIN_API_VERSION before any request", () =>
  withStubbedFetch(
    () => {
      throw new Error("fetch must never be called");
    },
    async () => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig({ accessToken: null }));
      await assert.rejects(() => adapter.collectAnalytics({ publisherResult: orgPublisherResult() }), LinkedInAnalyticsConfigurationError);

      const adapter2 = createLinkedInPostAnalyticsAdapter(buildConfig({ apiVersion: null }));
      await assert.rejects(() => adapter2.collectAnalytics({ publisherResult: orgPublisherResult() }), LinkedInAnalyticsConfigurationError);
    }
  ));

test("an unrecognized destination URN fails before any request — never silently guesses an author type", () =>
  withStubbedFetch(
    () => {
      throw new Error("fetch must never be called");
    },
    async () => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig());
      await assert.rejects(
        () => adapter.collectAnalytics({ publisherResult: orgPublisherResult({ destination: "not-a-urn" }) }),
        LinkedInAnalyticsConfigurationError
      );
    }
  ));

// --- organization path ---------------------------------------------------

test("organization path: one request, correct organizationalEntity/shares params, normalizes totalShareStatistics", () =>
  withStubbedFetch(
    (url) => {
      assert.match(url, /organizationalEntityShareStatistics/);
      assert.match(url, /organizationalEntity=urn%3Ali%3Aorganization%3A12345/);
      assert.match(url, /shares=List\(/);
      return jsonResponse(200, {
        elements: [
          {
            organizationalEntity: "urn:li:organization:12345",
            share: "urn:li:share:7000000000000000001",
            totalShareStatistics: {
              clickCount: 78,
              commentCount: 24,
              engagement: 0.02,
              impressionCount: 5287,
              likeCount: 14,
              shareCount: 5,
              uniqueImpressionsCount: 4000,
            },
          },
        ],
      });
    },
    async (calls) => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig());
      const result = await adapter.collectAnalytics({ publisherResult: orgPublisherResult() });
      assert.equal(calls.length, 1, "organization path is exactly one request");
      assert.deepEqual(result.metrics.impressions, { value: 5287, availability: "available" });
      assert.deepEqual(result.metrics.unique_impressions, { value: 4000, availability: "available" });
      assert.deepEqual(result.engagement.reactions, { value: 14, availability: "available" });
      assert.deepEqual(result.engagement.comments, { value: 24, availability: "available" });
      assert.deepEqual(result.engagement.shares, { value: 5, availability: "available" });
      assert.deepEqual(result.engagement.saves, { value: null, availability: "not-supported" });
    }
  ));

test("organization path: a ugcPost reference uses the ugcPosts= param instead of shares=", () =>
  withStubbedFetch(
    (url) => {
      assert.match(url, /ugcPosts=List\(/);
      return jsonResponse(200, { elements: [] });
    },
    async () => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig());
      await adapter.collectAnalytics({ publisherResult: orgPublisherResult({ provider_reference: "urn:li:ugcPost:7000000000000000003" }) });
    }
  ));

test("organization path: an empty elements array is LinkedIn's own documented legitimate zero, never unavailable", () =>
  withStubbedFetch(
    () => jsonResponse(200, { elements: [] }),
    async () => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig());
      const result = await adapter.collectAnalytics({ publisherResult: orgPublisherResult() });
      assert.deepEqual(result.metrics.impressions, { value: 0, availability: "available" });
      assert.deepEqual(result.engagement.reactions, { value: 0, availability: "available" });
    }
  ));

test("organization path: throws LinkedInAnalyticsMalformedResponseError when totalShareStatistics is missing required fields", () =>
  withStubbedFetch(
    () => jsonResponse(200, { elements: [{ totalShareStatistics: { commentCount: 1 } }] }),
    async () => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig());
      await assert.rejects(() => adapter.collectAnalytics({ publisherResult: orgPublisherResult() }), LinkedInAnalyticsMalformedResponseError);
    }
  ));

// --- member path -----------------------------------------------------------

test("member path: fails before any request when LINKEDIN_MEMBER_POST_ANALYTICS_ENABLED is not set", () =>
  withStubbedFetch(
    () => {
      throw new Error("fetch must never be called");
    },
    async () => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig({ memberPostAnalyticsEnabled: false }));
      await assert.rejects(() => adapter.collectAnalytics({ publisherResult: memberPublisherResult() }), LinkedInMemberAnalyticsNotEnabledError);
    }
  ));

test("member path: five sequential requests (one per metric), each with the correct queryType and entity encoding", () =>
  withStubbedFetch(
    (url, init, callNumber) => {
      assert.match(url, /memberCreatorPostAnalytics/);
      assert.match(url, /entity=\(share:urn%3Ali%3Ashare%3A7000000000000000002\)/);
      const queryTypes = ["IMPRESSION", "MEMBERS_REACHED", "RESHARE", "REACTION", "COMMENT"];
      assert.match(url, new RegExp(`queryType=${queryTypes[callNumber - 1]}`));
      return jsonResponse(200, { elements: [{ count: callNumber * 10, metricType: queryTypes[callNumber - 1] }] });
    },
    async (calls) => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig({ memberPostAnalyticsEnabled: true }));
      const result = await adapter.collectAnalytics({ publisherResult: memberPublisherResult() });
      assert.equal(calls.length, 5, "member path costs five requests, one per metric");
      assert.deepEqual(result.metrics.impressions, { value: 10, availability: "available" });
      assert.deepEqual(result.metrics.members_reached, { value: 20, availability: "available" });
      assert.deepEqual(result.engagement.reactions, { value: 40, availability: "available" });
      assert.deepEqual(result.engagement.comments, { value: 50, availability: "available" });
      assert.deepEqual(result.engagement.saves, { value: null, availability: "not-supported" });
    }
  ));

test("member path: an empty elements array is conservatively unavailable, never assumed zero (no documented convention for this endpoint)", () =>
  withStubbedFetch(
    () => jsonResponse(200, { elements: [] }),
    async () => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig({ memberPostAnalyticsEnabled: true }));
      const result = await adapter.collectAnalytics({ publisherResult: memberPublisherResult() });
      assert.deepEqual(result.metrics.impressions, { value: null, availability: "unavailable" });
    }
  ));

test("member path: handles the older nested-object metricType response shape (pre li-lms-2026-05)", () =>
  withStubbedFetch(
    (url, init, callNumber) => {
      const queryTypes = ["IMPRESSION", "MEMBERS_REACHED", "RESHARE", "REACTION", "COMMENT"];
      return jsonResponse(200, {
        elements: [{ count: 7, metricType: { "com.linkedin.adsexternalapi.memberanalytics.v1.CreatorPostAnalyticsMetricTypeV1": queryTypes[callNumber - 1] } }],
      });
    },
    async () => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig({ memberPostAnalyticsEnabled: true }));
      const result = await adapter.collectAnalytics({ publisherResult: memberPublisherResult() });
      assert.deepEqual(result.metrics.impressions, { value: 7, availability: "available" });
    }
  ));

test("member path: a mismatched metricType in the response throws LinkedInAnalyticsMalformedResponseError, stops the sequence", () =>
  withStubbedFetch(
    () => jsonResponse(200, { elements: [{ count: 7, metricType: "WRONG_METRIC" }] }),
    async (calls) => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig({ memberPostAnalyticsEnabled: true }));
      await assert.rejects(() => adapter.collectAnalytics({ publisherResult: memberPublisherResult() }), LinkedInAnalyticsMalformedResponseError);
      assert.equal(calls.length, 1, "stops immediately on the first malformed metric, no further requests");
    }
  ));

// --- transport / safe diagnostics -----------------------------------------

test("HTTP 401/403 throws LinkedInAnalyticsAuthenticationError", () =>
  withStubbedFetch(
    () => jsonResponse(401, {}),
    async () => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig());
      await assert.rejects(() => adapter.collectAnalytics({ publisherResult: orgPublisherResult() }), LinkedInAnalyticsAuthenticationError);
    }
  ));

test("the access token is never leaked in a thrown error", () =>
  withStubbedFetch(
    () => jsonResponse(400, { message: "Invalid request" }),
    async () => {
      const adapter = createLinkedInPostAnalyticsAdapter(buildConfig({ accessToken: "SUPERSECRETLINKEDINTOKEN1234567890" }));
      try {
        await adapter.collectAnalytics({ publisherResult: orgPublisherResult() });
        assert.fail("expected an error");
      } catch (error) {
        const serialized = JSON.stringify(error) + error.message + JSON.stringify(error.diagnostic ?? {});
        assert.doesNotMatch(serialized, /SUPERSECRETLINKEDINTOKEN1234567890/);
      }
    }
  ));

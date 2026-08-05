import test from "node:test";
import assert from "node:assert/strict";
import { createMockInstagramInsightsAdapter } from "../../src/instagram-mock-insights-adapter.mjs";
import { InstagramAnalyticsClientError, InstagramInsightsMalformedResponseError } from "../../src/instagram-analytics-errors.mjs";

const publisherResult = { provider_reference: "17800000000000099" };

test("default mode 'completed' returns available metrics/engagement and increments callCount", async () => {
  const adapter = createMockInstagramInsightsAdapter();
  const result = await adapter.collectAnalytics({ publisherResult });
  assert.equal(result.metrics.reach.availability, "available");
  assert.equal(result.engagement.reactions.availability, "available");
  assert.equal(result.sourceType, "mock");
  assert.equal(adapter.callCount(), 1);
});

test("mode 'zero-engagement' returns legitimate zeros, not unavailable", async () => {
  const adapter = createMockInstagramInsightsAdapter({ mode: "zero-engagement" });
  const result = await adapter.collectAnalytics({ publisherResult });
  assert.deepEqual(result.engagement.reactions, { value: 0, availability: "available" });
});

test("mode 'unavailable-metrics' returns unavailable, never zero", async () => {
  const adapter = createMockInstagramInsightsAdapter({ mode: "unavailable-metrics" });
  const result = await adapter.collectAnalytics({ publisherResult });
  assert.deepEqual(result.metrics.reach, { value: null, availability: "unavailable" });
});

test("mode 'delayed' returns a mix of available and not-returned metrics", async () => {
  const adapter = createMockInstagramInsightsAdapter({ mode: "delayed" });
  const result = await adapter.collectAnalytics({ publisherResult });
  assert.equal(result.engagement.comments.availability, "not-returned");
  assert.equal(result.metrics.reach.availability, "available");
});

test("mode 'failure' rejects with InstagramAnalyticsClientError", async () => {
  const adapter = createMockInstagramInsightsAdapter({ mode: "failure" });
  await assert.rejects(() => adapter.collectAnalytics({ publisherResult }), InstagramAnalyticsClientError);
});

test("mode 'malformed' rejects with InstagramInsightsMalformedResponseError", async () => {
  const adapter = createMockInstagramInsightsAdapter({ mode: "malformed" });
  await assert.rejects(() => adapter.collectAnalytics({ publisherResult }), InstagramInsightsMalformedResponseError);
});

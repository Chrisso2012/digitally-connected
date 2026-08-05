import test from "node:test";
import assert from "node:assert/strict";
import { createMockLinkedInPostAnalyticsAdapter } from "../../src/linkedin-mock-post-analytics-adapter.mjs";
import { LinkedInAnalyticsClientError, LinkedInAnalyticsMalformedResponseError } from "../../src/linkedin-analytics-errors.mjs";

const publisherResult = { provider_reference: "urn:li:share:7000000000000000001" };

test("default mode 'completed' returns available metrics/engagement and increments callCount", async () => {
  const adapter = createMockLinkedInPostAnalyticsAdapter();
  const result = await adapter.collectAnalytics({ publisherResult });
  assert.equal(result.metrics.impressions.availability, "available");
  assert.equal(result.engagement.reactions.availability, "available");
  assert.equal(result.engagement.saves.availability, "not-supported");
  assert.equal(adapter.callCount(), 1);
});

test("mode 'zero-engagement' returns legitimate zeros, not unavailable", async () => {
  const adapter = createMockLinkedInPostAnalyticsAdapter({ mode: "zero-engagement" });
  const result = await adapter.collectAnalytics({ publisherResult });
  assert.deepEqual(result.engagement.reactions, { value: 0, availability: "available" });
});

test("mode 'unavailable-metrics' returns unavailable, never zero", async () => {
  const adapter = createMockLinkedInPostAnalyticsAdapter({ mode: "unavailable-metrics" });
  const result = await adapter.collectAnalytics({ publisherResult });
  assert.deepEqual(result.metrics.impressions, { value: null, availability: "unavailable" });
});

test("mode 'failure' rejects with LinkedInAnalyticsClientError", async () => {
  const adapter = createMockLinkedInPostAnalyticsAdapter({ mode: "failure" });
  await assert.rejects(() => adapter.collectAnalytics({ publisherResult }), LinkedInAnalyticsClientError);
});

test("mode 'malformed' rejects with LinkedInAnalyticsMalformedResponseError", async () => {
  const adapter = createMockLinkedInPostAnalyticsAdapter({ mode: "malformed" });
  await assert.rejects(() => adapter.collectAnalytics({ publisherResult }), LinkedInAnalyticsMalformedResponseError);
});

// DC-003-I028 — Social Analytics Collection Service: the only module that
// turns a Publisher Result into a persisted Social Analytics Snapshot.
// Composition only — no platform-specific logic, no captions/commentary
// authorship, no publishing. Architectural principle (brief): "Publisher
// Results prove that publication occurred. Social Analytics Snapshots
// record what happened after publication. The analytics layer observes
// published posts. It does not publish, edit, delete, or promote them."
//
// Eligibility (checked BEFORE any adapter/platform call — brief's own
// "If eligibility fails: make zero analytics requests; persist no
// snapshot" rule):
//   1. The Publisher Result must exist (propagates whatever
//      publisherResultStore.get() itself throws — this service invents no
//      new "not found" concept).
//   2. status must be "completed" (defensive — the schema already
//      guarantees this).
//   3. provider must be "instagram" or "linkedin" — a Google Drive
//      Publisher Result is rejected outright.
//   4. provider_reference must be a non-empty string — never inferred.
//
// One collection == one snapshot. Never overwrites a prior snapshot for
// the same Publisher Result (the store itself has no replace()) — repeated
// collection over time is the intended time-series usage (brief §10).

import { assertValidSocialAnalyticsAdapter } from "./social-analytics-adapter.mjs";
import { createSocialAnalyticsSnapshot } from "./social-analytics-snapshot.mjs";
import {
  UnsupportedAnalyticsProviderError,
  MissingProviderPostReferenceError,
  IneligiblePublisherResultForAnalyticsError,
  SocialAnalyticsCollectionFailedError,
} from "./social-analytics-service-errors.mjs";

const SUPPORTED_PROVIDERS = ["instagram", "linkedin"];

function checkEligibility(publisherResult) {
  if (publisherResult.status !== "completed") {
    throw new IneligiblePublisherResultForAnalyticsError(publisherResult.publisher_result_id, `status is "${publisherResult.status}", not "completed"`);
  }
  if (!SUPPORTED_PROVIDERS.includes(publisherResult.provider)) {
    throw new UnsupportedAnalyticsProviderError(publisherResult.publisher_result_id, publisherResult.provider);
  }
  if (typeof publisherResult.provider_reference !== "string" || publisherResult.provider_reference.trim() === "") {
    throw new MissingProviderPostReferenceError(publisherResult.publisher_result_id);
  }
}

/**
 * Collects analytics for one Publisher Result and persists a new,
 * immutable Social Analytics Snapshot.
 *
 * fields.publisherResultId — required.
 * fields.collectedAt — optional ISO date-time override (used by tests);
 *   defaults to dependencies.now().
 *
 * dependencies.publisherResultStore — required, an I025 Publisher Result
 *   Store instance.
 * dependencies.analyticsStore — required, a Social Analytics Store
 *   instance (see social-analytics-store.mjs).
 * dependencies.adapters — required, `{ instagram?: SocialAnalyticsAdapter,
 *   linkedin?: SocialAnalyticsAdapter }` — an adapter is only required for
 *   the provider the referenced Publisher Result actually uses; validated
 *   via assertValidSocialAnalyticsAdapter() before any call is made.
 * dependencies.now / idGenerator / validator / rootDir — forwarded to
 *   createSocialAnalyticsSnapshot() unchanged, for deterministic tests.
 *
 * Propagates whatever error publisherResultStore.get() itself throws.
 * Throws IneligiblePublisherResultForAnalyticsError,
 * UnsupportedAnalyticsProviderError, or MissingProviderPostReferenceError
 * before any adapter call is made — zero requests, no snapshot. Throws
 * SocialAnalyticsCollectionFailedError if the adapter's own
 * collectAnalytics() call fails — no snapshot is persisted. Propagates a
 * snapshot construction/validation error (malformed adapter output) as-is
 * — nothing is persisted in that case either.
 *
 * Returns a safe summary: { snapshotId, publisherResultId, carouselId,
 * provider, collectedAt, status: "completed" } — never the raw
 * metrics/engagement payload's provenance, never a credential.
 */
export async function collectSocialAnalytics(fields = {}, dependencies = {}) {
  const { publisherResultId, collectedAt } = fields;
  const { publisherResultStore, analyticsStore, adapters = {} } = dependencies;
  const now = dependencies.now ?? (() => new Date().toISOString());

  const publisherResult = publisherResultStore.get(publisherResultId);
  checkEligibility(publisherResult);

  const adapter = adapters[publisherResult.provider];
  assertValidSocialAnalyticsAdapter(adapter);

  const resolvedCollectedAt = collectedAt ?? now();

  let adapterResult;
  try {
    adapterResult = await adapter.collectAnalytics({ publisherResult, collectedAt: resolvedCollectedAt });
  } catch (cause) {
    throw new SocialAnalyticsCollectionFailedError(publisherResult.provider, publisherResult.publisher_result_id, cause.message ?? "collection failed", cause);
  }

  const snapshot = createSocialAnalyticsSnapshot(
    {
      publisherResultId: publisherResult.publisher_result_id,
      carouselId: publisherResult.carousel_id,
      provider: publisherResult.provider,
      destination: publisherResult.destination,
      providerPostReference: publisherResult.provider_reference,
      collectedAt: resolvedCollectedAt,
      metrics: adapterResult.metrics,
      engagement: adapterResult.engagement,
      source: { type: adapterResult.sourceType, providerApiVersion: adapterResult.sourceApiVersion ?? null },
    },
    { now, idGenerator: dependencies.idGenerator, validator: dependencies.validator, rootDir: dependencies.rootDir }
  );

  analyticsStore.save(snapshot);

  return {
    snapshotId: snapshot.analytics_snapshot_id,
    publisherResultId: publisherResult.publisher_result_id,
    carouselId: publisherResult.carousel_id,
    provider: publisherResult.provider,
    collectedAt: snapshot.collected_at,
    status: "completed",
  };
}

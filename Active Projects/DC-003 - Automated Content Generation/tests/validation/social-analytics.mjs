// DC-003-I028 — CLI for Social Analytics collection and read-back.
//
// Usage:
//   node tests/validation/social-analytics.mjs collect <publisherResultId> <publisherResultStoreDirectory> <analyticsStoreDirectory> [--live]
//   node tests/validation/social-analytics.mjs get <snapshotId> <analyticsStoreDirectory>
//   node tests/validation/social-analytics.mjs publisher <publisherResultId> <analyticsStoreDirectory>
//   node tests/validation/social-analytics.mjs carousel <carouselId> <analyticsStoreDirectory>
//   node tests/validation/social-analytics.mjs latest <publisherResultId> <analyticsStoreDirectory>
//
//   or: npm run social:analytics -- <subcommand> ...
//
// Default collection mode is MOCK, no network — matching every other
// live-capable CLI in this codebase. `--live` requires
// INSTAGRAM_ACCESS_TOKEN/INSTAGRAM_USER_ID or LINKEDIN_ACCESS_TOKEN
// (whichever the referenced Publisher Result's own provider needs) and
// permits exactly one collection attempt — no automatic retries. The
// request budget (how many individual HTTP requests that one collection
// will make) is printed BEFORE any request, since it differs sharply by
// platform and, for LinkedIn, by author type (organization: 1 request;
// member: 5 requests — see linkedin-post-analytics-adapter.mjs's own
// header comment).

import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import {
  InvalidPublisherResultStoreAdapterError,
  InvalidPublisherResultIdentifierError,
  PublisherResultNotFoundError,
  CorruptedPublisherResultError,
  PublisherResultPersistenceError,
} from "../../src/publisher-result-errors.mjs";
import { createLocalJsonSocialAnalyticsStoreAdapter } from "../../src/local-json-social-analytics-store-adapter.mjs";
import { createSocialAnalyticsStore } from "../../src/social-analytics-store.mjs";
import { collectSocialAnalytics } from "../../src/social-analytics-service.mjs";
import {
  InvalidSocialAnalyticsStoreAdapterError,
  InvalidSocialAnalyticsSnapshotIdentifierError,
  SocialAnalyticsSnapshotAlreadyExistsError,
  SocialAnalyticsSnapshotNotFoundError,
  CorruptedSocialAnalyticsSnapshotError,
  SocialAnalyticsPersistenceError,
  SocialAnalyticsSnapshotValidationError,
  InvalidSocialAnalyticsSnapshotInputError,
} from "../../src/social-analytics-errors.mjs";
import {
  UnsupportedAnalyticsProviderError,
  MissingProviderPostReferenceError,
  IneligiblePublisherResultForAnalyticsError,
  SocialAnalyticsCollectionFailedError,
} from "../../src/social-analytics-service-errors.mjs";
import { createMockInstagramInsightsAdapter } from "../../src/instagram-mock-insights-adapter.mjs";
import { createMockLinkedInPostAnalyticsAdapter } from "../../src/linkedin-mock-post-analytics-adapter.mjs";
import { createInstagramInsightsAdapter } from "../../src/instagram-insights-adapter.mjs";
import { createLinkedInPostAnalyticsAdapter } from "../../src/linkedin-post-analytics-adapter.mjs";
import { loadInstagramAnalyticsConfig, resolveLiveMaxAttempts as resolveInstagramMaxAttempts } from "../../src/instagram-analytics-config.mjs";
import { loadLinkedInAnalyticsConfig, resolveLiveMaxAttempts as resolveLinkedInMaxAttempts } from "../../src/linkedin-analytics-config.mjs";
import { classifyAuthorUrn } from "../../src/linkedin-publisher-config.mjs";

const KNOWN_ERRORS = [
  InvalidPublisherResultStoreAdapterError,
  InvalidPublisherResultIdentifierError,
  PublisherResultNotFoundError,
  CorruptedPublisherResultError,
  PublisherResultPersistenceError,
  InvalidSocialAnalyticsStoreAdapterError,
  InvalidSocialAnalyticsSnapshotIdentifierError,
  SocialAnalyticsSnapshotAlreadyExistsError,
  SocialAnalyticsSnapshotNotFoundError,
  CorruptedSocialAnalyticsSnapshotError,
  SocialAnalyticsPersistenceError,
  SocialAnalyticsSnapshotValidationError,
  InvalidSocialAnalyticsSnapshotInputError,
  UnsupportedAnalyticsProviderError,
  MissingProviderPostReferenceError,
  IneligiblePublisherResultForAnalyticsError,
  SocialAnalyticsCollectionFailedError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/social-analytics.mjs collect <publisherResultId> <publisherResultStoreDirectory> <analyticsStoreDirectory> [--live]");
  console.error("  node tests/validation/social-analytics.mjs get <snapshotId> <analyticsStoreDirectory>");
  console.error("  node tests/validation/social-analytics.mjs publisher <publisherResultId> <analyticsStoreDirectory>");
  console.error("  node tests/validation/social-analytics.mjs carousel <carouselId> <analyticsStoreDirectory>");
  console.error("  node tests/validation/social-analytics.mjs latest <publisherResultId> <analyticsStoreDirectory>");
  process.exit(1);
}

function printMetric(label, metric) {
  const value = metric.availability === "available" ? metric.value : `(${metric.availability})`;
  console.log(`    ${label.padEnd(18)} ${value}`);
}

function printSnapshot(snapshot) {
  console.log(`  analytics_snapshot_id: ${snapshot.analytics_snapshot_id}`);
  console.log(`  publisher_result_id:   ${snapshot.publisher_result_id}`);
  console.log(`  carousel_id:           ${snapshot.carousel_id}`);
  console.log(`  provider:              ${snapshot.provider}`);
  console.log(`  destination:           ${snapshot.destination}`);
  console.log(`  provider_post_ref:     ${snapshot.provider_post_reference}`);
  console.log(`  collected_at:          ${snapshot.collected_at}`);
  console.log(`  source:                ${snapshot.source.type} (api_version=${snapshot.source.provider_api_version})`);
  console.log("  metrics:");
  for (const [name, metric] of Object.entries(snapshot.metrics)) printMetric(name, metric);
  console.log("  engagement:");
  for (const key of ["reactions", "comments", "shares", "saves", "total"]) printMetric(key, snapshot.engagement[key]);
}

function buildPublisherResultStore(storeDirectory) {
  return createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: storeDirectory }) });
}

function buildAnalyticsStore(storeDirectory) {
  return createSocialAnalyticsStore({ adapter: createLocalJsonSocialAnalyticsStoreAdapter({ storageDir: storeDirectory }) });
}

function buildMockAdapters() {
  return { instagram: createMockInstagramInsightsAdapter(), linkedin: createMockLinkedInPostAnalyticsAdapter() };
}

function buildLiveAdapters() {
  return {
    instagram: createInstagramInsightsAdapter(loadInstagramAnalyticsConfig()),
    linkedin: createLinkedInPostAnalyticsAdapter(loadLinkedInAnalyticsConfig()),
  };
}

function reportRequestBudget(publisherResult) {
  if (publisherResult.provider === "instagram") {
    console.log(`Request budget: 1 request (Instagram media insights, maxAttempts=${resolveInstagramMaxAttempts()})`);
    return;
  }
  const authorType = classifyAuthorUrn(publisherResult.destination);
  const requests = authorType === "organization" ? 1 : 5;
  console.log(
    `Request budget: ${requests} request(s) (LinkedIn ${authorType ?? "unrecognized"}-author analytics, maxAttempts=${resolveLinkedInMaxAttempts()})`
  );
}

const [subcommand, ...rest] = process.argv.slice(2);
if (!subcommand) usageAndExit();

try {
  if (subcommand === "collect") {
    const args = rest.filter((a) => a !== "--live");
    const live = rest.includes("--live");
    const [publisherResultId, publisherResultStoreDirectory, analyticsStoreDirectory] = args;
    if (!publisherResultId || !publisherResultStoreDirectory || !analyticsStoreDirectory) usageAndExit();

    const publisherResultStore = buildPublisherResultStore(publisherResultStoreDirectory);
    const analyticsStore = buildAnalyticsStore(analyticsStoreDirectory);

    if (live) {
      const publisherResult = publisherResultStore.get(publisherResultId);
      reportRequestBudget(publisherResult);
    } else {
      console.log("Mock mode — no network requests will be made.");
    }

    const adapters = live ? buildLiveAdapters() : buildMockAdapters();
    const summary = await collectSocialAnalytics({ publisherResultId }, { publisherResultStore, analyticsStore, adapters });
    console.log("Collection complete");
    console.log(`  snapshot_id:         ${summary.snapshotId}`);
    console.log(`  publisher_result_id: ${summary.publisherResultId}`);
    console.log(`  carousel_id:         ${summary.carouselId}`);
    console.log(`  provider:            ${summary.provider}`);
    console.log(`  collected_at:        ${summary.collectedAt}`);
  } else if (subcommand === "get") {
    const [snapshotId, analyticsStoreDirectory] = rest;
    if (!snapshotId || !analyticsStoreDirectory) usageAndExit();
    const snapshot = buildAnalyticsStore(analyticsStoreDirectory).get(snapshotId);
    console.log("Snapshot found");
    printSnapshot(snapshot);
  } else if (subcommand === "publisher") {
    const [publisherResultId, analyticsStoreDirectory] = rest;
    if (!publisherResultId || !analyticsStoreDirectory) usageAndExit();
    const snapshots = buildAnalyticsStore(analyticsStoreDirectory).findByPublisherResult(publisherResultId);
    console.log(`${snapshots.length} snapshot(s) for publisher result "${publisherResultId}"`);
    for (const snapshot of snapshots) {
      printSnapshot(snapshot);
      console.log("  ---");
    }
  } else if (subcommand === "carousel") {
    const [carouselId, analyticsStoreDirectory] = rest;
    if (!carouselId || !analyticsStoreDirectory) usageAndExit();
    const snapshots = buildAnalyticsStore(analyticsStoreDirectory).findByCarousel(carouselId);
    console.log(`${snapshots.length} snapshot(s) for carousel "${carouselId}"`);
    for (const snapshot of snapshots) {
      printSnapshot(snapshot);
      console.log("  ---");
    }
  } else if (subcommand === "latest") {
    const [publisherResultId, analyticsStoreDirectory] = rest;
    if (!publisherResultId || !analyticsStoreDirectory) usageAndExit();
    const snapshot = buildAnalyticsStore(analyticsStoreDirectory).latestByPublisherResult(publisherResultId);
    if (!snapshot) {
      console.log(`No snapshots recorded yet for publisher result "${publisherResultId}"`);
    } else {
      console.log("Latest snapshot");
      printSnapshot(snapshot);
    }
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (KNOWN_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    throw error;
  }
  process.exit(1);
}

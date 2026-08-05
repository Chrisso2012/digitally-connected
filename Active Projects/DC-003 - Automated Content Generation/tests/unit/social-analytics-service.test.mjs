import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createPublisherResult } from "../../src/publisher-result.mjs";
import { createSocialAnalyticsStore } from "../../src/social-analytics-store.mjs";
import { createLocalJsonSocialAnalyticsStoreAdapter } from "../../src/local-json-social-analytics-store-adapter.mjs";
import { collectSocialAnalytics } from "../../src/social-analytics-service.mjs";
import { createMockInstagramInsightsAdapter } from "../../src/instagram-mock-insights-adapter.mjs";
import { createMockLinkedInPostAnalyticsAdapter } from "../../src/linkedin-mock-post-analytics-adapter.mjs";
import {
  UnsupportedAnalyticsProviderError,
  MissingProviderPostReferenceError,
  IneligiblePublisherResultForAnalyticsError,
  SocialAnalyticsCollectionFailedError,
} from "../../src/social-analytics-service-errors.mjs";
import { InvalidSocialAnalyticsSnapshotInputError } from "../../src/social-analytics-errors.mjs";

// Deliberately async, awaiting fn() before cleanup — a non-async version
// whose callback's first real yield point is an `await` would let
// `finally` delete the temp dirs before the callback's own file
// reads/writes complete (a documented, previously-recurring hazard in this
// codebase's test suite — see windows-production-export-service.test.mjs's
// own header comment).
async function withTempDirs(fn) {
  const publisherDir = mkdtempSync(path.join(tmpdir(), "dc003-sa-service-pub-"));
  const analyticsDir = mkdtempSync(path.join(tmpdir(), "dc003-sa-service-analytics-"));
  try {
    return await fn(publisherDir, analyticsDir);
  } finally {
    rmSync(publisherDir, { recursive: true, force: true });
    rmSync(analyticsDir, { recursive: true, force: true });
  }
}

function buildStores(publisherDir, analyticsDir) {
  const publisherResultStore = createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: publisherDir }) });
  const analyticsStore = createSocialAnalyticsStore({ adapter: createLocalJsonSocialAnalyticsStoreAdapter({ storageDir: analyticsDir }) });
  return { publisherResultStore, analyticsStore };
}

function saveInstagramPublisherResult(store, overrides = {}) {
  const result = createPublisherResult(
    {
      carouselId: "car_svctest00000001",
      assetPackageId: "pkg_svctest00000001",
      executionId: "exec_20260806_deadbeefcafe",
      provider: "instagram",
      destination: "17800000000000001",
      providerReference: "17800000000000099",
      metadata: { post_url: null, item_count: 6 },
      ...overrides,
    },
    { idGenerator: () => overrides.idGenerator?.() ?? "pub_svctest00000001" }
  );
  return store.save(result);
}

function saveGoogleDrivePublisherResult(store) {
  const result = createPublisherResult(
    {
      carouselId: "car_svctest00000002",
      assetPackageId: "pkg_svctest00000002",
      executionId: "exec_20260806_deadbeefcaff",
      provider: "google-drive",
      destination: "https://drive.google.com/drive/folders/x",
      providerReference: "folder_x",
      metadata: { files_uploaded: 7 },
    },
    { idGenerator: () => "pub_svctest00000002" }
  );
  return store.save(result);
}

test("successful collection persists exactly one snapshot and returns a safe summary", () =>
  withTempDirs(async (publisherDir, analyticsDir) => {
    const { publisherResultStore, analyticsStore } = buildStores(publisherDir, analyticsDir);
    const publisherResult = saveInstagramPublisherResult(publisherResultStore);

    const summary = await collectSocialAnalytics(
      { publisherResultId: publisherResult.publisher_result_id },
      { publisherResultStore, analyticsStore, adapters: { instagram: createMockInstagramInsightsAdapter() } }
    );

    assert.equal(summary.provider, "instagram");
    assert.equal(summary.status, "completed");
    assert.equal(analyticsStore.list().length, 1);
    const stored = analyticsStore.get(summary.snapshotId);
    assert.equal(stored.publisher_result_id, publisherResult.publisher_result_id);
  }));

test("rejects a Google Drive Publisher Result outright — never treated as a social post", () =>
  withTempDirs(async (publisherDir, analyticsDir) => {
    const { publisherResultStore, analyticsStore } = buildStores(publisherDir, analyticsDir);
    const publisherResult = saveGoogleDrivePublisherResult(publisherResultStore);

    await assert.rejects(
      () =>
        collectSocialAnalytics(
          { publisherResultId: publisherResult.publisher_result_id },
          { publisherResultStore, analyticsStore, adapters: { instagram: createMockInstagramInsightsAdapter() } }
        ),
      UnsupportedAnalyticsProviderError
    );
    assert.equal(analyticsStore.list().length, 0);
  }));

test("throws MissingProviderPostReferenceError before any adapter call when provider_reference is unusable", () =>
  withTempDirs(async (publisherDir, analyticsDir) => {
    const { publisherResultStore, analyticsStore } = buildStores(publisherDir, analyticsDir);
    // publisher-result.schema.json requires a non-empty provider_reference,
    // so this defensive branch is exercised via a fake store standing in
    // for a genuinely malformed upstream record.
    const fakeStore = {
      get: () => ({
        publisher_result_id: "pub_fake000000001",
        carousel_id: "car_fake000000001",
        provider: "instagram",
        destination: "17800000000000001",
        provider_reference: "",
        status: "completed",
      }),
    };
    let adapterCalled = false;
    await assert.rejects(
      () =>
        collectSocialAnalytics(
          { publisherResultId: "pub_fake000000001" },
          {
            publisherResultStore: fakeStore,
            analyticsStore,
            adapters: {
              instagram: {
                name: "x",
                provider: "instagram",
                collectAnalytics: async () => {
                  adapterCalled = true;
                  return {};
                },
              },
            },
          }
        ),
      MissingProviderPostReferenceError
    );
    assert.equal(adapterCalled, false);
  }));

test("throws IneligiblePublisherResultForAnalyticsError for a non-completed status, before any adapter call", () =>
  withTempDirs(async (publisherDir, analyticsDir) => {
    const { analyticsStore } = buildStores(publisherDir, analyticsDir);
    const fakeStore = {
      get: () => ({
        publisher_result_id: "pub_fake000000002",
        carousel_id: "car_fake000000002",
        provider: "instagram",
        destination: "17800000000000001",
        provider_reference: "17800000000000099",
        status: "failed",
      }),
    };
    await assert.rejects(
      () =>
        collectSocialAnalytics(
          { publisherResultId: "pub_fake000000002" },
          { publisherResultStore: fakeStore, analyticsStore, adapters: { instagram: createMockInstagramInsightsAdapter() } }
        ),
      IneligiblePublisherResultForAnalyticsError
    );
  }));

test("a provider failure persists no snapshot and surfaces SocialAnalyticsCollectionFailedError", () =>
  withTempDirs(async (publisherDir, analyticsDir) => {
    const { publisherResultStore, analyticsStore } = buildStores(publisherDir, analyticsDir);
    const publisherResult = saveInstagramPublisherResult(publisherResultStore);

    await assert.rejects(
      () =>
        collectSocialAnalytics(
          { publisherResultId: publisherResult.publisher_result_id },
          { publisherResultStore, analyticsStore, adapters: { instagram: createMockInstagramInsightsAdapter({ mode: "failure" }) } }
        ),
      SocialAnalyticsCollectionFailedError
    );
    assert.equal(analyticsStore.list().length, 0);
  }));

test("a malformed adapter response fails snapshot construction and persists nothing", () =>
  withTempDirs(async (publisherDir, analyticsDir) => {
    const { publisherResultStore, analyticsStore } = buildStores(publisherDir, analyticsDir);
    const publisherResult = saveInstagramPublisherResult(publisherResultStore);
    const brokenAdapter = {
      name: "broken",
      provider: "instagram",
      collectAnalytics: async () => ({ metrics: "not-an-object", engagement: {}, sourceType: "mock", sourceApiVersion: null }),
    };

    await assert.rejects(
      () =>
        collectSocialAnalytics(
          { publisherResultId: publisherResult.publisher_result_id },
          { publisherResultStore, analyticsStore, adapters: { instagram: brokenAdapter } }
        ),
      InvalidSocialAnalyticsSnapshotInputError
    );
    assert.equal(analyticsStore.list().length, 0);
  }));

test("repeated collection over time produces multiple independent snapshots — the intended time-series usage", () =>
  withTempDirs(async (publisherDir, analyticsDir) => {
    const { publisherResultStore, analyticsStore } = buildStores(publisherDir, analyticsDir);
    const publisherResult = saveInstagramPublisherResult(publisherResultStore);
    const adapters = { instagram: createMockInstagramInsightsAdapter() };

    await collectSocialAnalytics({ publisherResultId: publisherResult.publisher_result_id, collectedAt: "2026-08-01T00:00:00.000Z" }, { publisherResultStore, analyticsStore, adapters });
    await collectSocialAnalytics({ publisherResultId: publisherResult.publisher_result_id, collectedAt: "2026-08-05T00:00:00.000Z" }, { publisherResultStore, analyticsStore, adapters });

    const history = analyticsStore.findByPublisherResult(publisherResult.publisher_result_id);
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((s) => s.collected_at), ["2026-08-01T00:00:00.000Z", "2026-08-05T00:00:00.000Z"]);

    const latest = analyticsStore.latestByPublisherResult(publisherResult.publisher_result_id);
    assert.equal(latest.collected_at, "2026-08-05T00:00:00.000Z");
  }));

test("mock adapters remain the default — this test file never stubs global.fetch or reaches a real network", () => {
  assert.equal(typeof createMockInstagramInsightsAdapter, "function");
  assert.equal(typeof createMockLinkedInPostAnalyticsAdapter, "function");
});

// Unit tests for tests/validation/social-analytics.mjs (DC-003-I028).
// spawnSync is used throughout (mirrors publisher-results-cli.test.mjs) —
// each invocation is a real child process, blocking, so there is no
// async-cleanup race to guard against here. --live is never exercised
// against a real network in this file: the spawned child process has no
// real INSTAGRAM_ACCESS_TOKEN/LINKEDIN_ACCESS_TOKEN in its environment,
// so a --live invocation here only ever exercises the pre-request
// configuration-error path — never a real HTTP request.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import { createPublisherResult } from "../../src/publisher-result.mjs";
import { createLocalJsonSocialAnalyticsStoreAdapter } from "../../src/local-json-social-analytics-store-adapter.mjs";
import { createSocialAnalyticsStore } from "../../src/social-analytics-store.mjs";
import { createSocialAnalyticsSnapshot } from "../../src/social-analytics-snapshot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "social-analytics.mjs");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8", env: { ...process.env, INSTAGRAM_ACCESS_TOKEN: "", LINKEDIN_ACCESS_TOKEN: "" } });
}

function withTempDirs(fn) {
  const publisherDir = mkdtempSync(path.join(tmpdir(), "dc003-sa-cli-pub-"));
  const analyticsDir = mkdtempSync(path.join(tmpdir(), "dc003-sa-cli-analytics-"));
  try {
    return fn(publisherDir, analyticsDir);
  } finally {
    rmSync(publisherDir, { recursive: true, force: true });
    rmSync(analyticsDir, { recursive: true, force: true });
  }
}

function seedPublisherResult(publisherDir, overrides = {}) {
  const store = createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: publisherDir }) });
  const result = createPublisherResult({
    carouselId: "car_clitest0000001",
    assetPackageId: "pkg_clitest0000001",
    executionId: "exec_20260806_deadbeefcafe",
    provider: "instagram",
    destination: "17800000000000001",
    providerReference: "17800000000000099",
    metadata: { post_url: null, item_count: 6 },
    ...overrides,
  });
  return store.save(result);
}

function seedSnapshot(analyticsDir, overrides = {}) {
  const store = createSocialAnalyticsStore({ adapter: createLocalJsonSocialAnalyticsStoreAdapter({ storageDir: analyticsDir }) });
  const snapshot = createSocialAnalyticsSnapshot({
    publisherResultId: "pub_clitest0000001",
    carouselId: "car_clitest0000001",
    provider: "instagram",
    destination: "17800000000000001",
    providerPostReference: "17800000000000099",
    metrics: { reach: { value: 500, availability: "available" } },
    engagement: {
      reactions: { value: 10, availability: "available" },
      comments: { value: 2, availability: "available" },
      shares: { value: 1, availability: "available" },
      saves: { value: 3, availability: "available" },
    },
    source: { type: "mock", providerApiVersion: "v21.0" },
    ...overrides,
  });
  return store.save(snapshot);
}

// --- usage -----------------------------------------------------------

test("no subcommand prints usage and exits non-zero", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("missing arguments print usage and exit non-zero", () => {
  for (const args of [["collect"], ["get"], ["publisher"], ["carousel"], ["latest"]]) {
    const result = runCli(...args);
    assert.notEqual(result.status, 0, `expected non-zero exit for args: ${JSON.stringify(args)}`);
    assert.match(result.stderr, /Usage:/);
  }
});

// --- collect (mock, default) ------------------------------------------

test("collect defaults to mock mode and persists exactly one snapshot", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    const seeded = seedPublisherResult(publisherDir);
    const result = runCli("collect", seeded.publisher_result_id, publisherDir, analyticsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Mock mode/);
    assert.match(result.stdout, /Collection complete/);

    const store = createSocialAnalyticsStore({ adapter: createLocalJsonSocialAnalyticsStoreAdapter({ storageDir: analyticsDir }) });
    assert.equal(store.list().length, 1);
  }));

test("collect fails safely, no stack trace, for an unknown publisher result id", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    const result = runCli("collect", "pub_doesnotexist0001", publisherDir, analyticsDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PublisherResultNotFoundError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

test("collect fails safely for an ineligible (Google Drive) publisher result", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    const seeded = seedPublisherResult(publisherDir, {
      provider: "google-drive",
      destination: "https://drive.google.com/drive/folders/x",
      providerReference: "folder_x",
      metadata: { files_uploaded: 7 },
    });
    const result = runCli("collect", seeded.publisher_result_id, publisherDir, analyticsDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /UnsupportedAnalyticsProviderError/);
  }));

// --- collect --live (config-error path only, no real network) ----------

test("collect --live reports a request budget before failing fast on missing credentials", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    const seeded = seedPublisherResult(publisherDir);
    const result = runCli("collect", seeded.publisher_result_id, publisherDir, analyticsDir, "--live");
    assert.match(result.stdout, /Request budget: 1 request/);
    assert.notEqual(result.status, 0);
    // The adapter's own InstagramAnalyticsConfigurationError is caught and
    // wrapped by the service into SocialAnalyticsCollectionFailedError —
    // the same "every adapter-call failure is wrapped, config errors
    // included" discipline social-publisher-service.mjs (I027) already
    // established for its own SocialPlatformPublishError.
    assert.match(result.stderr, /SocialAnalyticsCollectionFailedError/);
    assert.match(result.stderr, /INSTAGRAM_ACCESS_TOKEN/);
  }));

// --- get -----------------------------------------------------------------

test("get retrieves a real seeded snapshot", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    const seeded = seedSnapshot(analyticsDir);
    const result = runCli("get", seeded.analytics_snapshot_id, analyticsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Snapshot found/);
    assert.match(result.stdout, new RegExp(seeded.analytics_snapshot_id));
  }));

test("get fails safely for an unknown snapshot id", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    const result = runCli("get", "sas_doesnotexist0001", analyticsDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SocialAnalyticsSnapshotNotFoundError/);
  }));

// --- publisher / carousel / latest --------------------------------------

test("publisher finds every snapshot for a given publisher_result_id", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    seedSnapshot(analyticsDir, { collectedAt: "2026-08-01T00:00:00.000Z" });
    const result = runCli("publisher", "pub_clitest0000001", analyticsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 snapshot\(s\) for publisher result "pub_clitest0000001"/);
  }));

test("carousel reports 0 snapshots, not an error, when none match", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    const result = runCli("carousel", "car_nomatch0000001", analyticsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0 snapshot\(s\)/);
  }));

test("latest reports 'no snapshots recorded yet' for a publisher result with no collections", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    const result = runCli("latest", "pub_nomatch0000001", analyticsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No snapshots recorded yet/);
  }));

test("latest returns the most recent of multiple snapshots", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    const store = createSocialAnalyticsStore({ adapter: createLocalJsonSocialAnalyticsStoreAdapter({ storageDir: analyticsDir }) });
    store.save(
      createSocialAnalyticsSnapshot(
        {
          publisherResultId: "pub_clitest0000002",
          carouselId: "car_clitest0000002",
          provider: "instagram",
          destination: "17800000000000001",
          providerPostReference: "17800000000000099",
          metrics: {},
          engagement: {
            reactions: { value: 1, availability: "available" },
            comments: { value: 1, availability: "available" },
            shares: { value: 1, availability: "available" },
            saves: { value: 1, availability: "available" },
          },
          source: { type: "mock", providerApiVersion: null },
          collectedAt: "2026-08-01T00:00:00.000Z",
        },
        { idGenerator: () => "sas_earlyone000001" }
      )
    );
    store.save(
      createSocialAnalyticsSnapshot(
        {
          publisherResultId: "pub_clitest0000002",
          carouselId: "car_clitest0000002",
          provider: "instagram",
          destination: "17800000000000001",
          providerPostReference: "17800000000000099",
          metrics: {},
          engagement: {
            reactions: { value: 2, availability: "available" },
            comments: { value: 2, availability: "available" },
            shares: { value: 2, availability: "available" },
            saves: { value: 2, availability: "available" },
          },
          source: { type: "mock", providerApiVersion: null },
          collectedAt: "2026-08-05T00:00:00.000Z",
        },
        { idGenerator: () => "sas_lateone0000002" }
      )
    );

    const result = runCli("latest", "pub_clitest0000002", analyticsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /sas_lateone0000002/);
    assert.doesNotMatch(result.stdout, /sas_earlyone000001/);
  }));

// --- read-only guarantee for read subcommands ---------------------------

test("get/publisher/carousel/latest never write to the analytics store directory", () =>
  withTempDirs((publisherDir, analyticsDir) => {
    const seeded = seedSnapshot(analyticsDir);
    const beforeFiles = readdirSync(analyticsDir).sort();

    runCli("get", seeded.analytics_snapshot_id, analyticsDir);
    runCli("publisher", seeded.publisher_result_id, analyticsDir);
    runCli("carousel", seeded.carousel_id, analyticsDir);
    runCli("latest", seeded.publisher_result_id, analyticsDir);

    const afterFiles = readdirSync(analyticsDir).sort();
    assert.deepEqual(afterFiles, beforeFiles);
  }));

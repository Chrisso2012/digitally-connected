import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "control-centre.mjs");
const CAROUSEL_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "carousel-store.mjs");
const FIXTURE_PATH = path.join(PROJECT_ROOT, "tests", "fixtures", "finished-carousel.example.json");

// No network anywhere in this CLI's own code path — but env is still
// scrubbed of provider credentials so a developer's real .env (if any) in
// this shell can never make a health check's "configured" status
// non-deterministic across machines.
const CLEAN_ENV = {
  ...process.env,
  LLM_API_KEY: undefined,
  TEMPLATED_API_KEY: undefined,
  GOOGLE_DRIVE_CLIENT_ID: undefined,
  GOOGLE_DRIVE_CLIENT_SECRET: undefined,
  GOOGLE_DRIVE_REFRESH_TOKEN: undefined,
  GOOGLE_DRIVE_ROOT_FOLDER_ID: undefined,
};

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8", env: CLEAN_ENV });
}

function runCarouselCli(...args) {
  return spawnSync(process.execPath, [CAROUSEL_CLI_PATH, ...args], { encoding: "utf-8", env: CLEAN_ENV });
}

function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-control-centre-cli-"));
  const carouselDir = path.join(base, "carousels");
  const metricsDir = path.join(base, "metrics");
  const publisherResultDir = path.join(base, "publisher-results");
  try {
    return fn({ base, carouselDir, metricsDir, publisherResultDir });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("dashboard on an empty set of stores prints a clean, plain-text overview with no ANSI codes", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const result = runCli("dashboard", carouselDir, metricsDir, publisherResultDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DC-003 CONTROL CENTRE/);
    assert.match(result.stdout, /System Health/);
    assert.match(result.stdout, /Production/);
    assert.match(result.stdout, /Recent Jobs \(0\)/);
    assert.match(result.stdout, /Recent Activity \(0\)/);
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(result.stdout, /\x1b\[/, "must contain no ANSI escape codes, per the I024 brief");
  });
});

test("dashboard reflects a real saved carousel via the CLI, end to end", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const saveResult = runCarouselCli("save", FIXTURE_PATH, carouselDir);
    assert.equal(saveResult.status, 0, saveResult.stderr);

    const dashboardResult = runCli("dashboard", carouselDir, metricsDir, publisherResultDir);
    assert.equal(dashboardResult.status, 0, dashboardResult.stderr);
    assert.match(dashboardResult.stdout, /Completed\s+1/);
    assert.match(dashboardResult.stdout, /car_01J9X9C7/);
  });
});

test("health subcommand prints only the System Health section, including Publisher Results", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const result = runCli("health", carouselDir, metricsDir, publisherResultDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /System Health/);
    assert.match(result.stdout, /Publisher Results/);
    assert.match(result.stdout, /Overall:/);
    assert.doesNotMatch(result.stdout, /DC-003 CONTROL CENTRE/);
    assert.doesNotMatch(result.stdout, /Recent Jobs/);
  });
});

test("jobs subcommand prints only Recent Jobs", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const result = runCli("jobs", carouselDir, metricsDir, publisherResultDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Recent Jobs \(0\)/);
    assert.doesNotMatch(result.stdout, /System Health/);
  });
});

test("activity subcommand prints only Recent Activity", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const result = runCli("activity", carouselDir, metricsDir, publisherResultDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Recent Activity \(0\)/);
    assert.doesNotMatch(result.stdout, /System Health/);
  });
});

test("job <carouselId> prints full job detail for a real saved carousel, with no Publisher Result recorded", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    runCarouselCli("save", FIXTURE_PATH, carouselDir);
    const result = runCli("job", "car_01J9X9C7", carouselDir, metricsDir, publisherResultDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /JOB DETAIL — car_01J9X9C7/);
    assert.match(result.stdout, /Generation & Rendering/);
    assert.match(result.stdout, /Approval/);
    assert.match(result.stdout, /Export/);
    assert.match(result.stdout, /Publishing/);
    assert.match(result.stdout, /published\s+false/);
    assert.match(result.stdout, /no Publisher Result found for this carousel/);
    assert.match(result.stdout, /Metrics/);
  });
});

test("job <carouselId> shows a real Publisher Result once one is recorded", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    runCarouselCli("save", FIXTURE_PATH, carouselDir);
    const publishResult = spawnSync(
      process.execPath,
      [
        path.join(PROJECT_ROOT, "tests", "validation", "publisher-results.mjs"),
        "list",
        publisherResultDir,
      ],
      { encoding: "utf-8", env: CLEAN_ENV }
    );
    assert.equal(publishResult.status, 0, publishResult.stderr);
    assert.match(publishResult.stdout, /^0 publisher result/);

    // Record one directly via the Publisher Result Store CLI's own sibling
    // module — production-asset-publisher-service.mjs is I022's own
    // integration point (tested separately); this test only needs a real
    // stored record to confirm the Control Centre reads it back correctly.
    const recordScript = `
      import { createLocalJsonPublisherResultStoreAdapter } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "local-json-publisher-result-store-adapter.mjs"))};
      import { createPublisherResultStore } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "publisher-result-store.mjs"))};
      import { createPublisherResult } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "publisher-result.mjs"))};
      const store = createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: ${JSON.stringify(publisherResultDir)} }) });
      store.save(createPublisherResult({
        carouselId: "car_01J9X9C7",
        assetPackageId: "pkg_test0000000001",
        executionId: "exec_20260731_9f3a2e1c8b4d",
        provider: "google-drive",
        destination: "https://drive.google.com/drive/folders/test",
        providerReference: "folder_test",
      }));
    `;
    const seed = spawnSync(process.execPath, ["--input-type=module", "-e", recordScript], { encoding: "utf-8", env: CLEAN_ENV });
    assert.equal(seed.status, 0, seed.stderr);

    const result = runCli("job", "car_01J9X9C7", carouselDir, metricsDir, publisherResultDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /published\s+true/);
    assert.match(result.stdout, /provider=google-drive/);
    assert.match(result.stdout, /destination=https:\/\/drive\.google\.com/);
    assert.match(result.stdout, /Google Drive\s+completed/);
    assert.match(result.stdout, /Instagram\s+not_recorded/);
    assert.match(result.stdout, /LinkedIn\s+not_recorded/);
  });
});

test("job <carouselId> fails with CarouselNotFoundError, not a stack trace, for an unknown carousel", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const result = runCli("job", "car_doesnotexist0000", carouselDir, metricsDir, publisherResultDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CarouselNotFoundError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("missing arguments print usage and exit non-zero, for every subcommand", () => {
  withTempDirs(({ carouselDir, metricsDir }) => {
    for (const args of [
      ["dashboard"],
      ["dashboard", carouselDir],
      ["dashboard", carouselDir, metricsDir],
      ["health"],
      ["jobs"],
      ["activity"],
      ["job"],
      ["job", "car_x"],
      ["job", "car_x", carouselDir, metricsDir],
    ]) {
      const result = runCli(...args);
      assert.notEqual(result.status, 0, `expected non-zero exit for args: ${JSON.stringify(args)}`);
      assert.match(result.stderr, /Usage:/);
    }
  });
});

test("an unknown subcommand prints usage and exits non-zero", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const result = runCli("not-a-real-command", carouselDir, metricsDir, publisherResultDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
  });
});

// --- read-only guarantees at the CLI level ----------------------------------

test("running every subcommand never modifies the carousel, metrics, or publisher-result store directories on disk", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    runCarouselCli("save", FIXTURE_PATH, carouselDir);
    const beforeFiles = readdirSync(carouselDir).sort();
    const beforeContent = readFileSync(path.join(carouselDir, beforeFiles[0]), "utf-8");

    runCli("dashboard", carouselDir, metricsDir, publisherResultDir);
    runCli("health", carouselDir, metricsDir, publisherResultDir);
    runCli("jobs", carouselDir, metricsDir, publisherResultDir);
    runCli("activity", carouselDir, metricsDir, publisherResultDir);
    runCli("job", "car_01J9X9C7", carouselDir, metricsDir, publisherResultDir);

    const afterFiles = readdirSync(carouselDir).sort();
    const afterContent = readFileSync(path.join(carouselDir, afterFiles[0]), "utf-8");

    assert.deepEqual(afterFiles, beforeFiles, "no files were created or removed by any Control Centre subcommand");
    assert.equal(afterContent, beforeContent, "the stored carousel's bytes are unchanged");
    assert.equal(existsSync(metricsDir), false, "metrics store directory was never created since it was never written to");
    assert.equal(existsSync(publisherResultDir), false, "publisher result store directory was never created since it was never written to");
  });
});

// --- Social Performance (DC-003-I028) --------------------------------------

test("dashboard omits --social-analytics=<dir> by default and reports it honestly as unknown", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const result = runCli("dashboard", carouselDir, metricsDir, publisherResultDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Social Analytics\s+unknown/);
  });
});

test("job <carouselId> --social-analytics=<dir> shows real Social Performance data end to end", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir, base }) => {
    runCarouselCli("save", FIXTURE_PATH, carouselDir);
    const analyticsDir = path.join(base, "social-analytics");

    // Seed a real Publisher Result and a real Social Analytics Snapshot
    // directly via the domain layer, mirroring this file's own
    // "job <carouselId> shows a real Publisher Result once one is
    // recorded" test above.
    const recordScript = `
      import { createLocalJsonPublisherResultStoreAdapter } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "local-json-publisher-result-store-adapter.mjs"))};
      import { createPublisherResultStore } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "publisher-result-store.mjs"))};
      import { createPublisherResult } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "publisher-result.mjs"))};
      import { createLocalJsonSocialAnalyticsStoreAdapter } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "local-json-social-analytics-store-adapter.mjs"))};
      import { createSocialAnalyticsStore } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "social-analytics-store.mjs"))};
      import { createSocialAnalyticsSnapshot } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "social-analytics-snapshot.mjs"))};

      const publisherResultStore = createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: ${JSON.stringify(publisherResultDir)} }) });
      const publisherResult = publisherResultStore.save(createPublisherResult({
        carouselId: "car_01J9X9C7",
        assetPackageId: "pkg_test0000000001",
        executionId: "exec_20260731_9f3a2e1c8b4d",
        provider: "instagram",
        destination: "17800000000000001",
        providerReference: "17800000000000099",
        metadata: { post_url: null, item_count: 6 },
      }));

      const analyticsStore = createSocialAnalyticsStore({ adapter: createLocalJsonSocialAnalyticsStoreAdapter({ storageDir: ${JSON.stringify(analyticsDir)} }) });
      analyticsStore.save(createSocialAnalyticsSnapshot({
        publisherResultId: publisherResult.publisher_result_id,
        carouselId: "car_01J9X9C7",
        provider: "instagram",
        destination: "17800000000000001",
        providerPostReference: "17800000000000099",
        metrics: { reach: { value: 1200, availability: "available" } },
        engagement: {
          reactions: { value: 85, availability: "available" },
          comments: { value: 12, availability: "available" },
          shares: { value: 6, availability: "available" },
          saves: { value: 20, availability: "available" },
        },
        source: { type: "mock", providerApiVersion: "v21.0" },
      }));
    `;
    const seed = spawnSync(process.execPath, ["--input-type=module", "-e", recordScript], { encoding: "utf-8", env: CLEAN_ENV });
    assert.equal(seed.status, 0, seed.stderr);

    const result = runCli("job", "car_01J9X9C7", carouselDir, metricsDir, publisherResultDir, `--social-analytics=${analyticsDir}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /instagram\s+collected=true/);
    assert.match(result.stdout, /reach=1200/);
    assert.match(result.stdout, /total_engagement=123/);
    assert.match(result.stdout, /linkedin\s+collected=false/);
  });
});

// --- Engineering (DC-003-I029) --------------------------------------------

test("dashboard omits the engineering flags by default and reports Engineering as unknown", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const result = runCli("dashboard", carouselDir, metricsDir, publisherResultDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Engineering\n\n\s+unknown/);
  });
});

test("dashboard --engineering-work-orders=<dir> --engineering-delivery-reports=<dir> shows real Engineering data end to end", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir, base }) => {
    const workOrderDir = path.join(base, "engineering-work-orders");
    const deliveryReportDir = path.join(base, "engineering-delivery-reports");

    const recordScript = `
      import { createLocalJsonEngineeringWorkOrderStoreAdapter } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "local-json-engineering-work-order-store-adapter.mjs"))};
      import { createEngineeringWorkOrderStore } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "engineering-work-order-store.mjs"))};
      import { createEngineeringWorkOrder } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "engineering-work-order.mjs"))};
      import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "local-json-engineering-delivery-report-store-adapter.mjs"))};
      import { createEngineeringDeliveryReportStore } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "engineering-delivery-report-store.mjs"))};
      import { createEngineeringDeliveryReport } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "engineering-delivery-report.mjs"))};

      const workOrderStore = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: ${JSON.stringify(workOrderDir)} }) });
      const workOrder = workOrderStore.save(createEngineeringWorkOrder({
        milestone: "DC-003-I029",
        title: "Engineering Work Management",
        objective: "Formalise Strategy Office <-> Delivery Office communication.",
        reviewCriteria: ["Immutable objects"],
        status: "ready",
        approvedAt: "2026-08-05T10:05:00.000Z",
      }));

      const deliveryReportStore = createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: ${JSON.stringify(deliveryReportDir)} }) });
      deliveryReportStore.save(createEngineeringDeliveryReport({
        workOrderId: workOrder.work_order_id,
        milestone: "DC-003-I029",
        status: "completed",
        commit: "7d88509",
        pushStatus: "pushed",
        workingTree: "clean",
        tests: { passed: 1300, failed: 0, total: 1300 },
        fixtures: { passed: 17, failed: 0, total: 17 },
        liveRequests: { occurred: false, details: null },
      }));
    `;
    const seed = spawnSync(process.execPath, ["--input-type=module", "-e", recordScript], { encoding: "utf-8", env: CLEAN_ENV });
    assert.equal(seed.status, 0, seed.stderr);

    const result = runCli(
      "dashboard",
      carouselDir,
      metricsDir,
      publisherResultDir,
      `--engineering-work-orders=${workOrderDir}`,
      `--engineering-delivery-reports=${deliveryReportDir}`
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Current Milestone\s+DC-003-I029/);
    assert.match(result.stdout, /Last Completed Milestone\s+DC-003-I029/);
    assert.match(result.stdout, /Awaiting Review\s+1/);
    assert.match(result.stdout, /commit=7d88509 push=pushed tree=clean/);
  });
});

// --- Bridge Transport (DC-003-I029.1) --------------------------------------

test("dashboard omits --bridge=<dir> by default and reports Bridge Transport as unknown", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const result = runCli("dashboard", carouselDir, metricsDir, publisherResultDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Bridge Transport\n\n\s+unknown/);
  });
});

test("dashboard --bridge=<dir> shows real Bridge Transport data end to end", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir, base }) => {
    const bridgeDir = path.join(base, "bridge-transport");

    const recordScript = `
      import { createLocalJsonBridgeTransportStoreAdapter } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "local-json-bridge-transport-store-adapter.mjs"))};
      import { createBridgeTransportStore } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "bridge-transport-store.mjs"))};
      import { createBridgeTransportRecord } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "bridge-transport-record.mjs"))};

      const store = createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: ${JSON.stringify(bridgeDir)} }) });
      store.save(createBridgeTransportRecord({
        objectType: "engineering_work_order",
        objectId: "wo_9c026a104e3745c3",
        transportType: "mock",
        status: "delivered",
        source: "engineering-work-order-store",
        destination: "/data/bridge/outgoing/wo_9c026a104e3745c3.json",
        checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      }));
    `;
    const seed = spawnSync(process.execPath, ["--input-type=module", "-e", recordScript], { encoding: "utf-8", env: CLEAN_ENV });
    assert.equal(seed.status, 0, seed.stderr);

    const result = runCli("dashboard", carouselDir, metricsDir, publisherResultDir, `--bridge=${bridgeDir}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Transport History Count\s+1/);
    assert.match(result.stdout, /Bridge Healthy\s+true/);
    assert.match(result.stdout, /Last Transport\s+bt_/);
  });
});

// --- Delivery Office (DC-003-I029.2) ---------------------------------------

test("dashboard omits the Engineering flags by default and reports Delivery Office as unknown", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir }) => {
    const result = runCli("dashboard", carouselDir, metricsDir, publisherResultDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Delivery Office\n\n\s+unknown/);
  });
});

test("dashboard with Engineering flags but no --delivery-office-lock= reports lock status as unknown, other fields real", () => {
  withTempDirs(({ carouselDir, metricsDir, publisherResultDir, base }) => {
    const workOrderDir = path.join(base, "work-orders");
    const deliveryReportDir = path.join(base, "delivery-reports");

    const seedScript = `
      import { createLocalJsonEngineeringWorkOrderStoreAdapter } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "local-json-engineering-work-order-store-adapter.mjs"))};
      import { createEngineeringWorkOrderStore } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "engineering-work-order-store.mjs"))};
      import { createEngineeringWorkOrder } from ${JSON.stringify(path.join(PROJECT_ROOT, "src", "engineering-work-order.mjs"))};

      const store = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: ${JSON.stringify(workOrderDir)} }) });
      store.save(createEngineeringWorkOrder({
        milestone: "DC-003-I029.2",
        title: "CLI dashboard test",
        objective: "Exercise the Delivery Office dashboard section.",
        reviewCriteria: ["c1"],
        status: "ready",
        approvedAt: "2026-08-05T00:00:00.000Z",
      }));
    `;
    const seed = spawnSync(process.execPath, ["--input-type=module", "-e", seedScript], { encoding: "utf-8", env: CLEAN_ENV });
    assert.equal(seed.status, 0, seed.stderr);

    const result = runCli(
      "dashboard",
      carouselDir,
      metricsDir,
      publisherResultDir,
      `--engineering-work-orders=${workOrderDir}`,
      `--engineering-delivery-reports=${deliveryReportDir}`
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Queued Work Orders\s+1/);
    assert.match(result.stdout, /Lock Status\s+unknown/);
  });
});

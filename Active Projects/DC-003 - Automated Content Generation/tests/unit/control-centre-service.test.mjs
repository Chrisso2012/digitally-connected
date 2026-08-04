import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createProductionMetricsStore } from "../../src/production-metrics-store.mjs";
import { createProductionMetrics } from "../../src/production-metrics.mjs";
import { approveCarousel, rejectCarousel, publishCarousel } from "../../src/carousel-approval.mjs";
import { createControlCentreService } from "../../src/control-centre-service.mjs";
import { InvalidControlCentreDependenciesError } from "../../src/control-centre-errors.mjs";
import { CarouselNotFoundError } from "../../src/finished-carousel-store-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

// --- in-memory adapters, mirroring finished-carousel-store.test.mjs's own
// in-memory Storage Adapter pattern exactly — no filesystem, fast, and
// lets a test simulate a broken store on demand (see the "safe handling
// of missing/broken records" tests below). ---------------------------------

function createInMemoryCarouselAdapter() {
  const files = new Map();
  return {
    name: "in-memory-carousel-adapter",
    write(identifier, content) {
      files.set(identifier, content);
    },
    read(identifier) {
      if (!files.has(identifier)) {
        const err = new Error(`ENOENT: no such file, open '/fake/${identifier}.json'`);
        err.code = "ENOENT";
        throw err;
      }
      return files.get(identifier);
    },
    list() {
      return [...files.keys()];
    },
    exists(identifier) {
      return files.has(identifier);
    },
  };
}

function createInMemoryMetricsAdapter() {
  const files = new Map();
  return {
    name: "in-memory-metrics-adapter",
    write(identifier, content) {
      files.set(identifier, content);
    },
    read(identifier) {
      if (!files.has(identifier)) {
        const err = new Error(`ENOENT: no such file, open '/fake/${identifier}.json'`);
        err.code = "ENOENT";
        throw err;
      }
      return files.get(identifier);
    },
    list() {
      return [...files.keys()];
    },
    exists(identifier) {
      return files.has(identifier);
    },
  };
}

function loadFreshCarousel(overrides = {}) {
  const carousel = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  return { ...carousel, ...overrides };
}

function buildMetrics(overrides = {}) {
  return createProductionMetrics({
    requestId: overrides.requestId ?? "req_test0000000001",
    executionId: overrides.executionId ?? "exec_20260731_9f3a2e1c8b4d",
    carouselContentId: overrides.status === "failed" ? null : overrides.carouselContentId ?? "cc_01J9X9A1",
    carouselId: overrides.status === "failed" ? null : overrides.carouselId ?? "car_01J9X9C7",
    status: overrides.status ?? "completed",
    requests: overrides.requests ?? { anthropic: 1, templated: 6, googleDrive: 0 },
    durationsMs: overrides.durationsMs ?? { generation: null, render: 20570, export: null, publish: null, total: 33734 },
    outputs: overrides.outputs ?? { slidesGenerated: 6, slidesRendered: 6, filesExported: 0, filesPublished: 0 },
    costs: overrides.costs ?? {
      currency: "USD",
      anthropic: { amount: 0.02, calculationType: "estimated" },
      templated: { amount: 0.3, calculationType: "estimated" },
      googleDrive: { amount: 0, calculationType: "unavailable" },
      total: 0.32,
    },
  }, { now: overrides.now });
}

function buildStores() {
  const finishedCarouselStore = createFinishedCarouselStore({ adapter: createInMemoryCarouselAdapter() });
  const productionMetricsStore = createProductionMetricsStore({ adapter: createInMemoryMetricsAdapter() });
  return { finishedCarouselStore, productionMetricsStore };
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-control-centre-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- constructor / dependency guard ---------------------------------------

test("throws InvalidControlCentreDependenciesError for a missing finishedCarouselStore", () => {
  const { productionMetricsStore } = buildStores();
  assert.throws(
    () => createControlCentreService({ productionMetricsStore }),
    InvalidControlCentreDependenciesError
  );
});

test("throws InvalidControlCentreDependenciesError for a missing productionMetricsStore", () => {
  const { finishedCarouselStore } = buildStores();
  assert.throws(
    () => createControlCentreService({ finishedCarouselStore }),
    InvalidControlCentreDependenciesError
  );
});

// --- dashboard assembly / completed / failed / cost / duration aggregation

test("dashboard assembly: counts completed and failed production correctly", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_completed0000001" }));
  finishedCarouselStore.save(
    loadFreshCarousel({
      carousel_id: "car_failed00000000002",
      overall_status: "failed",
      execution_metadata: { execution_id: "exec_20260731_failed0001", rendered_at: "2026-07-31T02:11:12Z", provider: "templated-http", render_duration_ms: 100 },
    })
  );
  finishedCarouselStore.save(
    loadFreshCarousel({
      carousel_id: "car_partial00000000003",
      overall_status: "partial",
      execution_metadata: { execution_id: "exec_20260731_partial001", rendered_at: "2026-07-31T02:11:12Z", provider: "templated-http", render_duration_ms: 100 },
    })
  );

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  const { dashboard } = service.getOverview();

  assert.equal(dashboard.completed, 1);
  assert.equal(dashboard.failed, 1);
  assert.equal(dashboard.partial, 1);
  assert.equal(dashboard.awaiting_approval, 1); // only the completed one, not partial
});

test("cost aggregation: sums estimated cost across metrics records, and reports 0 records honestly when none exist", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });

  const emptyDashboard = service.getOverview().dashboard;
  assert.equal(emptyDashboard.estimated_cost.records_counted, 0);
  assert.equal(emptyDashboard.estimated_cost.amount, 0);
  assert.equal(emptyDashboard.estimated_cost.currency, null);

  productionMetricsStore.save(buildMetrics({ requestId: "req_a", executionId: "exec_20260801_aaaaaaaaaaaa" }));
  productionMetricsStore.save(buildMetrics({ requestId: "req_b", executionId: "exec_20260801_bbbbbbbbbbbb" }));

  const dashboard = service.getOverview().dashboard;
  assert.equal(dashboard.estimated_cost.records_counted, 2);
  assert.equal(dashboard.estimated_cost.amount, 0.64);
  assert.equal(dashboard.estimated_cost.currency, "USD");
});

test("duration aggregation: averages durations_ms.total across metrics records", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  productionMetricsStore.save(buildMetrics({ requestId: "req_a", executionId: "exec_20260801_aaaaaaaaaaaa", durationsMs: { generation: null, render: 1000, export: null, publish: null, total: 10000 } }));
  productionMetricsStore.save(buildMetrics({ requestId: "req_b", executionId: "exec_20260801_bbbbbbbbbbbb", durationsMs: { generation: null, render: 1000, export: null, publish: null, total: 20000 } }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  const { dashboard } = service.getOverview();

  assert.equal(dashboard.average_duration.records_counted, 2);
  assert.equal(dashboard.average_duration.average_ms, 15000);
});

test("today's production and cost only include records recorded today", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  productionMetricsStore.save(buildMetrics({ requestId: "req_old", executionId: "exec_20260801_oldoldoldoldo" })); // recorded_at defaults to real now()

  const service = createControlCentreService(
    { finishedCarouselStore, productionMetricsStore },
    { now: () => "2099-01-01T00:00:00.000Z" }
  );
  const { dashboard } = service.getOverview();
  assert.equal(dashboard.today.produced_count, 0);
  assert.equal(dashboard.today.estimated_cost.records_counted, 0);
});

// --- recent jobs -----------------------------------------------------------

test("recent jobs are sorted by generated_at descending and joined to their metrics record via execution_id", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_older0000000001", generated_at: "2026-01-01T00:00:00Z" }));
  finishedCarouselStore.save(
    loadFreshCarousel({
      carousel_id: "car_newer0000000002",
      generated_at: "2026-06-01T00:00:00Z",
      execution_metadata: { execution_id: "exec_20260601_newerrunnerx1", rendered_at: "2026-06-01T00:00:05Z", provider: "templated-http", render_duration_ms: 500 },
    })
  );
  productionMetricsStore.save(buildMetrics({ requestId: "req_newer", executionId: "exec_20260601_newerrunnerx1", carouselId: "car_newer0000000002" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  const { recent_jobs: jobs } = service.getOverview();

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].carousel_id, "car_newer0000000002");
  assert.equal(jobs[1].carousel_id, "car_older0000000001");
  assert.deepEqual(jobs[0].estimated_cost, { amount: 0.32, currency: "USD" });
  assert.equal(jobs[1].estimated_cost, null, "no metrics record exists for the older job — must be null, not a guessed zero");
});

test("approval_status reflects approve/reject/awaiting_approval correctly", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  const approved = approveCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_appr0000000001" }), approvedBy: "tester" });
  finishedCarouselStore.save(approved);
  const rejected = rejectCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_rej00000000002" }), reason: "not good" });
  finishedCarouselStore.save(rejected);
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_pend0000000003" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  const jobsByCarouselId = Object.fromEntries(service.getOverview().recent_jobs.map((j) => [j.carousel_id, j]));

  assert.equal(jobsByCarouselId["car_appr0000000001"].approval_status, "approved");
  assert.equal(jobsByCarouselId["car_rej00000000002"].approval_status, "rejected");
  assert.equal(jobsByCarouselId["car_pend0000000003"].approval_status, "awaiting_approval");
});

// --- missing export / missing publish ---------------------------------------

test("export_status is 'unknown' when no exportsRootDir is supplied", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_noexportdir00001" }));
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  const [job] = service.getOverview().recent_jobs;
  assert.equal(job.export_status, "unknown");
  assert.equal(service.getJobDetail("car_noexportdir00001").job.export, null);
});

test("export_status is 'not_exported' when exportsRootDir is supplied but no matching export exists, and 'exported' once one does", () => {
  withTempDir((exportsRootDir) => {
    const { finishedCarouselStore, productionMetricsStore } = buildStores();
    finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_exportme0000001" }));
    const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, exportsRootDir });

    const beforeJob = service.getOverview().recent_jobs[0];
    assert.equal(beforeJob.export_status, "not_exported");
    assert.equal(service.getJobDetail("car_exportme0000001").job.export.exported, false);

    mkdirSync(path.join(exportsRootDir, "car_exportme0000001"), { recursive: true });
    writeFileSync(
      path.join(exportsRootDir, "car_exportme0000001", "metadata.json"),
      JSON.stringify({ asset_package_id: "pkg_test1", carousel_id: "car_exportme0000001", export_timestamp: "2026-08-04T00:00:00Z" })
    );

    const afterJob = service.getOverview().recent_jobs[0];
    assert.equal(afterJob.export_status, "exported");
    const detail = service.getJobDetail("car_exportme0000001").job.export;
    assert.equal(detail.exported, true);
    assert.equal(detail.asset_package_id, "pkg_test1");
  });
});

test("publishing block always documents the Google Drive gap, and reflects approval.published when set", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  const published = publishCarousel({
    finishedCarousel: approveCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_pub00000000001" }), approvedBy: "tester" }),
  });
  finishedCarouselStore.save(published);
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_notpub0000000002" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });

  const publishedDetail = service.getJobDetail("car_pub00000000001").job.publishing;
  assert.equal(publishedDetail.published, true);
  assert.match(publishedDetail.note, /Google Drive/);

  const notPublishedDetail = service.getJobDetail("car_notpub0000000002").job.publishing;
  assert.equal(notPublishedDetail.published, false);
  assert.equal(notPublishedDetail.published_at, null);
});

// --- recent activity ---------------------------------------------------------

test("recent activity only includes events with a real stored timestamp, sorted newest first", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  const approved = approveCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_activity0000001" }), approvedBy: "tester" });
  finishedCarouselStore.save(approved);

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  const { recent_activity: activity } = service.getOverview();

  const events = activity.map((e) => e.event);
  assert.ok(events.includes("generated"));
  assert.ok(events.includes("rendered"));
  assert.ok(events.includes("approved"));
  assert.ok(!events.includes("rejected"), "rejection has no timestamp field anywhere in the schema — must never be invented");
  for (let i = 1; i < activity.length; i++) {
    assert.ok(activity[i - 1].timestamp >= activity[i].timestamp, "activity must be sorted newest first");
  }
});

// --- job detail --------------------------------------------------------------

test("getJobDetail propagates CarouselNotFoundError for an unknown carousel_id", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  assert.throws(() => service.getJobDetail("car_doesnotexist0000"), CarouselNotFoundError);
});

test("getJobDetail embeds the full finished carousel and, when present, the full metrics record", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_full0000000001" }));
  productionMetricsStore.save(buildMetrics({ requestId: "req_full", executionId: "exec_20260731_9f3a2e1c8b4d", carouselId: "car_full0000000001" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  const detail = service.getJobDetail("car_full0000000001");

  assert.equal(detail.kind, "job_detail");
  assert.equal(detail.job.finished_carousel.carousel_id, "car_full0000000001");
  assert.equal(detail.job.finished_carousel.slides.length, 6);
  assert.ok(detail.job.metrics);
  assert.equal(detail.job.metrics.costs.total, 0.32);
});

// --- system health -------------------------------------------------------

test("health: anthropic/templated/google_drive report 'warning' when unconfigured, 'ok' when configured", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  const unconfigured = createControlCentreService({ finishedCarouselStore, productionMetricsStore }, { env: {} });
  const unconfiguredHealth = unconfigured.getOverview().health;
  assert.equal(unconfiguredHealth.anthropic.status, "warning");
  assert.equal(unconfiguredHealth.templated.status, "warning");
  assert.equal(unconfiguredHealth.google_drive.status, "warning");
  assert.equal(unconfiguredHealth.overall, "warning");

  const configured = createControlCentreService(
    { finishedCarouselStore, productionMetricsStore },
    {
      env: {
        LLM_API_KEY: "sk-fake",
        TEMPLATED_API_KEY: "tk-fake",
        GOOGLE_DRIVE_CLIENT_ID: "id",
        GOOGLE_DRIVE_CLIENT_SECRET: "secret",
        GOOGLE_DRIVE_REFRESH_TOKEN: "token",
        GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder",
      },
    }
  );
  const configuredHealth = configured.getOverview().health;
  assert.equal(configuredHealth.anthropic.status, "ok");
  assert.equal(configuredHealth.templated.status, "ok");
  assert.equal(configuredHealth.google_drive.status, "ok");
  assert.equal(configuredHealth.overall, "healthy");
});

test("health: templated last_success_at only counts real templated-http renders, never mock-transport", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  finishedCarouselStore.save(
    loadFreshCarousel({
      carousel_id: "car_mockrender00001",
      execution_metadata: { execution_id: "exec_20260731_mockrunneraa1", rendered_at: "2026-07-31T02:11:12Z", provider: "mock-transport", render_duration_ms: 1 },
    })
  );
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore }, { env: { TEMPLATED_API_KEY: "tk-fake" } });
  const health = service.getOverview().health;
  assert.equal(health.templated.status, "ok"); // configured
  assert.equal(health.templated.last_success_at, null); // but no real render ever happened
});

test("health: export status is 'unknown' when no exportsRootDir supplied, 'ok' when the directory is readable", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  const noDirService = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  assert.equal(noDirService.getOverview().health.export.status, "unknown");

  withTempDir((exportsRootDir) => {
    const withDirService = createControlCentreService({ finishedCarouselStore, productionMetricsStore, exportsRootDir });
    assert.equal(withDirService.getOverview().health.export.status, "ok");
  });
});

test("health: overall is 'attention_required' when a core store is unreadable, safely (no throw)", () => {
  const brokenAdapter = {
    name: "broken-adapter",
    write() {},
    read() {},
    list() {
      throw new Error("disk fell off");
    },
    exists() {
      return false;
    },
  };
  const finishedCarouselStore = createFinishedCarouselStore({ adapter: brokenAdapter });
  const { productionMetricsStore } = buildStores();

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  const overview = service.getOverview(); // must not throw
  assert.equal(overview.health.finished_carousel_store.status, "warning");
  assert.equal(overview.health.overall, "attention_required");
  assert.deepEqual(overview.recent_jobs, []);
});

// --- immutability / read-only guarantees ------------------------------------

test("getOverview() returns a deep-frozen object", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_frozen00000001" }));
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  const overview = service.getOverview();

  assert.ok(Object.isFrozen(overview));
  assert.ok(Object.isFrozen(overview.dashboard));
  assert.ok(Object.isFrozen(overview.recent_jobs));
  assert.ok(Object.isFrozen(overview.recent_jobs[0]));
  assert.throws(() => {
    "use strict";
    overview.dashboard.completed = 999;
  }, TypeError);
});

test("getJobDetail() returns a deep-frozen object, and never mutates the store's own returned carousel", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_frozen00000002" }));
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore });
  const detail = service.getJobDetail("car_frozen00000002");

  assert.ok(Object.isFrozen(detail));
  assert.ok(Object.isFrozen(detail.job.finished_carousel));

  // The service must never call save()/replace() on either store.
  const original = finishedCarouselStore.get("car_frozen00000002");
  assert.deepEqual(original, detail.job.finished_carousel);
});

test("the service never calls a mutating store method (save/replace) — read-only by construction", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_readonly0000001" }));

  const guardedFinishedCarouselStore = {
    ...finishedCarouselStore,
    save() {
      throw new Error("must not be called");
    },
    replace() {
      throw new Error("must not be called");
    },
  };
  const guardedProductionMetricsStore = {
    ...productionMetricsStore,
    save() {
      throw new Error("must not be called");
    },
  };

  const service = createControlCentreService({ finishedCarouselStore: guardedFinishedCarouselStore, productionMetricsStore: guardedProductionMetricsStore });
  service.getOverview();
  service.getJobDetail("car_readonly0000001");
  // No assertion needed beyond "did not throw" — the guarded methods would
  // have thrown if the service ever called them.
});

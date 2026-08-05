import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createProductionMetricsStore } from "../../src/production-metrics-store.mjs";
import { createProductionMetrics } from "../../src/production-metrics.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import { createPublisherResult } from "../../src/publisher-result.mjs";
import { approveCarousel, rejectCarousel, publishCarousel } from "../../src/carousel-approval.mjs";
import { createSocialAnalyticsStore } from "../../src/social-analytics-store.mjs";
import { createSocialAnalyticsSnapshot } from "../../src/social-analytics-snapshot.mjs";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import { createEngineeringDeliveryReport } from "../../src/engineering-delivery-report.mjs";
import { createControlCentreService } from "../../src/control-centre-service.mjs";
import { InvalidControlCentreDependenciesError } from "../../src/control-centre-errors.mjs";
import { CarouselNotFoundError } from "../../src/finished-carousel-store-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

// --- in-memory adapters, mirroring finished-carousel-store.test.mjs's own
// in-memory Storage Adapter pattern exactly — no filesystem, fast, and
// lets a test simulate a broken store on demand (see the "safe handling
// of missing/broken records" tests below). ---------------------------------

function createInMemoryAdapter(name) {
  const files = new Map();
  return {
    name,
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

function buildPublisherResult(overrides = {}) {
  return createPublisherResult({
    carouselId: overrides.carouselId ?? "car_01J9X9C7",
    assetPackageId: overrides.assetPackageId ?? "pkg_test0000000001",
    executionId: overrides.executionId ?? "exec_20260731_9f3a2e1c8b4d",
    provider: overrides.provider ?? "google-drive",
    destination: overrides.destination ?? "https://drive.google.com/drive/folders/test",
    providerReference: overrides.providerReference ?? "folder_test",
    metadata: overrides.metadata ?? { files_uploaded: 7 },
  }, { now: overrides.now });
}

function buildStores() {
  const finishedCarouselStore = createFinishedCarouselStore({ adapter: createInMemoryAdapter("in-memory-carousel-adapter") });
  const productionMetricsStore = createProductionMetricsStore({ adapter: createInMemoryAdapter("in-memory-metrics-adapter") });
  const publisherResultStore = createPublisherResultStore({ adapter: createInMemoryAdapter("in-memory-publisher-result-adapter") });
  return { finishedCarouselStore, productionMetricsStore, publisherResultStore };
}

function buildSocialAnalyticsStore() {
  return createSocialAnalyticsStore({ adapter: createInMemoryAdapter("in-memory-social-analytics-adapter") });
}

function buildEngineeringStores() {
  const workOrderStore = createEngineeringWorkOrderStore({ adapter: createInMemoryAdapter("in-memory-engineering-work-order-adapter") });
  const deliveryReportStore = createEngineeringDeliveryReportStore({ adapter: createInMemoryAdapter("in-memory-engineering-delivery-report-adapter") });
  return { workOrderStore, deliveryReportStore };
}

function buildWorkOrder(overrides = {}, options = {}) {
  return createEngineeringWorkOrder(
    { milestone: "DC-003-I029", title: "t", objective: "o", reviewCriteria: ["c1"], ...overrides },
    options
  );
}

function buildDeliveryReport(overrides = {}, options = {}) {
  return createEngineeringDeliveryReport(
    {
      workOrderId: overrides.workOrderId ?? "wo_placeholder00001",
      milestone: "DC-003-I029",
      status: "completed",
      commit: "7d88509",
      pushStatus: "pushed",
      workingTree: "clean",
      tests: { passed: 1, failed: 0, total: 1 },
      fixtures: { passed: 1, failed: 0, total: 1 },
      liveRequests: { occurred: false, details: null },
      ...overrides,
    },
    options
  );
}

function buildSnapshot(overrides = {}) {
  return createSocialAnalyticsSnapshot({
    publisherResultId: overrides.publisherResultId ?? "pub_test0000000001",
    carouselId: overrides.carouselId ?? "car_01J9X9C7",
    provider: overrides.provider ?? "instagram",
    destination: overrides.destination ?? "17800000000000001",
    providerPostReference: overrides.providerPostReference ?? "17800000000000099",
    metrics: overrides.metrics ?? { reach: { value: 500, availability: "available" } },
    engagement: overrides.engagement ?? {
      reactions: { value: 10, availability: "available" },
      comments: { value: 2, availability: "available" },
      shares: { value: 1, availability: "available" },
      saves: { value: 3, availability: "available" },
    },
    source: overrides.source ?? { type: "mock", providerApiVersion: "v21.0" },
    collectedAt: overrides.collectedAt,
  }, { idGenerator: overrides.idGenerator });
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
  const { productionMetricsStore, publisherResultStore } = buildStores();
  assert.throws(
    () => createControlCentreService({ productionMetricsStore, publisherResultStore }),
    InvalidControlCentreDependenciesError
  );
});

test("throws InvalidControlCentreDependenciesError for a missing productionMetricsStore", () => {
  const { finishedCarouselStore, publisherResultStore } = buildStores();
  assert.throws(
    () => createControlCentreService({ finishedCarouselStore, publisherResultStore }),
    InvalidControlCentreDependenciesError
  );
});

test("throws InvalidControlCentreDependenciesError for a missing publisherResultStore", () => {
  const { finishedCarouselStore, productionMetricsStore } = buildStores();
  assert.throws(
    () => createControlCentreService({ finishedCarouselStore, productionMetricsStore }),
    InvalidControlCentreDependenciesError
  );
});

// --- dashboard assembly / completed / failed / cost / duration aggregation

test("dashboard assembly: counts completed and failed production correctly", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
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

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const { dashboard } = service.getOverview();

  assert.equal(dashboard.completed, 1);
  assert.equal(dashboard.failed, 1);
  assert.equal(dashboard.partial, 1);
  assert.equal(dashboard.awaiting_approval, 1); // only the completed one, not partial
});

test("cost aggregation: sums estimated cost across metrics records, and reports 0 records honestly when none exist", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });

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
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  productionMetricsStore.save(buildMetrics({ requestId: "req_a", executionId: "exec_20260801_aaaaaaaaaaaa", durationsMs: { generation: null, render: 1000, export: null, publish: null, total: 10000 } }));
  productionMetricsStore.save(buildMetrics({ requestId: "req_b", executionId: "exec_20260801_bbbbbbbbbbbb", durationsMs: { generation: null, render: 1000, export: null, publish: null, total: 20000 } }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const { dashboard } = service.getOverview();

  assert.equal(dashboard.average_duration.records_counted, 2);
  assert.equal(dashboard.average_duration.average_ms, 15000);
});

test("today's production and cost only include records recorded today", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  productionMetricsStore.save(buildMetrics({ requestId: "req_old", executionId: "exec_20260801_oldoldoldoldo" })); // recorded_at defaults to real now()

  const service = createControlCentreService(
    { finishedCarouselStore, productionMetricsStore, publisherResultStore },
    { now: () => "2099-01-01T00:00:00.000Z" }
  );
  const { dashboard } = service.getOverview();
  assert.equal(dashboard.today.produced_count, 0);
  assert.equal(dashboard.today.estimated_cost.records_counted, 0);
});

// --- published dashboard count (DC-003-I025) --------------------------------

test("dashboard.published counts distinct carousels with at least one Publisher Result, not approval.published", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  // Approved AND approval-lifecycle-"published" via I014 — but no Publisher
  // Result exists for it. Must NOT count as published.
  const legacyPublished = publishCarousel({
    finishedCarousel: approveCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_legacy0000000001" }), approvedBy: "tester" }),
  });
  finishedCarouselStore.save(legacyPublished);

  // A genuinely published carousel: a real Publisher Result exists, but
  // approval.published was never set (I022 never calls I014).
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_real0000000002" }));
  publisherResultStore.save(buildPublisherResult({ carouselId: "car_real0000000002" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const { dashboard } = service.getOverview();

  assert.equal(dashboard.published, 1, "only the carousel with a real Publisher Result counts");
});

// --- recent jobs -----------------------------------------------------------

test("recent jobs are sorted by generated_at descending and joined to their metrics record via execution_id", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_older0000000001", generated_at: "2026-01-01T00:00:00Z" }));
  finishedCarouselStore.save(
    loadFreshCarousel({
      carousel_id: "car_newer0000000002",
      generated_at: "2026-06-01T00:00:00Z",
      execution_metadata: { execution_id: "exec_20260601_newerrunnerx1", rendered_at: "2026-06-01T00:00:05Z", provider: "templated-http", render_duration_ms: 500 },
    })
  );
  productionMetricsStore.save(buildMetrics({ requestId: "req_newer", executionId: "exec_20260601_newerrunnerx1", carouselId: "car_newer0000000002" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const { recent_jobs: jobs } = service.getOverview();

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].carousel_id, "car_newer0000000002");
  assert.equal(jobs[1].carousel_id, "car_older0000000001");
  assert.deepEqual(jobs[0].estimated_cost, { amount: 0.32, currency: "USD" });
  assert.equal(jobs[1].estimated_cost, null, "no metrics record exists for the older job — must be null, not a guessed zero");
});

test("approval_status reflects approve/reject/awaiting_approval correctly", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const approved = approveCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_appr0000000001" }), approvedBy: "tester" });
  finishedCarouselStore.save(approved);
  const rejected = rejectCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_rej00000000002" }), reason: "not good" });
  finishedCarouselStore.save(rejected);
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_pend0000000003" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const jobsByCarouselId = Object.fromEntries(service.getOverview().recent_jobs.map((j) => [j.carousel_id, j]));

  assert.equal(jobsByCarouselId["car_appr0000000001"].approval_status, "approved");
  assert.equal(jobsByCarouselId["car_rej00000000002"].approval_status, "rejected");
  assert.equal(jobsByCarouselId["car_pend0000000003"].approval_status, "awaiting_approval");
});

test("recent job's published flag reflects the Publisher Result Store, not approval.published", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_jobpub0000000001" }));
  publisherResultStore.save(buildPublisherResult({ carouselId: "car_jobpub0000000001" }));
  finishedCarouselStore.save(
    loadFreshCarousel({
      carousel_id: "car_jobpub0000000002",
      execution_metadata: { execution_id: "exec_20260731_jobpub00002a", rendered_at: "2026-07-31T02:11:12Z", provider: "templated-http", render_duration_ms: 1 },
    })
  );

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const jobsByCarouselId = Object.fromEntries(service.getOverview().recent_jobs.map((j) => [j.carousel_id, j]));

  assert.equal(jobsByCarouselId["car_jobpub0000000001"].published, true);
  assert.equal(jobsByCarouselId["car_jobpub0000000002"].published, false);
});

// --- missing export -----------------------------------------------------------

test("export_status is 'unknown' when no exportsRootDir is supplied", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_noexportdir00001" }));
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const [job] = service.getOverview().recent_jobs;
  assert.equal(job.export_status, "unknown");
  assert.equal(service.getJobDetail("car_noexportdir00001").job.export, null);
});

test("export_status is 'not_exported' when exportsRootDir is supplied but no matching export exists, and 'exported' once one does", () => {
  withTempDir((exportsRootDir) => {
    const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
    finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_exportme0000001" }));
    const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore, exportsRootDir });

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

// --- publishing (DC-003-I025) -------------------------------------------------

test("job detail's publishing block is sourced from the Publisher Result Store, not approval.published", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();

  // Real evidence: approval was never touched, but a genuine Publisher
  // Result exists.
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_pub00000000001" }));
  const result = buildPublisherResult({ carouselId: "car_pub00000000001", now: () => "2026-08-04T01:00:00.000Z" });
  publisherResultStore.save(result);

  // Legacy signal only: I014's own publish transition was applied, but no
  // Publisher Result was ever recorded for it (I022 never calls I014).
  const legacyPublished = publishCarousel({
    finishedCarousel: approveCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_legacyonly0000002" }), approvedBy: "tester" }),
  });
  finishedCarouselStore.save(legacyPublished);

  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_notpub0000000003" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });

  const publishedDetail = service.getJobDetail("car_pub00000000001").job.publishing;
  assert.equal(publishedDetail.published, true);
  assert.equal(publishedDetail.publisher_results.length, 1);
  assert.equal(publishedDetail.publisher_results[0].publisher_result_id, result.publisher_result_id);

  const legacyOnlyDetail = service.getJobDetail("car_legacyonly0000002").job.publishing;
  assert.equal(legacyOnlyDetail.published, false, "approval.published alone must not count as published");
  assert.deepEqual(legacyOnlyDetail.publisher_results, []);

  const notPublishedDetail = service.getJobDetail("car_notpub0000000003").job.publishing;
  assert.equal(notPublishedDetail.published, false);
  assert.deepEqual(notPublishedDetail.publisher_results, []);
});

test("a carousel published more than once (re-publish) shows every Publisher Result, ordered oldest to newest", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_republish00001" }));
  const first = buildPublisherResult({ carouselId: "car_republish00001", now: () => "2026-08-01T00:00:00.000Z" });
  const second = buildPublisherResult({ carouselId: "car_republish00001", now: () => "2026-08-02T00:00:00.000Z" });
  publisherResultStore.save(first);
  publisherResultStore.save(second);

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const detail = service.getJobDetail("car_republish00001").job.publishing;

  assert.equal(detail.published, true);
  assert.equal(detail.publisher_results.length, 2);
  assert.equal(detail.publisher_results[0].publisher_result_id, first.publisher_result_id);
  assert.equal(detail.publisher_results[1].publisher_result_id, second.publisher_result_id);
});

// --- platform-specific publishing state (DC-003-I027) -----------------------

test("publishing.by_provider reports 'not_recorded' for every provider when nothing has been published", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_noproviders0001" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const { by_provider } = service.getJobDetail("car_noproviders0001").job.publishing;

  assert.deepEqual(by_provider, { google_drive: "not_recorded", instagram: "not_recorded", linkedin: "not_recorded" });
});

test("publishing.by_provider reports 'completed' independently per platform, based only on real Publisher Results", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_multiplatform01" }));
  publisherResultStore.save(buildPublisherResult({ carouselId: "car_multiplatform01", provider: "google-drive" }));
  publisherResultStore.save(buildPublisherResult({ carouselId: "car_multiplatform01", provider: "instagram", destination: "instagram:acct" }));
  // LinkedIn deliberately never published.

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const { by_provider, published, publisher_results } = service.getJobDetail("car_multiplatform01").job.publishing;

  assert.equal(published, true);
  assert.equal(publisher_results.length, 2);
  assert.deepEqual(by_provider, { google_drive: "completed", instagram: "completed", linkedin: "not_recorded" });
});

test("the Control Centre never makes a social-platform (or any) network request to compute by_provider", async () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_nonetworkcc0001" }));
  publisherResultStore.save(buildPublisherResult({ carouselId: "car_nonetworkcc0001", provider: "linkedin", destination: "urn:li:person:mock" }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("fetch must never be called by the Control Centre");
  };
  try {
    const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
    const { by_provider } = service.getJobDetail("car_nonetworkcc0001").job.publishing;
    assert.equal(by_provider.linkedin, "completed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- recent activity ---------------------------------------------------------

test("recent activity only includes events with a real stored timestamp, sorted newest first", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const approved = approveCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_activity0000001" }), approvedBy: "tester" });
  finishedCarouselStore.save(approved);

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
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

test("recent activity includes one 'published' entry per real Publisher Result, never from approval.published", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_activitypub0001" }));
  publisherResultStore.save(
    buildPublisherResult({ carouselId: "car_activitypub0001", provider: "google-drive", now: () => "2026-08-04T02:00:00.000Z" })
  );

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const publishedEntries = service.getOverview().recent_activity.filter((e) => e.event === "published");

  assert.equal(publishedEntries.length, 1);
  assert.equal(publishedEntries[0].carousel_id, "car_activitypub0001");
  assert.equal(publishedEntries[0].timestamp, "2026-08-04T02:00:00.000Z");
  assert.match(publishedEntries[0].detail, /provider=google-drive/);
});

// --- job detail --------------------------------------------------------------

test("getJobDetail propagates CarouselNotFoundError for an unknown carousel_id", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  assert.throws(() => service.getJobDetail("car_doesnotexist0000"), CarouselNotFoundError);
});

test("getJobDetail embeds the full finished carousel and, when present, the full metrics record", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_full0000000001" }));
  productionMetricsStore.save(buildMetrics({ requestId: "req_full", executionId: "exec_20260731_9f3a2e1c8b4d", carouselId: "car_full0000000001" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const detail = service.getJobDetail("car_full0000000001");

  assert.equal(detail.kind, "job_detail");
  assert.equal(detail.job.finished_carousel.carousel_id, "car_full0000000001");
  assert.equal(detail.job.finished_carousel.slides.length, 6);
  assert.ok(detail.job.metrics);
  assert.equal(detail.job.metrics.costs.total, 0.32);
});

// --- system health -------------------------------------------------------

test("health: anthropic/templated/google_drive report 'warning' when unconfigured, 'ok' when configured", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const unconfigured = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore }, { env: {} });
  const unconfiguredHealth = unconfigured.getOverview().health;
  assert.equal(unconfiguredHealth.anthropic.status, "warning");
  assert.equal(unconfiguredHealth.templated.status, "warning");
  assert.equal(unconfiguredHealth.google_drive.status, "warning");
  assert.equal(unconfiguredHealth.overall, "warning");

  const configured = createControlCentreService(
    { finishedCarouselStore, productionMetricsStore, publisherResultStore },
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

test("health: google_drive.last_success_at is sourced from real Publisher Results (DC-003-I025), never null once one exists", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_ghealth0000001" }));

  const noResultsService = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  assert.equal(noResultsService.getOverview().health.google_drive.last_success_at, null);

  publisherResultStore.save(
    buildPublisherResult({ carouselId: "car_ghealth0000001", provider: "google-drive", now: () => "2026-08-04T03:00:00.000Z" })
  );
  const withResultsService = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  assert.equal(withResultsService.getOverview().health.google_drive.last_success_at, "2026-08-04T03:00:00.000Z");
});

test("health: templated last_success_at only counts real templated-http renders, never mock-transport", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(
    loadFreshCarousel({
      carousel_id: "car_mockrender00001",
      execution_metadata: { execution_id: "exec_20260731_mockrunneraa1", rendered_at: "2026-07-31T02:11:12Z", provider: "mock-transport", render_duration_ms: 1 },
    })
  );
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore }, { env: { TEMPLATED_API_KEY: "tk-fake" } });
  const health = service.getOverview().health;
  assert.equal(health.templated.status, "ok"); // configured
  assert.equal(health.templated.last_success_at, null); // but no real render ever happened
});

test("health: export status is 'unknown' when no exportsRootDir supplied, 'ok' when the directory is readable", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const noDirService = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  assert.equal(noDirService.getOverview().health.export.status, "unknown");

  withTempDir((exportsRootDir) => {
    const withDirService = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore, exportsRootDir });
    assert.equal(withDirService.getOverview().health.export.status, "ok");
  });
});

test("health: publisher_result_store reports readable, and a warning when it isn't", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  publisherResultStore.save(buildPublisherResult());
  const okService = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  assert.equal(okService.getOverview().health.publisher_result_store.status, "ok");
  assert.match(okService.getOverview().health.publisher_result_store.detail, /1 record/);

  const brokenAdapter = {
    name: "broken-publisher-result-adapter",
    write() {},
    read() {},
    list() {
      throw new Error("disk fell off");
    },
    exists() {
      return false;
    },
  };
  const brokenPublisherResultStore = createPublisherResultStore({ adapter: brokenAdapter });
  const brokenService = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore: brokenPublisherResultStore });
  const overview = brokenService.getOverview(); // must not throw
  assert.equal(overview.health.publisher_result_store.status, "warning");
  assert.equal(overview.health.overall, "attention_required");
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
  const { productionMetricsStore, publisherResultStore } = buildStores();

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const overview = service.getOverview(); // must not throw
  assert.equal(overview.health.finished_carousel_store.status, "warning");
  assert.equal(overview.health.overall, "attention_required");
  assert.deepEqual(overview.recent_jobs, []);
});

// --- immutability / read-only guarantees ------------------------------------

test("getOverview() returns a deep-frozen object", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_frozen00000001" }));
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
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
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_frozen00000002" }));
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const detail = service.getJobDetail("car_frozen00000002");

  assert.ok(Object.isFrozen(detail));
  assert.ok(Object.isFrozen(detail.job.finished_carousel));
  assert.ok(Object.isFrozen(detail.job.publishing.publisher_results));

  // The service must never call save()/replace() on either store.
  const original = finishedCarouselStore.get("car_frozen00000002");
  assert.deepEqual(original, detail.job.finished_carousel);
});

test("the service never calls a mutating store method (save/replace) — read-only by construction", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_readonly0000001" }));
  publisherResultStore.save(buildPublisherResult({ carouselId: "car_readonly0000001" }));

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
  const guardedPublisherResultStore = {
    ...publisherResultStore,
    save() {
      throw new Error("must not be called");
    },
  };

  const service = createControlCentreService({
    finishedCarouselStore: guardedFinishedCarouselStore,
    productionMetricsStore: guardedProductionMetricsStore,
    publisherResultStore: guardedPublisherResultStore,
  });
  service.getOverview();
  service.getJobDetail("car_readonly0000001");
  // No assertion needed beyond "did not throw" — the guarded methods would
  // have thrown if the service ever called them.
});

// --- Social Performance (DC-003-I028) --------------------------------------

test("throws InvalidControlCentreDependenciesError for a socialAnalyticsStore that doesn't implement the shape", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  assert.throws(
    () => createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore, socialAnalyticsStore: { name: "not-a-real-store" } }),
    InvalidControlCentreDependenciesError
  );
});

test("job_detail.social_performance is null when no socialAnalyticsStore was supplied — never checked, not 'not collected'", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel());
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  const detail = service.getJobDetail("car_01J9X9C7");
  assert.equal(detail.job.social_performance, null);
});

test("dashboard.social_analytics is null when no socialAnalyticsStore was supplied", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  assert.equal(service.getOverview().dashboard.social_analytics, null);
});

test("job_detail.social_performance reports the latest snapshot per provider, sourced only from the Social Analytics Store", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel());
  const socialAnalyticsStore = buildSocialAnalyticsStore();
  socialAnalyticsStore.save(buildSnapshot({ provider: "instagram", collectedAt: "2026-08-01T00:00:00.000Z", idGenerator: () => "sas_early0000000001" }));
  socialAnalyticsStore.save(buildSnapshot({ provider: "instagram", collectedAt: "2026-08-05T00:00:00.000Z", idGenerator: () => "sas_late00000000002" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore, socialAnalyticsStore });
  const detail = service.getJobDetail("car_01J9X9C7");

  assert.equal(detail.job.social_performance.instagram.collected, true);
  assert.equal(detail.job.social_performance.instagram.latest_snapshot.analytics_snapshot_id, "sas_late00000000002");
  assert.equal(detail.job.social_performance.linkedin.collected, false);
  assert.equal(detail.job.social_performance.linkedin.latest_snapshot, null);
});

test("dashboard.social_analytics counts posts_published from real Publisher Results and posts_with_analytics from real snapshots", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel());
  publisherResultStore.save(buildPublisherResult({ provider: "instagram", destination: "17800000000000001", providerReference: "pub_ref_1" }));
  publisherResultStore.save(buildPublisherResult({ provider: "instagram", carouselId: "car_second00000002", executionId: "exec_20260801_deadbeef0002", providerReference: "pub_ref_2" }));

  const socialAnalyticsStore = buildSocialAnalyticsStore();
  const publisherResultId = publisherResultStore.list()[0].publisher_result_id;
  socialAnalyticsStore.save(buildSnapshot({ publisherResultId, provider: "instagram" }));

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore, socialAnalyticsStore });
  const social = service.getOverview().dashboard.social_analytics;

  assert.equal(social.instagram.posts_published, 2);
  assert.equal(social.instagram.posts_with_analytics, 1);
  assert.equal(social.linkedin.posts_published, 0);
  assert.equal(social.linkedin.posts_with_analytics, 0);
});

test("a broken socialAnalyticsStore degrades job_detail.social_performance to 'never checked' rather than throwing", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel());
  const brokenSocialAnalyticsStore = {
    ...buildSocialAnalyticsStore(),
    list() {
      throw new Error("simulated store failure");
    },
    findByCarousel() {
      throw new Error("simulated store failure");
    },
  };

  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore, socialAnalyticsStore: brokenSocialAnalyticsStore });
  const detail = service.getJobDetail("car_01J9X9C7");
  assert.equal(detail.job.social_performance.instagram.collected, false);
});

test("the Control Centre never makes a network request to compute social_performance/social_analytics", async () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  finishedCarouselStore.save(loadFreshCarousel());
  const socialAnalyticsStore = buildSocialAnalyticsStore();
  socialAnalyticsStore.save(buildSnapshot());

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("must not be called");
  };
  try {
    const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore, socialAnalyticsStore });
    service.getOverview();
    service.getJobDetail("car_01J9X9C7");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- Engineering (DC-003-I029) -----------------------------------------

test("throws InvalidControlCentreDependenciesError when only one of the paired engineering stores is supplied", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const { workOrderStore } = buildEngineeringStores();
  assert.throws(
    () => createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore, engineeringWorkOrderStore: workOrderStore }),
    InvalidControlCentreDependenciesError
  );
});

test("overview.engineering is null when neither engineering store was supplied", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const service = createControlCentreService({ finishedCarouselStore, productionMetricsStore, publisherResultStore });
  assert.equal(service.getOverview().engineering, null);
});

test("overview.engineering assembles real counts and the latest delivery report when both stores are supplied", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const { workOrderStore, deliveryReportStore } = buildEngineeringStores();

  const readyOrder = buildWorkOrder(
    { milestone: "DC-003-I028", status: "ready", approvedAt: "2026-08-01T00:00:00.000Z" },
    { idGenerator: () => "wo_cc0000000000001", now: () => "2026-08-01T00:00:00.000Z" }
  );
  const deliveredOrder = buildWorkOrder(
    { milestone: "DC-003-I029", status: "ready", approvedAt: "2026-08-05T00:00:00.000Z" },
    { idGenerator: () => "wo_cc0000000000002", now: () => "2026-08-05T00:00:00.000Z" }
  );
  workOrderStore.save(readyOrder);
  workOrderStore.save(deliveredOrder);
  deliveryReportStore.save(
    buildDeliveryReport(
      { workOrderId: deliveredOrder.work_order_id, milestone: "DC-003-I029" },
      { idGenerator: () => "dr_cc0000000000001", now: () => "2026-08-05T12:00:00.000Z" }
    )
  );

  const service = createControlCentreService({
    finishedCarouselStore,
    productionMetricsStore,
    publisherResultStore,
    engineeringWorkOrderStore: workOrderStore,
    engineeringDeliveryReportStore: deliveryReportStore,
  });
  const engineering = service.getOverview().engineering;

  assert.equal(engineering.current_milestone, "DC-003-I029");
  assert.equal(engineering.last_completed_milestone, "DC-003-I029");
  assert.equal(engineering.outstanding_work_orders, 1);
  assert.equal(engineering.awaiting_review, 1);
  assert.equal(engineering.latest_delivery_report.delivery_report_id, "dr_cc0000000000001");
});

test("a broken engineering store degrades overview.engineering to an honest zeroed summary rather than throwing", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const { workOrderStore, deliveryReportStore } = buildEngineeringStores();
  const brokenWorkOrderStore = {
    ...workOrderStore,
    list() {
      throw new Error("simulated store failure");
    },
  };

  const service = createControlCentreService({
    finishedCarouselStore,
    productionMetricsStore,
    publisherResultStore,
    engineeringWorkOrderStore: brokenWorkOrderStore,
    engineeringDeliveryReportStore: deliveryReportStore,
  });
  const engineering = service.getOverview().engineering;
  assert.equal(engineering.current_milestone, null);
  assert.equal(engineering.outstanding_work_orders, 0);
});

test("the Control Centre never makes a network request to compute overview.engineering", () => {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore } = buildStores();
  const { workOrderStore, deliveryReportStore } = buildEngineeringStores();
  workOrderStore.save(buildWorkOrder({ status: "ready", approvedAt: "2026-08-05T00:00:00.000Z" }, { idGenerator: () => "wo_cc0000000000003" }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("must not be called");
  };
  try {
    const service = createControlCentreService({
      finishedCarouselStore,
      productionMetricsStore,
      publisherResultStore,
      engineeringWorkOrderStore: workOrderStore,
      engineeringDeliveryReportStore: deliveryReportStore,
    });
    service.getOverview();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

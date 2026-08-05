// Unit tests for automated-strategy-review-service.mjs (DC-003-I029.3).
// Every test injects a fake `runGit` — no real git binary required. No
// automated test here ever invokes the real OpenAI adapter — only the
// mock adapter, and a handful of hand-built fake adapters for edge cases.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createEngineeringDeliveryReport } from "../../src/engineering-delivery-report.mjs";
import { createEngineeringStrategyReviewStore } from "../../src/engineering-strategy-review-store.mjs";
import { createLocalJsonEngineeringStrategyReviewStoreAdapter } from "../../src/local-json-engineering-strategy-review-store-adapter.mjs";
import { createBridgeTransportStore } from "../../src/bridge-transport-store.mjs";
import { createLocalJsonBridgeTransportStoreAdapter } from "../../src/local-json-bridge-transport-store-adapter.mjs";
import { createStrategyReviewLock } from "../../src/strategy-review-lock.mjs";
import { createStrategyReviewPolicy } from "../../src/strategy-review-policy.mjs";
import { createStrategyReviewMockAdapter } from "../../src/strategy-review-mock-adapter.mjs";
import { createAutomatedStrategyReviewService } from "../../src/automated-strategy-review-service.mjs";
import {
  DeliveryReportNotEligibleForReviewError,
  InvalidAutomatedStrategyReviewDependenciesError,
} from "../../src/strategy-review-errors.mjs";

async function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-strategy-review-service-"));
  const dirs = {
    workOrderDir: path.join(base, "work-orders"),
    deliveryReportDir: path.join(base, "delivery-reports"),
    strategyReviewDir: path.join(base, "strategy-reviews"),
    transportDir: path.join(base, "transport"),
    lockDir: path.join(base, "locks"),
    exportDir: path.join(base, "export"),
    base,
  };
  try {
    return await fn(dirs);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function fakeRunGit({ commit = "bbb2222", branch = "main", statusLines = [], diffLines = [] } = {}) {
  return (args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") return commit;
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return branch;
    if (args[0] === "status") return statusLines.join("\n");
    if (args[0] === "rev-parse" && args[1] === "@{u}") throw new Error("no upstream");
    if (args[0] === "diff") return diffLines.join("\n");
    if (args[0] === "merge-base") return "";
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
}

function seedWorkOrder(workOrderStore, overrides = {}) {
  return workOrderStore.save(
    createEngineeringWorkOrder({
      milestone: "DC-003-I029.3",
      title: "Review test task",
      objective: "Exercise the automated strategy review service.",
      reviewCriteria: ["Existing tests remain green.", "No scope creep."],
      status: "ready",
      approvedAt: "2026-08-05T00:00:00.000Z",
      repositoryCommit: "aaa1111",
      ...overrides,
    })
  );
}

function seedDeliveryReport(deliveryReportStore, workOrderId, overrides = {}) {
  return deliveryReportStore.save(
    createEngineeringDeliveryReport({
      workOrderId,
      milestone: "DC-003-I029.3",
      status: "completed",
      commit: "bbb2222",
      pushStatus: "not_applicable",
      workingTree: "clean",
      tests: { passed: 10, failed: 0, total: 10 },
      fixtures: { passed: 5, failed: 0, total: 5 },
      liveRequests: { occurred: false, details: null },
      ...overrides,
    })
  );
}

function buildService(dirs, { reviewerAdapter, runGit, ...policyOverrides } = {}) {
  const workOrderStore = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: dirs.workOrderDir }) });
  const deliveryReportStore = createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: dirs.deliveryReportDir }) });
  const strategyReviewStore = createEngineeringStrategyReviewStore({ adapter: createLocalJsonEngineeringStrategyReviewStoreAdapter({ storageDir: dirs.strategyReviewDir }) });
  const transportStore = createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: dirs.transportDir }) });
  const lock = createStrategyReviewLock({ lockDir: dirs.lockDir });
  const policy = createStrategyReviewPolicy({ repositoryPath: "/fake/repo", permittedBranch: "main", ...policyOverrides });
  const service = createAutomatedStrategyReviewService(
    {
      workOrderStore,
      deliveryReportStore,
      strategyReviewStore,
      transportStore,
      reviewerAdapter: reviewerAdapter ?? createStrategyReviewMockAdapter(),
      lock,
      policy,
      reviewExportDir: dirs.exportDir,
    },
    { runGit: runGit ?? fakeRunGit(), now: () => "2026-08-05T01:00:00.000Z" }
  );
  return { service, workOrderStore, deliveryReportStore, strategyReviewStore, transportStore, lock };
}

// --- dependency validation ---------------------------------------------

test("createAutomatedStrategyReviewService(): rejects incomplete dependencies", () =>
  withTempDirs((dirs) => {
    const workOrderStore = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: dirs.workOrderDir }) });
    assert.throws(() => createAutomatedStrategyReviewService({ workOrderStore }), InvalidAutomatedStrategyReviewDependenciesError);
  }));

// --- eligibility ---------------------------------------------------------

test("reviewDelivery(): rejects a Delivery Report that doesn't reference the given Work Order", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs);
    const workOrderA = seedWorkOrder(workOrderStore, { title: "A" });
    const workOrderB = workOrderStore.save(
      createEngineeringWorkOrder({ milestone: "DC-003-I029.3", title: "B", objective: "o", reviewCriteria: ["c1"], status: "ready", approvedAt: "2026-08-05T00:00:00.000Z" })
    );
    const reportForB = seedDeliveryReport(deliveryReportStore, workOrderB.work_order_id);
    await assert.rejects(() => service.reviewDelivery({ workOrderId: workOrderA.work_order_id, deliveryReportId: reportForB.delivery_report_id }), DeliveryReportNotEligibleForReviewError);
  }));

test("reviewDelivery(): rejects reviewing a Work Order that is already approved/archived", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs);
    const workOrder = seedWorkOrder(workOrderStore, { status: "approved", approvedAt: "2026-08-05T00:00:00.000Z" });
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);
    await assert.rejects(() => service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id }), DeliveryReportNotEligibleForReviewError);
  }));

test("reviewDelivery(): rejects reviewing a Delivery Report that already has a Strategy Review", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs);
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);
    await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    await assert.rejects(() => service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id }), DeliveryReportNotEligibleForReviewError);
  }));

// --- successful mock review -----------------------------------------

test("reviewDelivery(): a clean approved mock review persists a real review and a Bridge Transport record", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore, transportStore, lock } = buildService(dirs);
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);

    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(result.decision, "approved");
    assert.ok(result.strategyReviewId);
    assert.ok(result.transportRecordId);

    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.equal(stored.decision, "approved");
    assert.equal(stored.criteria.length, 2);
    assert.equal(transportStore.list().length, 1);
    assert.equal(transportStore.list()[0].object_type, "engineering_strategy_review");
    assert.equal(transportStore.list()[0].direction, "outgoing");
    assert.equal(lock.inspect(report.delivery_report_id), null, "lock released");
  }));

test("reviewDelivery(): the export directory receives exactly one written review file", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs);
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);
    await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(readdirSync(dirs.exportDir).length, 1);
  }));

// --- deterministic pre-review gates (adapter never invoked) --------------

test("reviewDelivery(): unresolved merge conflict forces ceo_decision_required WITHOUT invoking the adapter", () =>
  withTempDirs(async (dirs) => {
    let called = false;
    const spyAdapter = { name: "spy", reviewDelivery: async () => { called = true; } };
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs, {
      reviewerAdapter: spyAdapter,
      runGit: fakeRunGit({ statusLines: ["UU conflicted.mjs"] }),
    });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);

    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(result.decision, "ceo_decision_required");
    assert.equal(called, false);
    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.ok(stored.ceo_escalation.reason.length > 0);
    assert.ok(stored.criteria.every((c) => c.result === "insufficient_evidence"));
  }));

test("reviewDelivery(): a recorded live external request in the Delivery Report forces escalation pre-review", () =>
  withTempDirs(async (dirs) => {
    let called = false;
    const spyAdapter = { name: "spy", reviewDelivery: async () => { called = true; } };
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs, { reviewerAdapter: spyAdapter });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id, { liveRequests: { occurred: true, details: "live call happened" } });

    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(result.decision, "ceo_decision_required");
    assert.equal(called, false);
  }));

// --- post-review gates (model output overridden) -------------------------

test("reviewDelivery(): 'unsafe-approval' mock mode is overridden to ceo_decision_required when evidence shows real test failures", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs, {
      reviewerAdapter: createStrategyReviewMockAdapter({ mode: "unsafe-approval" }),
    });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id, { tests: { passed: 8, failed: 2, total: 10 } });

    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(result.decision, "ceo_decision_required");
    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.equal(stored.correction, null);
    assert.ok(stored.ceo_escalation);
  }));

test("reviewDelivery(): mock 'correction-required' mode persists a real correction specification", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs, {
      reviewerAdapter: createStrategyReviewMockAdapter({ mode: "correction-required" }),
    });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);
    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(result.decision, "correction_required");
    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.deepEqual(stored.correction.failed_criteria, [1]);
  }));

test("reviewDelivery(): mock 'ceo-escalation' mode persists a real escalation reason, never overridden unnecessarily", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs, {
      reviewerAdapter: createStrategyReviewMockAdapter({ mode: "ceo-escalation" }),
    });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);
    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(result.decision, "ceo_decision_required");
    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.match(stored.ceo_escalation.reason, /disagree/i);
  }));

test("reviewDelivery(): mock 'rejected' mode persists a real rejection", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs, {
      reviewerAdapter: createStrategyReviewMockAdapter({ mode: "rejected" }),
    });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);
    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(result.decision, "rejected");
    assert.equal(strategyReviewStore.get(result.strategyReviewId).correction, null);
  }));

// --- adapter failure handling ---------------------------------------

test("reviewDelivery(): a timing-out/failing adapter still produces a real review (escalated), and releases the lock", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore, lock } = buildService(dirs, {
      reviewerAdapter: createStrategyReviewMockAdapter({ mode: "timeout" }),
    });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);
    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(result.decision, "ceo_decision_required");
    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.match(stored.ceo_escalation.reason, /failed to complete/i);
    assert.equal(lock.inspect(report.delivery_report_id), null);
  }));

test("reviewDelivery(): malformed adapter output (shape-invalid) also escalates safely rather than throwing", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs, {
      reviewerAdapter: createStrategyReviewMockAdapter({ mode: "malformed" }),
    });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);
    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(result.decision, "ceo_decision_required");
  }));

// --- no secret / stack-trace leakage ---------------------------------

test("reviewDelivery(): escalation reasons never contain a raw stack trace", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs, {
      reviewerAdapter: createStrategyReviewMockAdapter({ mode: "provider-failure" }),
    });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);
    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.doesNotMatch(stored.ceo_escalation.reason, /at file:\/\//);
  }));

// --- DC-003-I029.3.1: Delivery Status Authority Gate (through the real service) ---
//
// Discovered via the DC-003-I029.4 end-to-end smoke test: a real mock
// delivery run (self-reporting "tests passed") whose independent git
// re-verification correctly downgraded to status "failed" could still
// receive a routine "approved" Strategy Review from the (always-proposes-
// approved-by-default) mock reviewer. These tests exercise the fix
// end-to-end through the real service, seeding a Delivery Report whose
// own `status` is "failed"/"partial" directly (mirroring exactly what
// automated-delivery-office-service.mjs produces when a runner claims
// success but no real commit independently verifies).

test("reviewDelivery(): a 'failed' Delivery Report with misleadingly-passing test/fixture counters is never approved", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs);
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id, {
      status: "failed",
      commit: null,
      pushStatus: "not_applicable",
      workingTree: "clean",
      // Self-reported counters still show everything passing — exactly
      // the misleading combination the I029.4 smoke test hit.
      tests: { passed: 10, failed: 0, total: 10 },
      fixtures: { passed: 5, failed: 0, total: 5 },
    });

    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.notEqual(result.decision, "approved");
    assert.equal(result.decision, "correction_required");
    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.ok(stored.correction);
    assert.equal(stored.ceo_escalation, null);
  }));

test("reviewDelivery(): a 'failed' Delivery Report skips the adapter entirely — zero requests for an unambiguous case", () =>
  withTempDirs(async (dirs) => {
    let called = false;
    const spyAdapter = { name: "spy", reviewDelivery: async () => { called = true; } };
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs, { reviewerAdapter: spyAdapter });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id, { status: "failed", commit: null, pushStatus: "not_applicable" });

    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(called, false);
    assert.equal(result.decision, "correction_required");
  }));

test("reviewDelivery(): a 'failed' Delivery Report combined with an existing mandatory reason (unresolved conflict) escalates to ceo_decision_required, still skipping the adapter", () =>
  withTempDirs(async (dirs) => {
    let called = false;
    const spyAdapter = { name: "spy", reviewDelivery: async () => { called = true; } };
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs, {
      reviewerAdapter: spyAdapter,
      runGit: fakeRunGit({ statusLines: ["UU conflicted.mjs"] }),
    });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id, { status: "failed", commit: null, pushStatus: "not_applicable" });

    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(called, false);
    assert.equal(result.decision, "ceo_decision_required");
    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.ok(stored.ceo_escalation);
    assert.equal(stored.correction, null);
  }));

test("reviewDelivery(): a 'partial' Delivery Report DOES reach the adapter, and the default mock 'approved' proposal is overridden to correction_required", () =>
  withTempDirs(async (dirs) => {
    let called = false;
    const wrappedAdapter = {
      name: createStrategyReviewMockAdapter().name,
      reviewDelivery: async (args) => {
        called = true;
        return createStrategyReviewMockAdapter().reviewDelivery(args);
      },
    };
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs, { reviewerAdapter: wrappedAdapter });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id, { status: "partial", commit: "bbb2222", pushStatus: "not_applicable" });

    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(called, true, "unlike a 'failed' delivery, 'partial' is not pre-gated — the adapter is genuinely invoked");
    assert.equal(result.decision, "correction_required");
    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.ok(stored.correction);
    // The gate discarded the model's own all-pass criteria (invalid
    // alongside "correction_required") in favour of unassessed criteria —
    // see automated-strategy-review-service.mjs's own comment.
    assert.ok(stored.criteria.every((c) => c.result === "insufficient_evidence"));
  }));

test("reviewDelivery(): a 'partial' Delivery Report whose adapter proposal is genuinely 'rejected' is never softened to correction_required", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs, {
      reviewerAdapter: createStrategyReviewMockAdapter({ mode: "rejected" }),
    });
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id, { status: "partial", commit: "bbb2222", pushStatus: "not_applicable" });

    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    assert.equal(result.decision, "rejected");
    assert.equal(strategyReviewStore.get(result.strategyReviewId).correction, null);
  }));

test("reviewDelivery(): the synthesized correction for a gate-forced 'failed' review stays within the original Work Order — no scope expansion, references every (unassessed) criterion", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, strategyReviewStore } = buildService(dirs);
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id, { status: "failed", commit: null, pushStatus: "not_applicable" });

    const result = await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    const stored = strategyReviewStore.get(result.strategyReviewId);
    assert.deepEqual(stored.correction.failed_criteria, [1, 2], "workOrder.review_criteria has 2 entries — every one is referenced, none fabricated beyond range");
    assert.match(stored.correction.required_outcome, /original Engineering Work Order/i);
    assert.match(stored.correction.prohibited_scope_expansion, /no scope expansion/i);
  }));

// --- getReviewStatus() ------------------------------------------------

test("getReviewStatus(): reports the Delivery Report, its reviews, and current lock state", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs);
    const workOrder = seedWorkOrder(workOrderStore);
    const report = seedDeliveryReport(deliveryReportStore, workOrder.work_order_id);

    const before = service.getReviewStatus(report.delivery_report_id);
    assert.equal(before.reviews.length, 0);
    assert.equal(before.lock, null);

    await service.reviewDelivery({ workOrderId: workOrder.work_order_id, deliveryReportId: report.delivery_report_id });
    const after = service.getReviewStatus(report.delivery_report_id);
    assert.equal(after.reviews.length, 1);
    assert.equal(after.lock, null);
  }));

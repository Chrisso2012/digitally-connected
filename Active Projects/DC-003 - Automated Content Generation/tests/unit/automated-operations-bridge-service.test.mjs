// Unit tests for automated-operations-bridge-service.mjs (DC-003-I029.4).
// Everything here is tested against injected FAKE deliveryOfficeService/
// strategyReviewService/stores/locks — never real git, never a real
// Docker-based store on disk. This is deliberate: I029.4 introduces zero
// new eligibility/lock/git/review logic of its own to verify against real
// state — that behaviour is already thoroughly covered at I029.2's and
// I029.3's own service-layer test files. This file only proves the
// orchestration itself: call order, argument passing, error propagation,
// and the read-only status composition.

import test from "node:test";
import assert from "node:assert/strict";
import { createOperationsBridgeService, getOperationsBridgeStatus } from "../../src/automated-operations-bridge-service.mjs";
import { InvalidAutomatedOperationsBridgeDependenciesError } from "../../src/operations-bridge-errors.mjs";

// DC-003-I029.4.1 — both fakes also implement getExecutionStatus()/
// getReviewStatus() now, since runOperationsBridge() calls them (on the
// SAME already-public methods the standalone CLIs' own `status`
// subcommand already used) to enrich its own result — never a new method,
// never a raw store.
function fakeDeliveryOfficeService(overrides = {}) {
  const calls = [];
  const deliveryReportId = overrides.deliveryReportId ?? "dr_fake0001";
  return {
    calls,
    executeApprovedWorkOrder: async (args) => {
      calls.push(args);
      if (overrides.throws) throw overrides.throws;
      return {
        workOrderId: args.workOrderId,
        deliveryReportId,
        status: overrides.status ?? "completed",
        commit: overrides.commit ?? "abc1234",
        transportRecordId: overrides.transportRecordId ?? "tr_fakeDelivery0001",
      };
    },
    getExecutionStatus: (workOrderId) => ({
      workOrder: { work_order_id: workOrderId, title: overrides.workOrderTitle ?? "Fake Work Order" },
      deliveryReports: [{ delivery_report_id: deliveryReportId, delivery_timestamp: overrides.deliveryTimestamp ?? "2026-08-05T00:00:00.000Z" }],
      lock: null,
    }),
  };
}

function fakeStrategyReviewService(overrides = {}) {
  const calls = [];
  const strategyReviewId = overrides.strategyReviewId ?? "rev_fake0001";
  return {
    calls,
    reviewDelivery: async (args) => {
      calls.push(args);
      if (overrides.throws) throw overrides.throws;
      return {
        workOrderId: args.workOrderId,
        deliveryReportId: args.deliveryReportId,
        strategyReviewId,
        decision: overrides.decision ?? "approved",
        transportRecordId: overrides.transportRecordId ?? "tr_fakeReview0001",
      };
    },
    getReviewStatus: (deliveryReportId) => ({
      deliveryReport: { delivery_report_id: deliveryReportId },
      reviews: [
        {
          strategy_review_id: strategyReviewId,
          reviewed_at: overrides.reviewedAt ?? "2026-08-05T01:00:00.000Z",
          summary: overrides.summary ?? "Fake summary.",
          risks: overrides.risks ?? [],
          correction: overrides.correction ?? null,
          ceo_escalation: overrides.ceoEscalation ?? null,
        },
      ],
      lock: null,
    }),
  };
}

// --- dependency validation ------------------------------------------------

test("createOperationsBridgeService rejects a missing deliveryOfficeService", () => {
  assert.throws(
    () => createOperationsBridgeService({ strategyReviewService: fakeStrategyReviewService() }),
    InvalidAutomatedOperationsBridgeDependenciesError
  );
});

test("createOperationsBridgeService rejects a deliveryOfficeService missing executeApprovedWorkOrder", () => {
  assert.throws(
    () => createOperationsBridgeService({ deliveryOfficeService: {}, strategyReviewService: fakeStrategyReviewService() }),
    InvalidAutomatedOperationsBridgeDependenciesError
  );
});

test("createOperationsBridgeService rejects a missing strategyReviewService", () => {
  assert.throws(
    () => createOperationsBridgeService({ deliveryOfficeService: fakeDeliveryOfficeService() }),
    InvalidAutomatedOperationsBridgeDependenciesError
  );
});

test("createOperationsBridgeService rejects a strategyReviewService missing reviewDelivery", () => {
  assert.throws(
    () => createOperationsBridgeService({ deliveryOfficeService: fakeDeliveryOfficeService(), strategyReviewService: {} }),
    InvalidAutomatedOperationsBridgeDependenciesError
  );
});

// --- runOperationsBridge: chaining ----------------------------------------

test("runOperationsBridge calls delivery then review, threading the delivery's own deliveryReportId into the review call", async () => {
  const deliveryOfficeService = fakeDeliveryOfficeService({ deliveryReportId: "dr_abc0001" });
  const strategyReviewService = fakeStrategyReviewService();
  const service = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });

  await service.runOperationsBridge({ workOrderId: "wo_xyz0001" });

  assert.equal(deliveryOfficeService.calls.length, 1);
  assert.equal(deliveryOfficeService.calls[0].workOrderId, "wo_xyz0001");
  assert.equal(strategyReviewService.calls.length, 1);
  assert.deepEqual(strategyReviewService.calls[0], { workOrderId: "wo_xyz0001", deliveryReportId: "dr_abc0001" });
});

test("runOperationsBridge passes allowNewerStartingCommit through to the delivery stage only, defaulting to false", async () => {
  const deliveryOfficeService = fakeDeliveryOfficeService();
  const strategyReviewService = fakeStrategyReviewService();
  const service = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });

  await service.runOperationsBridge({ workOrderId: "wo_xyz0001" });
  assert.equal(deliveryOfficeService.calls[0].allowNewerStartingCommit, false);

  await service.runOperationsBridge({ workOrderId: "wo_xyz0002", allowNewerStartingCommit: true });
  assert.equal(deliveryOfficeService.calls[1].allowNewerStartingCommit, true);
  assert.equal("allowNewerStartingCommit" in strategyReviewService.calls[1], false);
});

test("runOperationsBridge returns a combined result with both stages' own identifiers and transport records", async () => {
  const deliveryOfficeService = fakeDeliveryOfficeService({
    deliveryReportId: "dr_abc0001",
    status: "completed",
    commit: "c0ffee1",
    transportRecordId: "tr_delivery0001",
    workOrderTitle: "Ship the thing",
    deliveryTimestamp: "2026-08-05T00:30:00.000Z",
  });
  const strategyReviewService = fakeStrategyReviewService({
    strategyReviewId: "rev_def0002",
    decision: "approved",
    transportRecordId: "tr_review0002",
    reviewedAt: "2026-08-05T00:45:00.000Z",
    summary: "Everything checks out.",
    risks: [],
  });
  const service = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });

  const result = await service.runOperationsBridge({ workOrderId: "wo_xyz0001" });

  assert.deepEqual(result, {
    workOrderId: "wo_xyz0001",
    workOrderTitle: "Ship the thing",
    deliveryReportId: "dr_abc0001",
    deliveryStatus: "completed",
    deliveryCommit: "c0ffee1",
    deliveryTimestamp: "2026-08-05T00:30:00.000Z",
    strategyReviewId: "rev_def0002",
    decision: "approved",
    reviewedAt: "2026-08-05T00:45:00.000Z",
    summary: "Everything checks out.",
    risks: [],
    correction: null,
    ceoEscalation: null,
    transportRecordIds: { delivery: "tr_delivery0001", review: "tr_review0002" },
  });
});

// --- DC-003-I029.4.1: single-call enrichment ------------------------------

test("runOperationsBridge(): surfaces a correction_required review's own correction specification without a second call", async () => {
  const correction = { failed_criteria: [1], required_outcome: "Do it again.", prohibited_scope_expansion: "No scope creep.", verification_required: "Tests pass." };
  const deliveryOfficeService = fakeDeliveryOfficeService({ status: "failed", commit: null });
  const strategyReviewService = fakeStrategyReviewService({ decision: "correction_required", correction, risks: ["Delivery did not complete."] });
  const service = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });

  const result = await service.runOperationsBridge({ workOrderId: "wo_xyz0001" });

  assert.equal(result.decision, "correction_required");
  assert.deepEqual(result.correction, correction);
  assert.equal(result.ceoEscalation, null);
  assert.deepEqual(result.risks, ["Delivery did not complete."]);
});

test("runOperationsBridge(): surfaces a ceo_decision_required review's own escalation without a second call", async () => {
  const ceoEscalation = { decision_required: "Manual review required.", reason: "Credential file touched.", safe_options: ["Stop."], default_safe_action: "stop" };
  const strategyReviewService = fakeStrategyReviewService({ decision: "ceo_decision_required", ceoEscalation });
  const service = createOperationsBridgeService({ deliveryOfficeService: fakeDeliveryOfficeService(), strategyReviewService });

  const result = await service.runOperationsBridge({ workOrderId: "wo_xyz0001" });

  assert.equal(result.decision, "ceo_decision_required");
  assert.deepEqual(result.ceoEscalation, ceoEscalation);
  assert.equal(result.correction, null);
});

test("runOperationsBridge(): the enriched fields are sourced from getExecutionStatus()/getReviewStatus() — never require a new method beyond what the CLI's own status subcommand already used", async () => {
  let executionStatusCalls = 0;
  let reviewStatusCalls = 0;
  const deliveryOfficeService = fakeDeliveryOfficeService();
  const strategyReviewService = fakeStrategyReviewService();
  const originalGetExecutionStatus = deliveryOfficeService.getExecutionStatus;
  deliveryOfficeService.getExecutionStatus = (...args) => {
    executionStatusCalls += 1;
    return originalGetExecutionStatus(...args);
  };
  const originalGetReviewStatus = strategyReviewService.getReviewStatus;
  strategyReviewService.getReviewStatus = (...args) => {
    reviewStatusCalls += 1;
    return originalGetReviewStatus(...args);
  };
  const service = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });

  await service.runOperationsBridge({ workOrderId: "wo_xyz0001" });

  assert.equal(executionStatusCalls, 1);
  assert.equal(reviewStatusCalls, 1);
});

test("runOperationsBridge still invokes review after a non-'completed' delivery — the review is what evaluates a bad delivery, it is never skipped", async () => {
  const deliveryOfficeService = fakeDeliveryOfficeService({ status: "failed", commit: null });
  const strategyReviewService = fakeStrategyReviewService({ decision: "ceo_decision_required" });
  const service = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });

  const result = await service.runOperationsBridge({ workOrderId: "wo_xyz0001" });

  assert.equal(strategyReviewService.calls.length, 1);
  assert.equal(result.deliveryStatus, "failed");
  assert.equal(result.decision, "ceo_decision_required");
});

// --- error propagation: neither stage's errors are caught or wrapped -----

test("a delivery-stage error propagates untouched and the review stage is never called", async () => {
  class FakeWorkOrderNotEligibleError extends Error {}
  const deliveryOfficeService = fakeDeliveryOfficeService({ throws: new FakeWorkOrderNotEligibleError("not eligible") });
  const strategyReviewService = fakeStrategyReviewService();
  const service = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });

  await assert.rejects(() => service.runOperationsBridge({ workOrderId: "wo_xyz0001" }), FakeWorkOrderNotEligibleError);
  assert.equal(strategyReviewService.calls.length, 0);
});

test("a review-stage error propagates untouched (the delivery has already happened by this point)", async () => {
  class FakeDeliveryReportNotEligibleForReviewError extends Error {}
  const deliveryOfficeService = fakeDeliveryOfficeService({ deliveryReportId: "dr_abc0001" });
  const strategyReviewService = fakeStrategyReviewService({ throws: new FakeDeliveryReportNotEligibleForReviewError("not eligible") });
  const service = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });

  await assert.rejects(() => service.runOperationsBridge({ workOrderId: "wo_xyz0001" }), FakeDeliveryReportNotEligibleForReviewError);
  assert.equal(deliveryOfficeService.calls.length, 1);
});

// --- getOperationsBridgeStatus: read-only composition ---------------------

function fakeStore(records, indexKey) {
  return {
    get: (id) => {
      const found = records.find((r) => r[indexKey] === id || r.work_order_id === id);
      if (!found) throw new Error(`not found: ${id}`);
      return found;
    },
    findByWorkOrder: (workOrderId) => records.filter((r) => r.work_order_id === workOrderId),
    findByDeliveryReport: (deliveryReportId) => records.filter((r) => r.delivery_report_id === deliveryReportId),
  };
}

function fakeLock(heldFor = {}) {
  return { inspect: (id) => heldFor[id] ?? null };
}

test("getOperationsBridgeStatus composes the Work Order, its Delivery Reports, and each report's own Strategy Reviews", () => {
  const workOrderStore = fakeStore([{ work_order_id: "wo_xyz0001", status: "ready" }], "work_order_id");
  const deliveryReportStore = fakeStore(
    [
      { delivery_report_id: "dr_a", work_order_id: "wo_xyz0001", status: "completed", commit: "c1" },
      { delivery_report_id: "dr_b", work_order_id: "wo_xyz0001", status: "failed", commit: null },
    ],
    "delivery_report_id"
  );
  const strategyReviewStore = fakeStore(
    [{ strategy_review_id: "rev_a", delivery_report_id: "dr_a", decision: "approved", reviewed_at: "2026-08-05T00:00:00.000Z" }],
    "strategy_review_id"
  );
  const deliveryLock = fakeLock({ wo_xyz0001: { acquiredAt: "t1", stale: false } });
  const reviewLock = fakeLock({});

  const status = getOperationsBridgeStatus({ workOrderId: "wo_xyz0001", workOrderStore, deliveryReportStore, strategyReviewStore, deliveryLock, reviewLock });

  assert.equal(status.workOrder.work_order_id, "wo_xyz0001");
  assert.deepEqual(status.deliveryLock, { acquiredAt: "t1", stale: false });
  assert.equal(status.deliveryReports.length, 2);
  assert.equal(status.deliveryReports[0].deliveryReport.delivery_report_id, "dr_a");
  assert.equal(status.deliveryReports[0].reviews.length, 1);
  assert.equal(status.deliveryReports[0].reviews[0].strategy_review_id, "rev_a");
  assert.equal(status.deliveryReports[0].reviewLock, null);
  assert.equal(status.deliveryReports[1].deliveryReport.delivery_report_id, "dr_b");
  assert.equal(status.deliveryReports[1].reviews.length, 0);
});

test("getOperationsBridgeStatus reports zero Delivery Reports and no lock for a freshly-approved Work Order", () => {
  const workOrderStore = fakeStore([{ work_order_id: "wo_new0001", status: "ready" }], "work_order_id");
  const deliveryReportStore = fakeStore([], "delivery_report_id");
  const strategyReviewStore = fakeStore([], "strategy_review_id");
  const deliveryLock = fakeLock({});
  const reviewLock = fakeLock({});

  const status = getOperationsBridgeStatus({ workOrderId: "wo_new0001", workOrderStore, deliveryReportStore, strategyReviewStore, deliveryLock, reviewLock });

  assert.equal(status.deliveryReports.length, 0);
  assert.equal(status.deliveryLock, null);
});

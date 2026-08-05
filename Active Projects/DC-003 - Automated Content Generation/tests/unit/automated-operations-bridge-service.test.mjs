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

function fakeDeliveryOfficeService(overrides = {}) {
  const calls = [];
  return {
    calls,
    executeApprovedWorkOrder: async (args) => {
      calls.push(args);
      if (overrides.throws) throw overrides.throws;
      return {
        workOrderId: args.workOrderId,
        deliveryReportId: overrides.deliveryReportId ?? "dr_fake0001",
        status: overrides.status ?? "completed",
        commit: overrides.commit ?? "abc1234",
        transportRecordId: overrides.transportRecordId ?? "tr_fakeDelivery0001",
      };
    },
  };
}

function fakeStrategyReviewService(overrides = {}) {
  const calls = [];
  return {
    calls,
    reviewDelivery: async (args) => {
      calls.push(args);
      if (overrides.throws) throw overrides.throws;
      return {
        workOrderId: args.workOrderId,
        deliveryReportId: args.deliveryReportId,
        strategyReviewId: overrides.strategyReviewId ?? "rev_fake0001",
        decision: overrides.decision ?? "approved",
        transportRecordId: overrides.transportRecordId ?? "tr_fakeReview0001",
      };
    },
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
  const deliveryOfficeService = fakeDeliveryOfficeService({ deliveryReportId: "dr_abc0001", status: "completed", commit: "c0ffee1", transportRecordId: "tr_delivery0001" });
  const strategyReviewService = fakeStrategyReviewService({ strategyReviewId: "rev_def0002", decision: "approved", transportRecordId: "tr_review0002" });
  const service = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });

  const result = await service.runOperationsBridge({ workOrderId: "wo_xyz0001" });

  assert.deepEqual(result, {
    workOrderId: "wo_xyz0001",
    deliveryReportId: "dr_abc0001",
    deliveryStatus: "completed",
    deliveryCommit: "c0ffee1",
    deliveryTransportRecordId: "tr_delivery0001",
    strategyReviewId: "rev_def0002",
    decision: "approved",
    reviewTransportRecordId: "tr_review0002",
  });
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

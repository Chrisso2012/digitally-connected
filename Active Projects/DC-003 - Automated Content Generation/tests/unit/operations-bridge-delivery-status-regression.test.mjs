// DC-003-I029.3.1 regression test — the exact end-to-end scenario the
// DC-003-I029.4 manual smoke test hit for real: running the Automated
// Operations Bridge (I029.4) with the default mock Delivery Office Runner
// (which self-reports "success"/"tests passed") against a fake git state
// where NO real commit lands produces a Delivery Report independently
// downgraded to status "failed" — and, before this milestone's fix, the
// default mock Strategy Review Adapter (which always proposes "approved")
// let that "failed" delivery through as a routine approval. This file
// wires REAL createAutomatedDeliveryOfficeService() +
// createAutomatedStrategyReviewService() + createOperationsBridgeService()
// together (not fakes — see automated-operations-bridge-service.test.mjs
// for the pure-composition fake-based tests) with an injected fake
// `runGit`, so no real git binary or Docker-external state is needed.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createEngineeringStrategyReviewStore } from "../../src/engineering-strategy-review-store.mjs";
import { createLocalJsonEngineeringStrategyReviewStoreAdapter } from "../../src/local-json-engineering-strategy-review-store-adapter.mjs";
import { createBridgeTransportStore } from "../../src/bridge-transport-store.mjs";
import { createLocalJsonBridgeTransportStoreAdapter } from "../../src/local-json-bridge-transport-store-adapter.mjs";
import { createMockBridgeTransportAdapter } from "../../src/bridge-transport-mock-adapter.mjs";
import { createDeliveryExecutionLock } from "../../src/delivery-execution-lock.mjs";
import { createExecutionPolicy } from "../../src/execution-policy.mjs";
import { createMockDeliveryOfficeRunnerAdapter } from "../../src/delivery-office-mock-runner-adapter.mjs";
import { createAutomatedDeliveryOfficeService } from "../../src/automated-delivery-office-service.mjs";
import { createStrategyReviewLock } from "../../src/strategy-review-lock.mjs";
import { createStrategyReviewPolicy } from "../../src/strategy-review-policy.mjs";
import { createStrategyReviewMockAdapter } from "../../src/strategy-review-mock-adapter.mjs";
import { createAutomatedStrategyReviewService } from "../../src/automated-strategy-review-service.mjs";
import { createOperationsBridgeService } from "../../src/automated-operations-bridge-service.mjs";

async function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-ops-bridge-status-regression-"));
  const dirs = {
    workOrderDir: path.join(base, "work-orders"),
    deliveryReportDir: path.join(base, "delivery-reports"),
    strategyReviewDir: path.join(base, "strategy-reviews"),
    transportDir: path.join(base, "transport"),
    deliveryLockDir: path.join(base, "delivery-locks"),
    reviewLockDir: path.join(base, "review-locks"),
    dropDir: path.join(base, "drop"),
    exportDir: path.join(base, "export"),
    base,
  };
  try {
    return await fn(dirs);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

// Same shape as automated-delivery-office-service.test.mjs's own
// fakeRunGit() — defaults to startCommit === endCommit, i.e. no real
// commit lands, exactly reproducing the I029.4 smoke test's own scenario
// when paired with the mock runner's default "success" (self-reports
// completed/tests-passed) mode.
function fakeRunGit({ startCommit = "aaa1111", endCommit = "aaa1111", branch = "main", dirty = false, diffLines = [] } = {}) {
  let headCalls = 0;
  return (args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      headCalls += 1;
      return headCalls === 1 ? startCommit : endCommit;
    }
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return branch;
    if (args[0] === "status") return dirty ? " M x" : "";
    if (args[0] === "rev-parse" && args[1] === "@{u}") throw new Error("no upstream");
    if (args[0] === "diff") return diffLines.join("\n");
    if (args[0] === "merge-base") return "";
    return "";
  };
}

function seedReadyWorkOrder(workOrderStore, overrides = {}) {
  return workOrderStore.save(
    createEngineeringWorkOrder({
      milestone: "DC-003-I029.4",
      title: "Operations Bridge regression task",
      objective: "Exercise the Delivery Status Authority Gate end-to-end.",
      reviewCriteria: ["at least one criterion"],
      status: "ready",
      approvedAt: "2026-08-05T00:00:00.000Z",
      repositoryCommit: "aaa1111",
      ...overrides,
    })
  );
}

function buildRealOperationsBridge(dirs, { runGit } = {}) {
  const workOrderStore = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: dirs.workOrderDir }) });
  const deliveryReportStore = createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: dirs.deliveryReportDir }) });
  const strategyReviewStore = createEngineeringStrategyReviewStore({ adapter: createLocalJsonEngineeringStrategyReviewStoreAdapter({ storageDir: dirs.strategyReviewDir }) });
  const transportStore = createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: dirs.transportDir }) });
  const now = () => "2026-08-05T01:00:00.000Z";
  const gitOptions = { runGit: runGit ?? fakeRunGit(), now };

  const deliveryOfficeService = createAutomatedDeliveryOfficeService(
    {
      workOrderStore,
      deliveryReportStore,
      transportStore,
      transportAdapter: createMockBridgeTransportAdapter(),
      runnerAdapter: createMockDeliveryOfficeRunnerAdapter(),
      lock: createDeliveryExecutionLock({ lockDir: dirs.deliveryLockDir }),
      executionPolicy: createExecutionPolicy({ repositoryPath: "/fake/repo", permittedBranch: "main" }),
      deliveryReportDropDir: dirs.dropDir,
    },
    gitOptions
  );

  const strategyReviewService = createAutomatedStrategyReviewService(
    {
      workOrderStore,
      deliveryReportStore,
      strategyReviewStore,
      transportStore,
      reviewerAdapter: createStrategyReviewMockAdapter(),
      lock: createStrategyReviewLock({ lockDir: dirs.reviewLockDir }),
      policy: createStrategyReviewPolicy({ repositoryPath: "/fake/repo", permittedBranch: "main" }),
      reviewExportDir: dirs.exportDir,
    },
    gitOptions
  );

  const operationsBridgeService = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });
  return { operationsBridgeService, workOrderStore, deliveryReportStore, strategyReviewStore };
}

test("runOperationsBridge(): a mock delivery that self-reports success but produces no real commit is truthfully reported as failed and NEVER approved", () =>
  withTempDirs(async (dirs) => {
    const { operationsBridgeService, workOrderStore, deliveryReportStore, strategyReviewStore } = buildRealOperationsBridge(dirs);
    const workOrder = seedReadyWorkOrder(workOrderStore);

    const result = await operationsBridgeService.runOperationsBridge({ workOrderId: workOrder.work_order_id });

    // Independent verification: the mock runner claimed "completed", but
    // fakeRunGit()'s default startCommit === endCommit means no commit
    // ever actually landed — automated-delivery-office-service.mjs's own
    // independent re-verification must downgrade this, exactly as it did
    // in the real I029.4 smoke test.
    assert.equal(result.deliveryStatus, "failed");

    // This is the defect DC-003-I029.3.1 fixes: before the Delivery
    // Status Authority Gate existed, the mock reviewer's default
    // "approved" proposal passed through untouched here.
    assert.notEqual(result.decision, "approved");
    assert.equal(result.decision, "correction_required");

    const storedReport = deliveryReportStore.get(result.deliveryReportId);
    assert.equal(storedReport.status, "failed");
    const storedReview = strategyReviewStore.get(result.strategyReviewId);
    assert.equal(storedReview.decision, "correction_required");
    assert.ok(storedReview.correction);
  }));

test("runOperationsBridge(): a genuinely completed delivery (real commit lands, clean tree) is still approved — the gate does not affect a valid completed delivery", () =>
  withTempDirs(async (dirs) => {
    const { operationsBridgeService, workOrderStore, deliveryReportStore, strategyReviewStore } = buildRealOperationsBridge(dirs, {
      runGit: fakeRunGit({ startCommit: "aaa1111", endCommit: "bbb2222" }),
    });
    const workOrder = seedReadyWorkOrder(workOrderStore);

    const result = await operationsBridgeService.runOperationsBridge({ workOrderId: workOrder.work_order_id });

    assert.equal(result.deliveryStatus, "completed");
    assert.equal(result.decision, "approved");
    assert.equal(deliveryReportStore.get(result.deliveryReportId).status, "completed");
    assert.equal(strategyReviewStore.get(result.strategyReviewId).decision, "approved");
  }));

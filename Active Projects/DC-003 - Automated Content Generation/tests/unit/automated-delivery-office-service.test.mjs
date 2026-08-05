// Unit tests for automated-delivery-office-service.mjs (DC-003-I029.2).
// Every test injects a fake `runGit` (via options.runGit) — no real `git`
// binary is required, matching this project's own Docker test image
// (node:20-alpine has no git installed, confirmed during this milestone's
// own feasibility investigation). No automated test here ever invokes the
// real Claude Code CLI adapter — only the mock runner adapter, and a
// handful of hand-built fake runner adapters for edge cases the mock's
// own fixed modes don't cover (e.g. "claims completed but git disagrees").

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createBridgeTransportStore } from "../../src/bridge-transport-store.mjs";
import { createLocalJsonBridgeTransportStoreAdapter } from "../../src/local-json-bridge-transport-store-adapter.mjs";
import { createMockBridgeTransportAdapter } from "../../src/bridge-transport-mock-adapter.mjs";
import { createDeliveryExecutionLock } from "../../src/delivery-execution-lock.mjs";
import { createExecutionPolicy } from "../../src/execution-policy.mjs";
import { createMockDeliveryOfficeRunnerAdapter } from "../../src/delivery-office-mock-runner-adapter.mjs";
import { createAutomatedDeliveryOfficeService } from "../../src/automated-delivery-office-service.mjs";
import {
  WorkOrderNotEligibleError,
  DuplicateDeliveryError,
  ExecutionLockAlreadyHeldError,
  InvalidAutomatedDeliveryOfficeDependenciesError,
} from "../../src/delivery-office-errors.mjs";

// Deliberately async, awaiting fn() before cleanup — see
// social-analytics-service.test.mjs's own header comment for why a
// non-async version of this helper is a documented, previously-recurring
// hazard in this codebase (I021/I021-export-adapter/I026, now avoided here
// from the start).
async function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-delivery-office-service-"));
  const dirs = {
    workOrderDir: path.join(base, "work-orders"),
    deliveryReportDir: path.join(base, "delivery-reports"),
    transportDir: path.join(base, "transport"),
    lockDir: path.join(base, "locks"),
    dropDir: path.join(base, "drop"),
    base,
  };
  try {
    return await fn(dirs);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function fakeRunGit({ startCommit = "aaa1111", endCommit = "aaa1111", preBranch = "main", postBranch = "main", preDirty = false, postDirty = false, diffLines = [], upstreamCommit = "__NONE__" } = {}) {
  let headCalls = 0;
  return (args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      headCalls += 1;
      return headCalls === 1 ? startCommit : endCommit;
    }
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return headCalls <= 1 ? preBranch : postBranch;
    if (args[0] === "status") return headCalls <= 1 ? (preDirty ? " M x" : "") : postDirty ? " M x" : "";
    if (args[0] === "rev-parse" && args[1] === "@{u}") {
      if (upstreamCommit === "__NONE__") throw new Error("no upstream");
      return upstreamCommit;
    }
    if (args[0] === "diff") return diffLines.join("\n");
    return "";
  };
}

function buildStores({ workOrderDir, deliveryReportDir, transportDir }) {
  return {
    workOrderStore: createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: workOrderDir }) }),
    deliveryReportStore: createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: deliveryReportDir }) }),
    transportStore: createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: transportDir }) }),
  };
}

function seedReadyWorkOrder(workOrderStore, overrides = {}) {
  return workOrderStore.save(
    createEngineeringWorkOrder({
      milestone: "DC-003-I029.2",
      title: "Service test task",
      objective: "Exercise the automated delivery office service.",
      reviewCriteria: ["at least one criterion"],
      status: "ready",
      approvedAt: "2026-08-05T00:00:00.000Z",
      repositoryCommit: "aaa1111",
      ...overrides,
    })
  );
}

function buildService(dirs, { runnerAdapter, allowPush = false, runGit, ...policyOverrides } = {}) {
  const { workOrderStore, deliveryReportStore, transportStore } = buildStores(dirs);
  const lock = createDeliveryExecutionLock({ lockDir: dirs.lockDir });
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/fake/repo", permittedBranch: "main", allowPush, allowCommits: allowPush, ...policyOverrides });
  const service = createAutomatedDeliveryOfficeService(
    {
      workOrderStore,
      deliveryReportStore,
      transportStore,
      transportAdapter: createMockBridgeTransportAdapter(),
      runnerAdapter: runnerAdapter ?? createMockDeliveryOfficeRunnerAdapter(),
      lock,
      executionPolicy,
      deliveryReportDropDir: dirs.dropDir,
    },
    { runGit: runGit ?? fakeRunGit(), now: () => "2026-08-05T01:00:00.000Z" }
  );
  return { service, workOrderStore, deliveryReportStore, transportStore, lock };
}

// --- dependency validation ---------------------------------------------

test("createAutomatedDeliveryOfficeService(): rejects incomplete dependencies", () =>
  withTempDirs((dirs) => {
    const { workOrderStore } = buildStores(dirs);
    assert.throws(() => createAutomatedDeliveryOfficeService({ workOrderStore }), InvalidAutomatedDeliveryOfficeDependenciesError);
  }));

// --- eligibility ---------------------------------------------------------

test("executeApprovedWorkOrder(): rejects a Work Order whose status is not 'ready'", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore } = buildService(dirs);
    const workOrder = seedReadyWorkOrder(workOrderStore, { status: "draft", approvedAt: null });
    await assert.rejects(() => service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id }), WorkOrderNotEligibleError);
  }));

test("executeApprovedWorkOrder(): rejects a starting-commit mismatch unless allowNewerStartingCommit is set", () =>
  withTempDirs(async (dirs) => {
    // Explicit call-sequence fake: call 1 = first attempt's own (rejected)
    // eligibility pre-check; calls 2/3 = the second attempt's pre-check
    // then post-check, showing real committed progress.
    const commitSequence = ["different0", "aaa1111", "bbb2222"];
    let headCalls = 0;
    const runGit = (args) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return commitSequence[headCalls++];
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "main";
      if (args[0] === "status") return "";
      if (args[0] === "diff") return "";
      throw new Error("no upstream");
    };
    const { service, workOrderStore } = buildService(dirs, { runGit });
    const workOrder = seedReadyWorkOrder(workOrderStore, { repositoryCommit: "aaa1111" });

    await assert.rejects(() => service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id }), WorkOrderNotEligibleError);
    const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id, allowNewerStartingCommit: true });
    assert.equal(result.status, "completed");
  }));

test("executeApprovedWorkOrder(): rejects when the repository is on the wrong branch before execution", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore } = buildService(dirs, { runGit: fakeRunGit({ preBranch: "some-other-branch" }) });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    await assert.rejects(() => service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id }), WorkOrderNotEligibleError);
  }));

test("executeApprovedWorkOrder(): rejects when the working tree is dirty before execution", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore } = buildService(dirs, { runGit: fakeRunGit({ preDirty: true }) });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    await assert.rejects(() => service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id }), WorkOrderNotEligibleError);
  }));

test("executeApprovedWorkOrder(): rejects when a dependency has no completed Delivery Report", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore } = buildService(dirs);
    const workOrder = seedReadyWorkOrder(workOrderStore, { dependencies: ["wo_missingdep000001"] });
    await assert.rejects(() => service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id }), WorkOrderNotEligibleError);
  }));

test("executeApprovedWorkOrder(): eligibility failures never invoke the runner adapter", () =>
  withTempDirs(async (dirs) => {
    let called = false;
    const runnerAdapter = { name: "spy", executeWorkOrder: async () => { called = true; } };
    const { service, workOrderStore } = buildService(dirs, { runnerAdapter, runGit: fakeRunGit({ preDirty: true }) });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    await assert.rejects(() => service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id }));
    assert.equal(called, false);
  }));

// --- duplicate delivery ---------------------------------------------------

test("executeApprovedWorkOrder(): a Work Order with an existing completed Delivery Report is refused, runner never invoked again", () =>
  withTempDirs(async (dirs) => {
    let calls = 0;
    const inner = createMockDeliveryOfficeRunnerAdapter();
    const spyRunnerAdapter = { name: inner.name, executeWorkOrder: (...args) => { calls += 1; return inner.executeWorkOrder(...args); } };
    // The repository genuinely moves from aaa1111 to bbb2222 on the first
    // call; a real second attempt against the same Work Order would then
    // legitimately fail the starting-commit eligibility check too (the
    // repo has moved on) — allowNewerStartingCommit on the SECOND call
    // isolates what this test actually verifies: the duplicate check.
    const { service, workOrderStore } = buildService(dirs, {
      runnerAdapter: spyRunnerAdapter,
      runGit: fakeRunGit({ startCommit: "aaa1111", endCommit: "bbb2222" }),
    });
    const workOrder = seedReadyWorkOrder(workOrderStore);

    const first = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    assert.equal(first.status, "completed");
    assert.equal(calls, 1);

    await assert.rejects(
      () => service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id, allowNewerStartingCommit: true }),
      DuplicateDeliveryError
    );
    assert.equal(calls, 1, "the runner adapter must never be invoked again for a known duplicate");
  }));

// --- lock conflict ----------------------------------------------------

test("executeApprovedWorkOrder(): a Work Order already locked by another execution is refused", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, lock } = buildService(dirs);
    const workOrder = seedReadyWorkOrder(workOrderStore);
    lock.acquire(workOrder.work_order_id);
    await assert.rejects(() => service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id }), ExecutionLockAlreadyHeldError);
  }));

// --- successful mock execution --------------------------------------------

test("executeApprovedWorkOrder(): a corroborated success produces a 'completed' Delivery Report, imported through Bridge Transport, lock released", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore, transportStore, lock } = buildService(dirs, {
      runGit: fakeRunGit({ startCommit: "aaa1111", endCommit: "bbb2222", diffLines: ["A\tsrc/new-file.mjs", "M\tREADME.md"] }),
    });
    const workOrder = seedReadyWorkOrder(workOrderStore);

    const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });

    assert.equal(result.status, "completed");
    assert.equal(result.commit, "bbb2222");
    assert.ok(result.transportRecordId);

    const stored = deliveryReportStore.get(result.deliveryReportId);
    assert.equal(stored.status, "completed");
    assert.deepEqual(stored.files_created, ["src/new-file.mjs"]);
    assert.deepEqual(stored.files_modified, ["README.md"]);
    assert.equal(stored.push_status, "not_applicable");

    assert.equal(transportStore.list().length, 1);
    assert.equal(lock.inspect(workOrder.work_order_id), null, "lock released after a successful execution");
  }));

test("executeApprovedWorkOrder(): the drop directory receives exactly one written Delivery Report file per execution", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore } = buildService(dirs, { runGit: fakeRunGit({ startCommit: "aaa1111", endCommit: "bbb2222" }) });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    const dropped = readdirSync(dirs.dropDir);
    assert.equal(dropped.length, 1);
    const written = JSON.parse(readFileSync(path.join(dirs.dropDir, dropped[0]), "utf-8"));
    assert.equal(written.status, "completed");
  }));

// --- independent verification downgrades a self-reported success --------

test("executeApprovedWorkOrder(): runner claims completed but the working tree is independently found dirty — downgraded, never 'completed'", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs, {
      runGit: fakeRunGit({ startCommit: "aaa1111", endCommit: "bbb2222", postDirty: true }),
    });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    assert.equal(result.status, "partial");
    assert.equal(deliveryReportStore.get(result.deliveryReportId).working_tree, "dirty");
  }));

test("executeApprovedWorkOrder(): runner claims completed but the repository ended on the wrong branch — downgraded", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore } = buildService(dirs, {
      runGit: fakeRunGit({ startCommit: "aaa1111", endCommit: "bbb2222", postBranch: "some-other-branch" }),
    });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    assert.equal(result.status, "partial");
  }));

test("executeApprovedWorkOrder(): no commit ever moved — status is 'failed', never 'partial'", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore } = buildService(dirs, { runGit: fakeRunGit({ startCommit: "aaa1111", endCommit: "aaa1111" }) });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    assert.equal(result.status, "failed");
    assert.equal(result.commit, null);
  }));

// --- push status ------------------------------------------------------

test("executeApprovedWorkOrder(): allowPush true, local commit matches upstream — status 'completed', push_status 'pushed'", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs, {
      allowPush: true,
      runGit: fakeRunGit({ startCommit: "aaa1111", endCommit: "bbb2222", upstreamCommit: "bbb2222" }),
    });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    assert.equal(result.status, "completed");
    assert.equal(deliveryReportStore.get(result.deliveryReportId).push_status, "pushed");
  }));

test("executeApprovedWorkOrder(): allowPush true but local commit does not match upstream — downgraded to 'partial', push_status 'not_pushed'", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs, {
      allowPush: true,
      runGit: fakeRunGit({ startCommit: "aaa1111", endCommit: "bbb2222", upstreamCommit: "ccc3333" }),
    });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    assert.equal(result.status, "partial");
    assert.equal(deliveryReportStore.get(result.deliveryReportId).push_status, "not_pushed");
  }));

// --- runner failure modes ------------------------------------------------

for (const mode of ["failed", "timeout", "interrupted", "tests-failed", "fixtures-failed"]) {
  test(`executeApprovedWorkOrder(): mock runner mode "${mode}" never produces a 'completed' Delivery Report`, () =>
    withTempDirs(async (dirs) => {
      const { service, workOrderStore } = buildService(dirs, { runnerAdapter: createMockDeliveryOfficeRunnerAdapter({ mode }) });
      const workOrder = seedReadyWorkOrder(workOrderStore);
      const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
      assert.notEqual(result.status, "completed");
    }));
}

test("executeApprovedWorkOrder(): the runner adapter throwing (malformed output/adapter error) still produces a real Delivery Report and releases the lock", () =>
  withTempDirs(async (dirs) => {
    const runnerAdapter = createMockDeliveryOfficeRunnerAdapter({ mode: "malformed" });
    const { service, workOrderStore, deliveryReportStore, lock } = buildService(dirs, { runnerAdapter });
    const workOrder = seedReadyWorkOrder(workOrderStore);

    const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    assert.equal(result.status, "failed");
    const stored = deliveryReportStore.get(result.deliveryReportId);
    assert.match(stored.repository_findings[0], /Runner execution failed before returning a result/);
    assert.equal(lock.inspect(workOrder.work_order_id), null);
  }));

test("executeApprovedWorkOrder(): a runner that throws produces status 'partial' when independent evidence shows real committed progress", () =>
  withTempDirs(async (dirs) => {
    const runnerAdapter = { name: "throws-after-commit", executeWorkOrder: async () => { throw new Error("subprocess vanished"); } };
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs, {
      runnerAdapter,
      runGit: fakeRunGit({ startCommit: "aaa1111", endCommit: "bbb2222" }),
    });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    assert.equal(result.status, "partial");
    assert.equal(deliveryReportStore.get(result.deliveryReportId).commit, "bbb2222");
  }));

// --- no secret / stack-trace leakage ---------------------------------

test("executeApprovedWorkOrder(): repository_findings never contain a raw stack trace", () =>
  withTempDirs(async (dirs) => {
    const runnerAdapter = { name: "throws", executeWorkOrder: async () => { throw new Error("boom"); } };
    const { service, workOrderStore, deliveryReportStore } = buildService(dirs, { runnerAdapter });
    const workOrder = seedReadyWorkOrder(workOrderStore);
    const result = await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    const stored = deliveryReportStore.get(result.deliveryReportId);
    for (const finding of stored.repository_findings) {
      assert.doesNotMatch(finding, /at file:\/\//);
      assert.doesNotMatch(finding, /node_modules/);
    }
  }));

// --- getExecutionStatus() ----------------------------------------------

test("getExecutionStatus(): reports the Work Order, its Delivery Reports, and current lock state", () =>
  withTempDirs(async (dirs) => {
    const { service, workOrderStore, lock } = buildService(dirs);
    const workOrder = seedReadyWorkOrder(workOrderStore);

    const beforeExecution = service.getExecutionStatus(workOrder.work_order_id);
    assert.equal(beforeExecution.deliveryReports.length, 0);
    assert.equal(beforeExecution.lock, null);

    await service.executeApprovedWorkOrder({ workOrderId: workOrder.work_order_id });
    const afterExecution = service.getExecutionStatus(workOrder.work_order_id);
    assert.equal(afterExecution.deliveryReports.length, 1);
    assert.equal(afterExecution.lock, null, "released after completion");
  }));

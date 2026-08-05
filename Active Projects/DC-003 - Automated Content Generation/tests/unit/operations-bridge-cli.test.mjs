// Unit tests for tests/validation/operations-bridge.mjs (DC-003-I029.4).
// Covers usage errors, `inspect`'s static config surface, `status` (a
// git-free read), and the mock-default/`--live-runner`/`--live-review`
// flag-wiring proof on `run` — all git-free, mirroring
// delivery-office-runner-cli.test.mjs's and strategy-review-agent-cli
// .test.mjs's own precedent exactly.
//
// Deliberately NOT covered here: a full subprocess-level `run` completing
// end to end. The CLI's own `run` subcommand shells out to a real `git`
// binary through I029.2's own service (no injection point at the CLI
// layer) — and this project's own Docker test image has no `git`
// installed. Full chained-run behaviour is already thoroughly covered at
// the service layer in automated-operations-bridge-service.test.mjs with
// injected fake services; this file only proves the CLI's own argument
// handling and adapter-selection wiring are correct, neither of which
// needs real git.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import { createEngineeringDeliveryReport } from "../../src/engineering-delivery-report.mjs";
import { createLocalJsonEngineeringStrategyReviewStoreAdapter } from "../../src/local-json-engineering-strategy-review-store-adapter.mjs";
import { createEngineeringStrategyReviewStore } from "../../src/engineering-strategy-review-store.mjs";
import { createEngineeringStrategyReview } from "../../src/engineering-strategy-review.mjs";
import { createDeliveryExecutionLock } from "../../src/delivery-execution-lock.mjs";
import { createStrategyReviewLock } from "../../src/strategy-review-lock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "operations-bridge.mjs");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-operations-bridge-cli-"));
  const dirs = {
    workOrderDir: path.join(base, "work-orders"),
    deliveryReportDir: path.join(base, "delivery-reports"),
    strategyReviewDir: path.join(base, "strategy-reviews"),
    bridgeDir: path.join(base, "bridge"),
    deliveryLockDir: path.join(base, "delivery-locks"),
    reviewLockDir: path.join(base, "review-locks"),
    dropDir: path.join(base, "drop"),
    exportDir: path.join(base, "export"),
    base,
  };
  try {
    return fn(dirs);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function seedWorkOrder(workOrderDir) {
  const store = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: workOrderDir }) });
  return store.save(
    createEngineeringWorkOrder({
      milestone: "DC-003-I029.4",
      title: "CLI test task",
      objective: "Exercise the operations bridge CLI.",
      reviewCriteria: ["at least one criterion"],
      status: "ready",
      approvedAt: "2026-08-05T00:00:00.000Z",
    })
  );
}

function seedDeliveryReport(deliveryReportDir, workOrderId) {
  const store = createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: deliveryReportDir }) });
  return store.save(
    createEngineeringDeliveryReport({
      workOrderId,
      milestone: "DC-003-I029.4",
      status: "completed",
      commit: "bbb2222",
      pushStatus: "not_applicable",
      workingTree: "clean",
      tests: { passed: 10, failed: 0, total: 10 },
      fixtures: { passed: 5, failed: 0, total: 5 },
      liveRequests: { occurred: false, details: null },
    })
  );
}

function seedReview(strategyReviewDir, workOrderId, deliveryReportId) {
  const store = createEngineeringStrategyReviewStore({ adapter: createLocalJsonEngineeringStrategyReviewStoreAdapter({ storageDir: strategyReviewDir }) });
  return store.save(
    createEngineeringStrategyReview({
      workOrderId,
      deliveryReportId,
      workOrderReviewCriteria: ["at least one criterion"],
      milestone: "DC-003-I029.4",
      reviewerProvider: "mock",
      decision: "approved",
      criteria: [{ criterionIndex: 1, criterion: "at least one criterion", result: "pass", evidence: [], reason: null }],
      repositoryEvidence: { startingCommit: "aaa1111", endingCommit: "bbb2222", branch: "main", workingTree: "clean", pushStatus: "not_applicable", verifiable: true },
      verification: {
        tests: { status: "passed", source: "independent-verification", passed: 10, failed: 0, total: 10 },
        fixtures: { status: "passed", source: "independent-verification", passed: 5, failed: 0, total: 5 },
      },
      risks: [],
      correction: null,
      ceoEscalation: null,
      summary: "Looks good.",
      notes: null,
    })
  );
}

// --- usage -----------------------------------------------------------

test("no subcommand prints usage and exits non-zero", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("run without required flags prints usage and exits non-zero", () => {
  const result = runCli("run", "wo_x", "a", "b", "c", "d", "e");
  assert.notEqual(result.status, 0);
});

test("status without --delivery-lock/--review-lock prints usage and exits non-zero", () => {
  const result = runCli("status", "wo_x", "a", "b", "c");
  assert.notEqual(result.status, 0);
});

// --- inspect ------------------------------------------------------------

test("inspect without --repo reports both stage's default mock adapters, no crash", () => {
  const result = runCli("inspect");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mock-delivery-office-runner/);
  assert.match(result.stdout, /mock-strategy-review-adapter/);
  assert.match(result.stdout, /No Claude Code or OpenAI invocation occurs/);
});

test("inspect --repo=<path> also reports the resolved Execution Policy", () =>
  withTempDirs(({ base }) => {
    const result = runCli("inspect", `--repo=${base}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Allow commits\/push\/docker:\s*false\/false\/false/);
  }));

test("inspect never reveals a credential value", () => {
  const result = runCli("inspect");
  assert.doesNotMatch(result.stdout, /sk-/);
});

// --- status ------------------------------------------------------------

test("status reports a Work Order with no Delivery Reports and no locks held", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, strategyReviewDir, deliveryLockDir, reviewLockDir }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const result = runCli(
      "status",
      workOrder.work_order_id,
      workOrderDir,
      deliveryReportDir,
      strategyReviewDir,
      `--delivery-lock=${deliveryLockDir}`,
      `--review-lock=${reviewLockDir}`
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /delivery_reports:\s*0/);
    assert.match(result.stdout, /delivery lock:\s*not held/);
  }));

test("status reports a Delivery Report together with its own Strategy Review", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, strategyReviewDir, deliveryLockDir, reviewLockDir }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const deliveryReport = seedDeliveryReport(deliveryReportDir, workOrder.work_order_id);
    const review = seedReview(strategyReviewDir, workOrder.work_order_id, deliveryReport.delivery_report_id);
    const result = runCli(
      "status",
      workOrder.work_order_id,
      workOrderDir,
      deliveryReportDir,
      strategyReviewDir,
      `--delivery-lock=${deliveryLockDir}`,
      `--review-lock=${reviewLockDir}`
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(deliveryReport.delivery_report_id));
    assert.match(result.stdout, new RegExp(review.strategy_review_id));
    assert.match(result.stdout, /decision=approved/);
  }));

test("status fails safely for an unknown work order id, no stack trace", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, strategyReviewDir, deliveryLockDir, reviewLockDir }) => {
    const result = runCli(
      "status",
      "wo_doesnotexist0001",
      workOrderDir,
      deliveryReportDir,
      strategyReviewDir,
      `--delivery-lock=${deliveryLockDir}`,
      `--review-lock=${reviewLockDir}`
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EngineeringWorkOrderNotFoundError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

test("status reports a held delivery lock accurately", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, strategyReviewDir, deliveryLockDir, reviewLockDir }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    // Static top-level import, acquired synchronously — withTempDirs() in
    // this file is synchronous and deletes the temp directory in its own
    // `finally` block the instant this callback returns; see
    // delivery-office-runner-cli.test.mjs's own identical precedent for
    // why an async continuation here would race that cleanup.
    createDeliveryExecutionLock({ lockDir: deliveryLockDir }).acquire(workOrder.work_order_id);
    const result = runCli(
      "status",
      workOrder.work_order_id,
      workOrderDir,
      deliveryReportDir,
      strategyReviewDir,
      `--delivery-lock=${deliveryLockDir}`,
      `--review-lock=${reviewLockDir}`
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /delivery lock:\s*held/);
  }));

// --- explicit --live-runner / --live-review gates -------------------------

test("run without --live-runner/--live-review selects both mock adapters", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, strategyReviewDir, deliveryLockDir, reviewLockDir, dropDir, exportDir, base }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const bridgeDir = path.join(base, "bridge");
    const result = runCli(
      "run",
      workOrder.work_order_id,
      workOrderDir,
      deliveryReportDir,
      strategyReviewDir,
      bridgeDir,
      base,
      `--repo=${base}`,
      `--delivery-lock=${deliveryLockDir}`,
      `--review-lock=${reviewLockDir}`,
      `--drop=${dropDir}`,
      `--export=${exportDir}`
    );
    assert.match(result.stdout, /Runner:\s+mock-delivery-office-runner\s+\(mock — no Claude Code execution\)/);
    assert.match(result.stdout, /Reviewer:\s+mock-strategy-review-adapter\s+\(mock — no network\)/);
  }));

test("run with --live-runner (only) selects the real Claude Code adapter, printed before any execution attempt, reviewer stays mock", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, strategyReviewDir, deliveryLockDir, reviewLockDir, dropDir, exportDir, base }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const bridgeDir = path.join(base, "bridge");
    const result = runCli(
      "run",
      workOrder.work_order_id,
      workOrderDir,
      deliveryReportDir,
      strategyReviewDir,
      bridgeDir,
      base,
      `--repo=${base}`,
      `--delivery-lock=${deliveryLockDir}`,
      `--review-lock=${reviewLockDir}`,
      `--drop=${dropDir}`,
      `--export=${exportDir}`,
      "--live-runner"
    );
    assert.match(result.stdout, /Runner:\s+claude-code-cli-delivery-runner\s+\(LIVE — real Claude Code execution\)/);
    assert.match(result.stdout, /Reviewer:\s+mock-strategy-review-adapter\s+\(mock — no network\)/);
    // No real git repository exists at --repo, so eligibility/git-evidence
    // collection is expected to fail after this point — this test proves
    // only that the flag selects the correct runner adapter, not that a
    // live run succeeds (no real Claude Code invocation is authorised here
    // or anywhere in this milestone's automated tests).
  }));

test("run with --live-review fails fast on adapter construction (no OPENAI_API_KEY in this test environment), before any git evidence is touched", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, strategyReviewDir, deliveryLockDir, reviewLockDir, dropDir, exportDir, base }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const bridgeDir = path.join(base, "bridge");
    const result = runCli(
      "run",
      workOrder.work_order_id,
      workOrderDir,
      deliveryReportDir,
      strategyReviewDir,
      bridgeDir,
      base,
      `--repo=${base}`,
      `--delivery-lock=${deliveryLockDir}`,
      `--review-lock=${reviewLockDir}`,
      `--drop=${dropDir}`,
      `--export=${exportDir}`,
      "--live-review"
    );
    // Mirrors strategy-review-agent-cli.test.mjs's own identical
    // "--live-review with no OPENAI_API_KEY" precedent: the reviewer
    // adapter is constructed (and fails) before the "Run" banner ever
    // prints — proving the flag routes to the real adapter path without
    // ever reaching git evidence collection or making a network call.
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /StrategyReviewConfigurationError|OPENAI_API_KEY/);
  }));

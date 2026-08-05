// Unit tests for tests/validation/strategy-review-agent.mjs
// (DC-003-I029.3). Covers usage errors, `inspect`'s static config surface,
// `get`/`work`/`status` (all git-free reads).
//
// Deliberately NOT covered here: a full subprocess-level `review` run —
// like delivery-office-runner-cli.test.mjs (I029.2), the CLI's own
// `review` subcommand shells out to a real `git` binary with no injection
// point, and this project's own Docker test image has no `git` installed.
// Full `review` behaviour is already thoroughly covered at the service
// layer in automated-strategy-review-service.test.mjs with an injected
// fake `runGit`; this file only proves the CLI's own argument handling
// and the mock-default/--live-review gate wiring are correct.

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
import { createLocalJsonEngineeringStrategyReviewStoreAdapter } from "../../src/local-json-engineering-strategy-review-store-adapter.mjs";
import { createEngineeringStrategyReviewStore } from "../../src/engineering-strategy-review-store.mjs";
import { createEngineeringStrategyReview } from "../../src/engineering-strategy-review.mjs";
import { createStrategyReviewLock } from "../../src/strategy-review-lock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "strategy-review-agent.mjs");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-strategy-review-cli-"));
  const dirs = {
    workOrderDir: path.join(base, "work-orders"),
    deliveryReportDir: path.join(base, "delivery-reports"),
    strategyReviewDir: path.join(base, "strategy-reviews"),
    bridgeDir: path.join(base, "bridge"),
    lockDir: path.join(base, "locks"),
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
      milestone: "DC-003-I029.3",
      title: "CLI test task",
      objective: "Exercise the strategy review CLI.",
      reviewCriteria: ["at least one criterion"],
      status: "ready",
      approvedAt: "2026-08-05T00:00:00.000Z",
    })
  );
}

function seedReview(strategyReviewDir, workOrderId) {
  const store = createEngineeringStrategyReviewStore({ adapter: createLocalJsonEngineeringStrategyReviewStoreAdapter({ storageDir: strategyReviewDir }) });
  const review = createEngineeringStrategyReview({
    workOrderId,
    deliveryReportId: "dr_clitest000000001",
    workOrderReviewCriteria: ["at least one criterion"],
    milestone: "DC-003-I029.3",
    reviewerProvider: "mock",
    decision: "approved",
    criteria: [{ criterionIndex: 1, criterion: "at least one criterion", result: "pass", evidence: [], reason: null }],
    repositoryEvidence: { startingCommit: "aaa1111", endingCommit: "bbb2222", branch: "main", workingTree: "clean", pushStatus: "not_applicable", verifiable: true },
    verification: {
      tests: { status: "passed", passed: 1, failed: 0, total: 1, source: "independent-verification" },
      fixtures: { status: "passed", passed: 1, failed: 0, total: 1, source: "independent-verification" },
    },
    summary: "ok",
  });
  return store.save(review);
}

// --- usage -----------------------------------------------------------

test("no subcommand prints usage and exits non-zero", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("review without --lock/--export prints usage and exits non-zero", () => {
  const result = runCli("review", "wo_x", "dr_x", "a", "b", "c", "d", "/repo");
  assert.notEqual(result.status, 0);
});

test("status without --lock prints usage and exits non-zero", () => {
  const result = runCli("status", "dr_x", "a");
  assert.notEqual(result.status, 0);
});

// --- inspect ------------------------------------------------------------

test("inspect without --repo still reports the default mock reviewer, no crash", () => {
  const result = runCli("inspect");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mock-strategy-review-adapter/);
  assert.match(result.stdout, /Max OpenAI requests per review:\s*1/);
  assert.match(result.stdout, /No OpenAI invocation occurs/);
});

test("inspect --repo=<path> also reports the resolved Review Policy", () =>
  withTempDirs(({ base }) => {
    const result = runCli("inspect", `--repo=${base}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Rerun tests\/fixtures:\s*false\/false/);
    assert.match(result.stdout, /Allow routine approval:\s*true/);
  }));

test("inspect never reveals a credential value", () => {
  const result = runCli("inspect");
  assert.doesNotMatch(result.stdout, /sk-/);
});

// --- get ------------------------------------------------------------

test("get reports a real stored review", () =>
  withTempDirs(({ workOrderDir, strategyReviewDir }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const review = seedReview(strategyReviewDir, workOrder.work_order_id);
    const result = runCli("get", review.strategy_review_id, strategyReviewDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /decision:\s*approved/);
  }));

test("get fails safely for an unknown review id, no stack trace", () =>
  withTempDirs(({ strategyReviewDir }) => {
    const result = runCli("get", "esr_doesnotexist0001", strategyReviewDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EngineeringStrategyReviewNotFoundError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

// --- work ------------------------------------------------------------

test("work lists every review for a Work Order, zero when none exist", () =>
  withTempDirs(({ workOrderDir, strategyReviewDir }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const empty = runCli("work", workOrder.work_order_id, strategyReviewDir);
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /0 strategy review\(s\)/);

    seedReview(strategyReviewDir, workOrder.work_order_id);
    const withReview = runCli("work", workOrder.work_order_id, strategyReviewDir);
    assert.match(withReview.stdout, /1 strategy review\(s\)/);
  }));

// --- status ------------------------------------------------------------

test("status reports zero reviews and no lock held for a fresh Delivery Report", () =>
  withTempDirs(({ strategyReviewDir, lockDir }) => {
    const result = runCli("status", "dr_freshtest0000001", strategyReviewDir, `--lock=${lockDir}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /reviews:\s*0/);
    assert.match(result.stdout, /lock:\s*not held/);
  }));

test("status reports a held lock accurately", () =>
  withTempDirs(({ strategyReviewDir, lockDir }) => {
    // Static top-level import used deliberately — withTempDirs() here is
    // synchronous, matching the documented hazard already fixed once in
    // delivery-office-runner-cli.test.mjs (I029.2): an async continuation
    // inside this callback would race the directory cleanup.
    createStrategyReviewLock({ lockDir }).acquire("dr_locktest00000001");
    const result = runCli("status", "dr_locktest00000001", strategyReviewDir, `--lock=${lockDir}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /lock:\s*held/);
  }));

// --- explicit --live-review gate -----------------------------------------

test("review without --live-review selects the mock reviewer", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, strategyReviewDir, bridgeDir, lockDir, exportDir, base }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const result = runCli(
      "review",
      workOrder.work_order_id,
      "dr_livegatetest0001",
      workOrderDir,
      deliveryReportDir,
      strategyReviewDir,
      bridgeDir,
      base,
      `--lock=${lockDir}`,
      `--export=${exportDir}`
    );
    assert.match(result.stdout, /Reviewer:\s+mock-strategy-review-adapter\s+\(mock — no network\)/);
  }));

test("review with --live-review selects the real OpenAI adapter (printed before any request attempt)", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, strategyReviewDir, bridgeDir, lockDir, exportDir, base }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const result = runCli(
      "review",
      workOrder.work_order_id,
      "dr_livegatetest0002",
      workOrderDir,
      deliveryReportDir,
      strategyReviewDir,
      bridgeDir,
      base,
      `--lock=${lockDir}`,
      `--export=${exportDir}`,
      "--live-review"
    );
    // No OPENAI_API_KEY is set in this test environment, so adapter
    // construction itself fails fast with StrategyReviewConfigurationError
    // — proving the flag routes to the real adapter path without ever
    // making a network call.
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /StrategyReviewConfigurationError|OPENAI_API_KEY/);
  }));

// Unit tests for tests/validation/delivery-office-runner.mjs
// (DC-003-I029.2). Covers usage errors, the default-mock guarantee's
// static config surface (`inspect`), and `status` — all git-free.
//
// Deliberately NOT covered here: a full subprocess-level `execute` run.
// The CLI's own `execute` subcommand always shells out to a real `git`
// binary (readGitState/computeChangedFiles have no injection point at the
// CLI layer, unlike the service's own `options.runGit`) — and this
// project's own Docker test image (node:20-alpine) has no `git` installed
// (confirmed during this milestone's feasibility investigation). Full
// `execute` behaviour — eligibility, locking, independent verification,
// Bridge Transport integration, every runner-outcome branch — is already
// thoroughly covered at the service layer in
// automated-delivery-office-service.test.mjs with an injected fake
// `runGit`; this file only proves the CLI's own argument handling and
// the mock-default/--live-runner gate wiring are correct, both of which
// need no real git or Claude Code.

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
import { createDeliveryExecutionLock } from "../../src/delivery-execution-lock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "delivery-office-runner.mjs");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-delivery-office-cli-"));
  const dirs = {
    workOrderDir: path.join(base, "work-orders"),
    deliveryReportDir: path.join(base, "delivery-reports"),
    lockDir: path.join(base, "locks"),
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
      milestone: "DC-003-I029.2",
      title: "CLI test task",
      objective: "Exercise the delivery office CLI.",
      reviewCriteria: ["at least one criterion"],
      status: "ready",
      approvedAt: "2026-08-05T00:00:00.000Z",
    })
  );
}

// --- usage -----------------------------------------------------------

test("no subcommand prints usage and exits non-zero", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("execute without --repo/--lock/--drop prints usage and exits non-zero", () => {
  const result = runCli("execute", "wo_x", "a", "b", "c");
  assert.notEqual(result.status, 0);
});

test("status without --lock prints usage and exits non-zero", () => {
  const result = runCli("status", "wo_x", "a", "b");
  assert.notEqual(result.status, 0);
});

// --- inspect ------------------------------------------------------------

test("inspect without --repo still reports the default mock runner and live-mechanism config, no crash", () => {
  const result = runCli("inspect");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mock-delivery-office-runner/);
  assert.match(result.stdout, /No Claude Code invocation occurs/);
});

test("inspect --repo=<path> also reports the resolved Execution Policy, conservative by default", () =>
  withTempDirs(({ base }) => {
    const result = runCli("inspect", `--repo=${base}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Allow commits\/push\/docker:\s*false\/false\/false/);
    assert.match(result.stdout, /Prohibit live external:\s*true/);
  }));

test("inspect never reveals a credential value", () => {
  const result = runCli("inspect");
  assert.doesNotMatch(result.stdout, /sk-ant/);
});

// --- status ------------------------------------------------------------

test("status reports a Work Order with no Delivery Reports and no lock held", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, lockDir }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const result = runCli("status", workOrder.work_order_id, workOrderDir, deliveryReportDir, `--lock=${lockDir}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /delivery_reports:\s*0/);
    assert.match(result.stdout, /lock:\s*not held/);
  }));

test("status fails safely for an unknown work order id, no stack trace", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, lockDir }) => {
    const result = runCli("status", "wo_doesnotexist0001", workOrderDir, deliveryReportDir, `--lock=${lockDir}`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EngineeringWorkOrderNotFoundError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

// --- explicit --live-runner gate -----------------------------------------

test("execute without --live-runner selects the mock runner", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, lockDir, base }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const bridgeDir = path.join(base, "bridge");
    const dropDir = path.join(base, "drop");
    const result = runCli(
      "execute",
      workOrder.work_order_id,
      workOrderDir,
      deliveryReportDir,
      bridgeDir,
      `--repo=${base}`,
      `--lock=${lockDir}`,
      `--drop=${dropDir}`
    );
    assert.match(result.stdout, /Runner:\s+mock-delivery-office-runner\s+\(mock — no Claude Code execution\)/);
  }));

test("execute with --live-runner selects the real Claude Code adapter (printed before any execution attempt)", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, lockDir, base }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const bridgeDir = path.join(base, "bridge");
    const dropDir = path.join(base, "drop");
    const result = runCli(
      "execute",
      workOrder.work_order_id,
      workOrderDir,
      deliveryReportDir,
      bridgeDir,
      `--repo=${base}`,
      `--lock=${lockDir}`,
      `--drop=${dropDir}`,
      "--live-runner"
    );
    assert.match(result.stdout, /Runner:\s+claude-code-cli-delivery-runner\s+\(LIVE — real Claude Code execution\)/);
    // No real git repository exists at --repo, so eligibility/git-evidence
    // collection is expected to fail after this point — this test proves
    // only that the flag selects the correct adapter, not that a live run
    // succeeds (no real Claude Code execution is authorised here or
    // anywhere in this milestone's automated tests).
  }));

test("status reports a held lock accurately", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, lockDir }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    // Acquire a lock exactly the way the CLI's own execute path would —
    // through the same module, not a hand-rolled JSON file. A static
    // top-level import (not a dynamic import().then() inside this
    // callback) is deliberate: withTempDirs() in this file is
    // synchronous and deletes the temp directory in its own `finally`
    // block the instant this callback returns — an async continuation
    // here would race that cleanup exactly like the documented
    // withTempDir(s)-non-async hazard already hit three times elsewhere
    // in this codebase (I021/I021's export adapter/I026).
    createDeliveryExecutionLock({ lockDir }).acquire(workOrder.work_order_id);
    const result = runCli("status", workOrder.work_order_id, workOrderDir, deliveryReportDir, `--lock=${lockDir}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /lock:\s*held/);
  }));

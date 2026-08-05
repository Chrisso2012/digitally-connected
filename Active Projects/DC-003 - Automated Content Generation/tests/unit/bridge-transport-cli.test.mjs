// Unit tests for tests/validation/bridge.mjs (DC-003-I029.1). No
// networking anywhere in this CLI — always mock.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";
import { createEngineeringDeliveryReport } from "../../src/engineering-delivery-report.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "bridge.mjs");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-bridge-cli-"));
  const dirs = {
    workOrderDir: path.join(base, "work-orders"),
    deliveryReportDir: path.join(base, "delivery-reports"),
    transportDir: path.join(base, "transport"),
    destinationDir: path.join(base, "outgoing"),
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
      milestone: "DC-003-I029.1",
      title: "CLI test task",
      objective: "Exercise the bridge CLI.",
      reviewCriteria: ["at least one criterion"],
    })
  );
}

function writeDeliveryReportFile(filePath, workOrderId) {
  const report = createEngineeringDeliveryReport({
    workOrderId,
    milestone: "DC-003-I029.1",
    status: "completed",
    commit: "7d88509",
    pushStatus: "pushed",
    workingTree: "clean",
    tests: { passed: 1, failed: 0, total: 1 },
    fixtures: { passed: 1, failed: 0, total: 1 },
    liveRequests: { occurred: false, details: null },
  });
  writeFileSync(filePath, JSON.stringify(report), "utf-8");
  return report;
}

// --- usage -----------------------------------------------------------

test("no subcommand prints usage and exits non-zero", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("missing arguments print usage and exit non-zero, for every subcommand", () => {
  for (const args of [["export"], ["import"], ["queue"], ["history"]]) {
    const result = runCli(...args);
    assert.notEqual(result.status, 0, `expected non-zero exit for args: ${JSON.stringify(args)}`);
    assert.match(result.stderr, /Usage:/);
  }
});

// --- export ----------------------------------------------------------------

test("export moves a real Work Order to the destination and records a delivered transport", () =>
  withTempDirs(({ workOrderDir, transportDir, destinationDir }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const result = runCli("export", workOrder.work_order_id, workOrderDir, transportDir, destinationDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Export complete/);
    assert.match(result.stdout, /status:\s*delivered/);
  }));

test("export fails safely, no stack trace, for an unknown work order id", () =>
  withTempDirs(({ workOrderDir, transportDir, destinationDir }) => {
    const result = runCli("export", "wo_doesnotexist0001", workOrderDir, transportDir, destinationDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EngineeringWorkOrderNotFoundError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

// --- import ------------------------------------------------------------

test("import saves a real Delivery Report and records a delivered transport", () =>
  withTempDirs(({ workOrderDir, deliveryReportDir, transportDir, base }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const filePath = path.join(base, "delivery-report.json");
    writeDeliveryReportFile(filePath, workOrder.work_order_id);

    const result = runCli("import", filePath, deliveryReportDir, transportDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Import complete/);
    assert.match(result.stdout, /status:\s*delivered/);
  }));

test("import fails safely for a corrupt payload, no stack trace", () =>
  withTempDirs(({ deliveryReportDir, transportDir, base }) => {
    const filePath = path.join(base, "corrupt.json");
    writeFileSync(filePath, "{ not valid json", "utf-8");
    const result = runCli("import", filePath, deliveryReportDir, transportDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /BridgeTransportCorruptionError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

// --- queue / history ---------------------------------------------------

test("queue reports zero pending/delivered/rejected for an empty transport store", () =>
  withTempDirs(({ transportDir }) => {
    const result = runCli("queue", transportDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pending_exports:\s*0/);
    assert.match(result.stdout, /delivered:\s*0/);
    assert.match(result.stdout, /last_transport:\s*\(none\)/);
  }));

test("queue and history reflect a real export end to end", () =>
  withTempDirs(({ workOrderDir, transportDir, destinationDir }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    runCli("export", workOrder.work_order_id, workOrderDir, transportDir, destinationDir);

    const queueResult = runCli("queue", transportDir);
    assert.equal(queueResult.status, 0, queueResult.stderr);
    assert.match(queueResult.stdout, /delivered:\s*1/);
    assert.match(queueResult.stdout, /history_count:\s*1/);

    const historyResult = runCli("history", transportDir);
    assert.equal(historyResult.status, 0, historyResult.stderr);
    assert.match(historyResult.stdout, /1 transport record\(s\)/);
    assert.match(historyResult.stdout, new RegExp(workOrder.work_order_id));
  }));

// --- read-only guarantee for queue/history -------------------------------

test("queue and history never write to the transport store directory", () =>
  withTempDirs(({ workOrderDir, transportDir, destinationDir }) => {
    const workOrder = seedWorkOrder(workOrderDir);
    runCli("export", workOrder.work_order_id, workOrderDir, transportDir, destinationDir);
    const beforeFiles = readdirSync(transportDir).sort();

    runCli("queue", transportDir);
    runCli("history", transportDir);

    assert.deepEqual(readdirSync(transportDir).sort(), beforeFiles);
  }));

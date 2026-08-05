// Unit tests for tests/validation/engineering.mjs (DC-003-I029). No
// networking anywhere in this CLI — every test here just seeds/reads local
// stores directly or via the CLI itself.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import { createEngineeringDeliveryReport } from "../../src/engineering-delivery-report.mjs";
import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "engineering.mjs");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

function withTempDirs(fn) {
  const workOrderDir = mkdtempSync(path.join(tmpdir(), "dc003-eng-cli-wo-"));
  const deliveryReportDir = mkdtempSync(path.join(tmpdir(), "dc003-eng-cli-dr-"));
  try {
    return fn(workOrderDir, deliveryReportDir);
  } finally {
    rmSync(workOrderDir, { recursive: true, force: true });
    rmSync(deliveryReportDir, { recursive: true, force: true });
  }
}

function seedWorkOrder(workOrderDir, overrides = {}) {
  const store = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: workOrderDir }) });
  const workOrder = createEngineeringWorkOrder({
    milestone: "DC-003-I029",
    title: "Seeded Work Order",
    objective: "Exercise the CLI.",
    reviewCriteria: ["at least one criterion"],
    ...overrides,
  });
  return store.save(workOrder);
}

function seedDeliveryReport(deliveryReportDir, overrides = {}) {
  const store = createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: deliveryReportDir }) });
  const report = createEngineeringDeliveryReport({
    workOrderId: "wo_clitest0000000001",
    milestone: "DC-003-I029",
    status: "completed",
    commit: "7d88509",
    pushStatus: "pushed",
    workingTree: "clean",
    tests: { passed: 10, failed: 0, total: 10 },
    fixtures: { passed: 1, failed: 0, total: 1 },
    liveRequests: { occurred: false, details: null },
    ...overrides,
  });
  return store.save(report);
}

// --- usage -----------------------------------------------------------

test("no subcommand prints usage and exits non-zero", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("missing arguments print usage and exit non-zero, for every subcommand", () => {
  for (const args of [["work", "list"], ["work", "get"], ["work", "create"], ["report", "list"], ["report", "get"], ["status"]]) {
    const result = runCli(...args);
    assert.notEqual(result.status, 0, `expected non-zero exit for args: ${JSON.stringify(args)}`);
    assert.match(result.stderr, /Usage:/);
  }
});

// --- work create ---------------------------------------------------------

test("work create builds a real, immutable Draft work order", () =>
  withTempDirs((workOrderDir) => {
    const result = runCli(
      "work",
      "create",
      "DC-003-I029",
      "draft",
      workOrderDir,
      "--title=Test Task",
      "--objective=Exercise work create",
      "--review-criteria=criterion one|criterion two"
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Work order created/);
    assert.match(result.stdout, /status:\s*draft/);
    assert.match(result.stdout, /approved_at:\s*null/);

    const store = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: workOrderDir }) });
    assert.equal(store.list().length, 1);
  }));

test("work create builds a Ready work order with an auto-set approved_at", () =>
  withTempDirs((workOrderDir) => {
    const result = runCli(
      "work",
      "create",
      "DC-003-I029",
      "ready",
      workOrderDir,
      "--title=Test Task",
      "--objective=Exercise work create",
      "--review-criteria=criterion one",
      "--priority=high"
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /status:\s*ready/);
    assert.doesNotMatch(result.stdout, /approved_at:\s*null/);
  }));

test("work create rejects any status other than draft/ready — the CLI never creates any other status", () =>
  withTempDirs((workOrderDir) => {
    const result = runCli(
      "work",
      "create",
      "DC-003-I029",
      "approved",
      workOrderDir,
      "--title=Test Task",
      "--objective=Exercise work create",
      "--review-criteria=criterion one"
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /status must be "draft" or "ready"/);
  }));

test("work create fails safely for an invalid milestone, no stack trace", () =>
  withTempDirs((workOrderDir) => {
    const result = runCli("work", "create", "NOT-A-MILESTONE", "draft", workOrderDir, "--title=t", "--objective=o", "--review-criteria=c1");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /InvalidEngineeringWorkOrderInputError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

// --- work list / get ------------------------------------------------------

test("work list reports a real seeded work order", () =>
  withTempDirs((workOrderDir) => {
    const seeded = seedWorkOrder(workOrderDir);
    const result = runCli("work", "list", workOrderDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 work order\(s\)/);
    assert.match(result.stdout, new RegExp(seeded.work_order_id));
  }));

test("work get retrieves a real seeded work order by ID", () =>
  withTempDirs((workOrderDir) => {
    const seeded = seedWorkOrder(workOrderDir);
    const result = runCli("work", "get", seeded.work_order_id, workOrderDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Work order found/);
    assert.match(result.stdout, new RegExp(`work_order_id:\\s*${seeded.work_order_id}`));
  }));

test("work get fails safely, no stack trace, for an unknown ID", () =>
  withTempDirs((workOrderDir) => {
    const result = runCli("work", "get", "wo_doesnotexist0001", workOrderDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EngineeringWorkOrderNotFoundError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

// --- report list / get (no "report create" — matches publisher-results.mjs's own precedent) ---

test("report list reports a real seeded delivery report", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const seeded = seedDeliveryReport(deliveryReportDir);
    const result = runCli("report", "list", deliveryReportDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 delivery report\(s\)/);
    assert.match(result.stdout, new RegExp(seeded.delivery_report_id));
  }));

test("report get retrieves a real seeded delivery report by ID", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const seeded = seedDeliveryReport(deliveryReportDir);
    const result = runCli("report", "get", seeded.delivery_report_id, deliveryReportDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Delivery report found/);
    assert.match(result.stdout, new RegExp(`delivery_report_id:\\s*${seeded.delivery_report_id}`));
  }));

// --- status ----------------------------------------------------------------

test("status reports a clean summary from repository evidence", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const workOrder = seedWorkOrder(workOrderDir, { status: "ready", approvedAt: "2026-08-05T00:00:00.000Z" });
    seedDeliveryReport(deliveryReportDir, { workOrderId: workOrder.work_order_id });

    const result = runCli("status", workOrderDir, deliveryReportDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /current_milestone:\s*DC-003-I029/);
    assert.match(result.stdout, /last_completed_milestone:\s*DC-003-I029/);
    assert.match(result.stdout, /awaiting_review:\s*1/);
  }));

test("status reports honest nulls/zeros for empty stores", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const result = runCli("status", workOrderDir, deliveryReportDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /current_milestone:\s*null/);
    assert.match(result.stdout, /outstanding_work_orders:\s*0/);
  }));

// --- read-only guarantee for read subcommands ---------------------------

test("work list/get, report list/get, and status never write to either store directory", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const workOrder = seedWorkOrder(workOrderDir);
    const report = seedDeliveryReport(deliveryReportDir, { workOrderId: workOrder.work_order_id });
    const beforeWorkFiles = readdirSync(workOrderDir).sort();
    const beforeReportFiles = readdirSync(deliveryReportDir).sort();

    runCli("work", "list", workOrderDir);
    runCli("work", "get", workOrder.work_order_id, workOrderDir);
    runCli("report", "list", deliveryReportDir);
    runCli("report", "get", report.delivery_report_id, deliveryReportDir);
    runCli("status", workOrderDir, deliveryReportDir);

    assert.deepEqual(readdirSync(workOrderDir).sort(), beforeWorkFiles);
    assert.deepEqual(readdirSync(deliveryReportDir).sort(), beforeReportFiles);
  }));

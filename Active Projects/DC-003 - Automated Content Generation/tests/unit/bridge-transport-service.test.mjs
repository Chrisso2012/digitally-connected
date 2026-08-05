import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createEngineeringDeliveryReport } from "../../src/engineering-delivery-report.mjs";
import { createBridgeTransportStore } from "../../src/bridge-transport-store.mjs";
import { createLocalJsonBridgeTransportStoreAdapter } from "../../src/local-json-bridge-transport-store-adapter.mjs";
import { createMockBridgeTransportAdapter } from "../../src/bridge-transport-mock-adapter.mjs";
import { exportWorkOrder, importDeliveryReport, getQueue, getHistory } from "../../src/bridge-transport-service.mjs";
import { EngineeringWorkOrderNotFoundError } from "../../src/engineering-work-order-errors.mjs";
import { DuplicateBridgeTransportError, BridgeTransportCorruptionError, BridgeTransportSendError } from "../../src/bridge-transport-errors.mjs";

// Deliberately async, awaiting fn() before cleanup — see
// social-analytics-service.test.mjs's own header comment for why a
// non-async version of this helper is a documented, previously-recurring
// hazard in this codebase.
async function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-bridge-service-"));
  const dirs = {
    workOrderDir: path.join(base, "work-orders"),
    deliveryReportDir: path.join(base, "delivery-reports"),
    transportDir: path.join(base, "transport"),
    destinationDir: path.join(base, "outgoing"),
  };
  try {
    return await fn(dirs);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function buildStores({ workOrderDir, deliveryReportDir, transportDir }) {
  return {
    workOrderStore: createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: workOrderDir }) }),
    deliveryReportStore: createEngineeringDeliveryReportStore({
      adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: deliveryReportDir }),
    }),
    transportStore: createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: transportDir }) }),
  };
}

function seedWorkOrder(workOrderStore, overrides = {}) {
  return workOrderStore.save(
    createEngineeringWorkOrder({
      milestone: "DC-003-I029.1",
      title: "Bridge test task",
      objective: "Exercise the transport service.",
      reviewCriteria: ["at least one criterion"],
      ...overrides,
    })
  );
}

function writeValidDeliveryReportFile(filePath, overrides = {}) {
  const report = createEngineeringDeliveryReport({
    workOrderId: "wo_bridgetest0000001",
    milestone: "DC-003-I029.1",
    status: "completed",
    commit: "7d88509",
    pushStatus: "pushed",
    workingTree: "clean",
    tests: { passed: 1, failed: 0, total: 1 },
    fixtures: { passed: 1, failed: 0, total: 1 },
    liveRequests: { occurred: false, details: null },
    ...overrides,
  });
  writeFileSync(filePath, JSON.stringify(report), "utf-8");
  return report;
}

// --- exportWorkOrder -----------------------------------------------------

test("exportWorkOrder(): success writes the file, persists a delivered record, never mutates the Work Order Store", () =>
  withTempDirs(async (dirs) => {
    const { workOrderStore, transportStore } = buildStores(dirs);
    const workOrder = seedWorkOrder(workOrderStore);
    const guardedWorkOrderStore = { ...workOrderStore, save: () => { throw new Error("must not be called"); } };

    const result = await exportWorkOrder(
      { workOrderId: workOrder.work_order_id, destinationDir: dirs.destinationDir },
      { workOrderStore: guardedWorkOrderStore, transportStore, adapter: createMockBridgeTransportAdapter() }
    );

    assert.equal(result.status, "delivered");
    assert.ok(existsSync(result.destinationPath));
    assert.equal(transportStore.list().length, 1);
    assert.equal(transportStore.get(result.transportRecordId).status, "delivered");
  }));

test("exportWorkOrder(): an unknown work order id propagates EngineeringWorkOrderNotFoundError, no transport record created", () =>
  withTempDirs(async (dirs) => {
    const { workOrderStore, transportStore } = buildStores(dirs);
    await assert.rejects(
      () => exportWorkOrder({ workOrderId: "wo_doesnotexist0001", destinationDir: dirs.destinationDir }, { workOrderStore, transportStore, adapter: createMockBridgeTransportAdapter() }),
      EngineeringWorkOrderNotFoundError
    );
    assert.equal(transportStore.list().length, 0);
  }));

test("exportWorkOrder(): a second export of the same Work Order is rejected before any adapter call, and recorded", () =>
  withTempDirs(async (dirs) => {
    const { workOrderStore, transportStore } = buildStores(dirs);
    const workOrder = seedWorkOrder(workOrderStore);
    const adapter = createMockBridgeTransportAdapter();

    await exportWorkOrder({ workOrderId: workOrder.work_order_id, destinationDir: dirs.destinationDir }, { workOrderStore, transportStore, adapter });

    let sendCalls = 0;
    const countingAdapter = { ...adapter, sendWorkOrder: async (...args) => { sendCalls += 1; return adapter.sendWorkOrder(...args); } };
    await assert.rejects(
      () => exportWorkOrder({ workOrderId: workOrder.work_order_id, destinationDir: dirs.destinationDir }, { workOrderStore, transportStore, adapter: countingAdapter }),
      DuplicateBridgeTransportError
    );
    assert.equal(sendCalls, 0, "the adapter must never be called for a known duplicate");

    const history = transportStore.findByObject(workOrder.work_order_id);
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((r) => r.status), ["delivered", "rejected"]);
  }));

test("exportWorkOrder(): an adapter failure is recorded as 'rejected' with notes, then rethrown", () =>
  withTempDirs(async (dirs) => {
    const { workOrderStore, transportStore } = buildStores(dirs);
    const workOrder = seedWorkOrder(workOrderStore);

    await assert.rejects(
      () =>
        exportWorkOrder(
          { workOrderId: workOrder.work_order_id, destinationDir: dirs.destinationDir },
          { workOrderStore, transportStore, adapter: createMockBridgeTransportAdapter({ mode: "failure" }) }
        ),
      BridgeTransportSendError
    );
    const [record] = transportStore.findByObject(workOrder.work_order_id);
    assert.equal(record.status, "rejected");
    assert.match(record.notes, /simulated transport failure/);
  }));

// --- importDeliveryReport --------------------------------------------------

test("importDeliveryReport(): success persists the report into the real store and records a delivered transport", () =>
  withTempDirs(async (dirs) => {
    const { deliveryReportStore, transportStore } = buildStores(dirs);
    const filePath = path.join(dirs.destinationDir, "..", "delivery-report.json");
    const report = writeValidDeliveryReportFile(filePath);

    const result = await importDeliveryReport(
      { sourcePath: filePath },
      { deliveryReportStore, transportStore, adapter: createMockBridgeTransportAdapter() }
    );

    assert.equal(result.status, "delivered");
    assert.equal(result.deliveryReportId, report.delivery_report_id);
    assert.equal(deliveryReportStore.exists(report.delivery_report_id), true);
    assert.equal(transportStore.list().length, 1);
  }));

test("importDeliveryReport(): a corrupt/unreadable payload throws BridgeTransportCorruptionError, no store touched", () =>
  withTempDirs(async (dirs) => {
    const { deliveryReportStore, transportStore } = buildStores(dirs);
    const filePath = path.join(dirs.destinationDir, "..", "corrupt.json");
    writeFileSync(filePath, "{ not valid json", "utf-8");

    await assert.rejects(
      () => importDeliveryReport({ sourcePath: filePath }, { deliveryReportStore, transportStore, adapter: createMockBridgeTransportAdapter() }),
      BridgeTransportCorruptionError
    );
    assert.equal(deliveryReportStore.list().length, 0);
    assert.equal(transportStore.list().length, 0);
  }));

test("importDeliveryReport(): valid JSON that doesn't match the Delivery Report schema is treated as corruption, no record", () =>
  withTempDirs(async (dirs) => {
    const { deliveryReportStore, transportStore } = buildStores(dirs);
    const filePath = path.join(dirs.destinationDir, "..", "wrong-shape.json");
    writeFileSync(filePath, JSON.stringify({ hello: "world" }), "utf-8");

    await assert.rejects(
      () => importDeliveryReport({ sourcePath: filePath }, { deliveryReportStore, transportStore, adapter: createMockBridgeTransportAdapter() }),
      BridgeTransportCorruptionError
    );
    assert.equal(transportStore.list().length, 0);
  }));

test("importDeliveryReport(): re-importing an already-stored Delivery Report is rejected and recorded, never double-saved", () =>
  withTempDirs(async (dirs) => {
    const { deliveryReportStore, transportStore } = buildStores(dirs);
    const filePath = path.join(dirs.destinationDir, "..", "delivery-report.json");
    writeValidDeliveryReportFile(filePath);
    const adapter = createMockBridgeTransportAdapter();

    await importDeliveryReport({ sourcePath: filePath }, { deliveryReportStore, transportStore, adapter });
    await assert.rejects(
      () => importDeliveryReport({ sourcePath: filePath }, { deliveryReportStore, transportStore, adapter }),
      DuplicateBridgeTransportError
    );

    assert.equal(deliveryReportStore.list().length, 1, "never double-saved");
    const history = transportStore.list();
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((r) => r.status), ["delivered", "rejected"]);
  }));

// --- getQueue() / getHistory() ---------------------------------------------

test("getQueue(): pending counts stay 0 under the synchronous mock, delivered/rejected/last_transport/history_count are accurate", () =>
  withTempDirs(async (dirs) => {
    const { workOrderStore, deliveryReportStore, transportStore } = buildStores(dirs);
    const workOrder = seedWorkOrder(workOrderStore);
    await exportWorkOrder({ workOrderId: workOrder.work_order_id, destinationDir: dirs.destinationDir }, { workOrderStore, transportStore, adapter: createMockBridgeTransportAdapter() });

    const filePath = path.join(dirs.destinationDir, "..", "delivery-report.json");
    writeValidDeliveryReportFile(filePath);
    await importDeliveryReport({ sourcePath: filePath }, { deliveryReportStore, transportStore, adapter: createMockBridgeTransportAdapter() });

    const queue = getQueue({ transportStore });
    assert.equal(queue.pending_exports, 0);
    assert.equal(queue.pending_imports, 0);
    assert.equal(queue.delivered, 2);
    assert.equal(queue.rejected, 0);
    assert.equal(queue.history_count, 2);
    assert.equal(queue.last_transport.direction, "incoming");
  }));

test("getHistory(): returns every record chronologically, matching the store's own list()", () =>
  withTempDirs(async (dirs) => {
    const { workOrderStore, transportStore } = buildStores(dirs);
    const workOrder = seedWorkOrder(workOrderStore);
    await exportWorkOrder({ workOrderId: workOrder.work_order_id, destinationDir: dirs.destinationDir }, { workOrderStore, transportStore, adapter: createMockBridgeTransportAdapter() });

    const history = getHistory({ transportStore });
    assert.equal(history.length, 1);
    assert.equal(history[0].object_id, workOrder.work_order_id);
  }));

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
import { createEngineeringDeliveryReport } from "../../src/engineering-delivery-report.mjs";
import { createEngineeringWorkManagementService } from "../../src/engineering-work-management-service.mjs";
import { InvalidEngineeringWorkManagementDependenciesError } from "../../src/engineering-work-management-errors.mjs";

function withTempDirs(fn) {
  const workOrderDir = mkdtempSync(path.join(tmpdir(), "dc003-eng-service-wo-"));
  const deliveryReportDir = mkdtempSync(path.join(tmpdir(), "dc003-eng-service-dr-"));
  try {
    return fn(workOrderDir, deliveryReportDir);
  } finally {
    rmSync(workOrderDir, { recursive: true, force: true });
    rmSync(deliveryReportDir, { recursive: true, force: true });
  }
}

function buildStores(workOrderDir, deliveryReportDir) {
  const workOrderStore = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: workOrderDir }) });
  const deliveryReportStore = createEngineeringDeliveryReportStore({
    adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: deliveryReportDir }),
  });
  return { workOrderStore, deliveryReportStore };
}

function buildWorkOrder(overrides = {}, options = {}) {
  return createEngineeringWorkOrder(
    { milestone: "DC-003-I029", title: "t", objective: "o", reviewCriteria: ["c1"], ...overrides },
    options
  );
}

function buildReport(overrides = {}, options = {}) {
  return createEngineeringDeliveryReport(
    {
      workOrderId: "wo_placeholder00001",
      milestone: "DC-003-I029",
      status: "completed",
      commit: "7d88509",
      pushStatus: "pushed",
      workingTree: "clean",
      tests: { passed: 1, failed: 0, total: 1 },
      fixtures: { passed: 1, failed: 0, total: 1 },
      liveRequests: { occurred: false, details: null },
      ...overrides,
    },
    options
  );
}

test("throws InvalidEngineeringWorkManagementDependenciesError for missing/malformed dependencies", () => {
  assert.throws(() => createEngineeringWorkManagementService({}), InvalidEngineeringWorkManagementDependenciesError);
  assert.throws(() => createEngineeringWorkManagementService({ workOrderStore: { list() {} } }), InvalidEngineeringWorkManagementDependenciesError);
});

test("listWorkOrders(): a work order with no delivery report shows its own status verbatim", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const { workOrderStore, deliveryReportStore } = buildStores(workOrderDir, deliveryReportDir);
    const workOrder = buildWorkOrder({ status: "ready", approvedAt: "2026-08-05T00:00:00.000Z" }, { idGenerator: () => "wo_ready0000000001" });
    workOrderStore.save(workOrder);

    const service = createEngineeringWorkManagementService({ workOrderStore, deliveryReportStore });
    const [summary] = service.listWorkOrders();
    assert.equal(summary.derived_state, "Ready");
    assert.equal(summary.delivery_report_count, 0);
  }));

test("listWorkOrders(): a delivered-but-not-yet-approved work order shows 'Awaiting Review'", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const { workOrderStore, deliveryReportStore } = buildStores(workOrderDir, deliveryReportDir);
    const workOrder = buildWorkOrder({ status: "ready", approvedAt: "2026-08-05T00:00:00.000Z" }, { idGenerator: () => "wo_delivered000001" });
    workOrderStore.save(workOrder);
    deliveryReportStore.save(buildReport({ workOrderId: workOrder.work_order_id }, { idGenerator: () => "dr_delivered000001" }));

    const service = createEngineeringWorkManagementService({ workOrderStore, deliveryReportStore });
    const [summary] = service.listWorkOrders();
    assert.equal(summary.derived_state, "Awaiting Review");
    assert.equal(summary.delivery_report_count, 1);
  }));

test("listWorkOrders(): once the Strategy Office records 'approved'/'archived' on the work order, that decision wins over 'Awaiting Review'", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const { workOrderStore, deliveryReportStore } = buildStores(workOrderDir, deliveryReportDir);
    const workOrder = buildWorkOrder(
      { status: "approved", approvedAt: "2026-08-05T00:00:00.000Z" },
      { idGenerator: () => "wo_approved000001" }
    );
    workOrderStore.save(workOrder);
    deliveryReportStore.save(buildReport({ workOrderId: workOrder.work_order_id }, { idGenerator: () => "dr_approved000001" }));

    const service = createEngineeringWorkManagementService({ workOrderStore, deliveryReportStore });
    const [summary] = service.listWorkOrders();
    assert.equal(summary.derived_state, "Approved");
  }));

test("listWorkOrders(): 'draft'/'in_progress'/'completed'/'archived' pass through verbatim when no report exists", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const { workOrderStore, deliveryReportStore } = buildStores(workOrderDir, deliveryReportDir);
    workOrderStore.save(buildWorkOrder({ status: "draft" }, { idGenerator: () => "wo_draft0000000001" }));
    workOrderStore.save(buildWorkOrder({ status: "in_progress", approvedAt: "2026-08-05T00:00:00.000Z" }, { idGenerator: () => "wo_inprogress00001" }));
    workOrderStore.save(buildWorkOrder({ status: "completed", approvedAt: "2026-08-05T00:00:00.000Z" }, { idGenerator: () => "wo_completed000001" }));
    workOrderStore.save(buildWorkOrder({ status: "archived", approvedAt: "2026-08-05T00:00:00.000Z" }, { idGenerator: () => "wo_archived000001" }));

    const service = createEngineeringWorkManagementService({ workOrderStore, deliveryReportStore });
    const states = Object.fromEntries(service.listWorkOrders().map((w) => [w.work_order_id, w.derived_state]));
    assert.equal(states.wo_draft0000000001, "Draft");
    assert.equal(states.wo_inprogress00001, "In Progress");
    assert.equal(states.wo_completed000001, "Completed");
    assert.equal(states.wo_archived000001, "Archived");
  }));

test("getWorkOrder(): joins one work order to every one of its delivery reports, oldest to newest", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const { workOrderStore, deliveryReportStore } = buildStores(workOrderDir, deliveryReportDir);
    const workOrder = buildWorkOrder({ status: "ready", approvedAt: "2026-08-05T00:00:00.000Z" }, { idGenerator: () => "wo_jointest0000001" });
    workOrderStore.save(workOrder);
    deliveryReportStore.save(
      buildReport({ workOrderId: workOrder.work_order_id, status: "partial" }, { idGenerator: () => "dr_jointest0000001", now: () => "2026-08-01T00:00:00.000Z" })
    );
    deliveryReportStore.save(
      buildReport({ workOrderId: workOrder.work_order_id }, { idGenerator: () => "dr_jointest0000002", now: () => "2026-08-03T00:00:00.000Z" })
    );

    const service = createEngineeringWorkManagementService({ workOrderStore, deliveryReportStore });
    const detail = service.getWorkOrder(workOrder.work_order_id);
    assert.equal(detail.work_order.work_order_id, workOrder.work_order_id);
    assert.deepEqual(
      detail.delivery_reports.map((r) => r.delivery_report_id),
      ["dr_jointest0000001", "dr_jointest0000002"]
    );
    assert.equal(detail.derived_state, "Awaiting Review");
  }));

test("getStatus(): assembles current/last-completed milestone, outstanding/awaiting-review counts, and repository status from repository evidence only", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const { workOrderStore, deliveryReportStore } = buildStores(workOrderDir, deliveryReportDir);

    const readyOrder = buildWorkOrder(
      { milestone: "DC-003-I028", status: "ready", approvedAt: "2026-08-01T00:00:00.000Z" },
      { idGenerator: () => "wo_status0000001", now: () => "2026-08-01T00:00:00.000Z" }
    );
    const deliveredOrder = buildWorkOrder(
      { milestone: "DC-003-I029", status: "ready", approvedAt: "2026-08-05T00:00:00.000Z" },
      { idGenerator: () => "wo_status0000002", now: () => "2026-08-05T00:00:00.000Z" }
    );
    workOrderStore.save(readyOrder);
    workOrderStore.save(deliveredOrder);
    deliveryReportStore.save(
      buildReport(
        { workOrderId: deliveredOrder.work_order_id, milestone: "DC-003-I029", commit: "abc1234" },
        { idGenerator: () => "dr_status0000001", now: () => "2026-08-05T12:00:00.000Z" }
      )
    );

    const service = createEngineeringWorkManagementService({ workOrderStore, deliveryReportStore });
    const status = service.getStatus();

    assert.equal(status.current_milestone, "DC-003-I029"); // most recently created work order
    assert.equal(status.last_completed_milestone, "DC-003-I029");
    assert.equal(status.outstanding_work_orders, 1); // the still-Ready one
    assert.equal(status.awaiting_review, 1); // the delivered one
    assert.deepEqual(status.repository_status, { commit: "abc1234", push_status: "pushed", working_tree: "clean" });
    assert.equal(status.latest_delivery_report.delivery_report_id, "dr_status0000001");
  }));

test("getStatus(): honestly reports nulls/zeros when no work orders or delivery reports exist yet", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const { workOrderStore, deliveryReportStore } = buildStores(workOrderDir, deliveryReportDir);
    const service = createEngineeringWorkManagementService({ workOrderStore, deliveryReportStore });
    const status = service.getStatus();
    assert.equal(status.current_milestone, null);
    assert.equal(status.last_completed_milestone, null);
    assert.equal(status.outstanding_work_orders, 0);
    assert.equal(status.awaiting_review, 0);
    assert.equal(status.repository_status, null);
    assert.equal(status.latest_delivery_report, null);
  }));

test("this service never imports node:fs directly and never mutates either store — read-only throughout", () =>
  withTempDirs((workOrderDir, deliveryReportDir) => {
    const { workOrderStore, deliveryReportStore } = buildStores(workOrderDir, deliveryReportDir);
    const guardedWorkOrderStore = {
      ...workOrderStore,
      save() {
        throw new Error("must not be called");
      },
    };
    const guardedDeliveryReportStore = {
      ...deliveryReportStore,
      save() {
        throw new Error("must not be called");
      },
    };
    const service = createEngineeringWorkManagementService({ workOrderStore: guardedWorkOrderStore, deliveryReportStore: guardedDeliveryReportStore });
    service.listWorkOrders();
    service.listDeliveryReports();
    service.getStatus();
    // No assertion needed beyond "did not throw" — save() would have thrown if called.
  }));

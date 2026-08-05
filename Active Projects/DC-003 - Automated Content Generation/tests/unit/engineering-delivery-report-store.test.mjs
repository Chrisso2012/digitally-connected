import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createEngineeringDeliveryReport } from "../../src/engineering-delivery-report.mjs";
import {
  InvalidEngineeringDeliveryReportStoreAdapterError,
  InvalidEngineeringDeliveryReportIdentifierError,
  EngineeringDeliveryReportAlreadyExistsError,
  EngineeringDeliveryReportNotFoundError,
  CorruptedEngineeringDeliveryReportError,
} from "../../src/engineering-delivery-report-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-eng-delivery-report-store-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir }) });
}

function buildReport(overrides = {}, options = {}) {
  return createEngineeringDeliveryReport(
    {
      workOrderId: "wo_reporttest000001",
      milestone: "DC-003-I029",
      status: "completed",
      commit: "7d88509",
      pushStatus: "pushed",
      workingTree: "clean",
      tests: { passed: 10, failed: 0, total: 10 },
      fixtures: { passed: 1, failed: 0, total: 1 },
      liveRequests: { occurred: false, details: null },
      ...overrides,
    },
    options
  );
}

test("throws InvalidEngineeringDeliveryReportStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createEngineeringDeliveryReportStore({ adapter: { name: "x" } }), InvalidEngineeringDeliveryReportStoreAdapterError);
});

test("save() persists a valid report and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const report = buildReport({}, { idGenerator: () => "dr_savetest0000001" });
    const saved = store.save(report);
    assert.equal(saved.delivery_report_id, "dr_savetest0000001");
    assert.throws(() => {
      saved.status = "failed";
    }, TypeError);
  }));

test("save() rejects a second save for the same delivery_report_id — never overwrites", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "dr_duplicatetest001";
    store.save(buildReport({}, { idGenerator: idGen }));
    assert.throws(() => store.save(buildReport({}, { idGenerator: idGen })), EngineeringDeliveryReportAlreadyExistsError);
  }));

test("get() retrieves a stored, immutable report; throws for missing/invalid identifiers", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const report = buildReport({}, { idGenerator: () => "dr_gettest00000001" });
    store.save(report);
    const fetched = store.get("dr_gettest00000001");
    assert.equal(fetched.status, "completed");
    assert.throws(() => store.get("dr_doesnotexist0001"), EngineeringDeliveryReportNotFoundError);
    assert.throws(() => store.get("../../etc/passwd"), InvalidEngineeringDeliveryReportIdentifierError);
  }));

test("list() throws CorruptedEngineeringDeliveryReportError naming the specific corrupted identifier", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: dir });
    adapter.write("dr_corrupted0000001", "{ not valid json");
    const store = createEngineeringDeliveryReportStore({ adapter });
    assert.throws(
      () => store.list(),
      (error) => {
        assert.ok(error instanceof CorruptedEngineeringDeliveryReportError);
        assert.equal(error.identifier, "dr_corrupted0000001");
        return true;
      }
    );
  }));

test("findByWorkOrder() returns every full report matching the given work_order_id, ordered chronologically, [] when none match", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const early = buildReport({ workOrderId: "wo_target000000001" }, { idGenerator: () => "dr_a00000000000001", now: () => "2026-08-01T00:00:00.000Z" });
    const late = buildReport({ workOrderId: "wo_target000000001" }, { idGenerator: () => "dr_b00000000000002", now: () => "2026-08-05T00:00:00.000Z" });
    const other = buildReport({ workOrderId: "wo_other0000000002" }, { idGenerator: () => "dr_c00000000000003" });
    store.save(late); // saved out of order — must still come back sorted
    store.save(early);
    store.save(other);

    const results = store.findByWorkOrder("wo_target000000001");
    assert.deepEqual(results.map((r) => r.delivery_report_id), ["dr_a00000000000001", "dr_b00000000000002"]);
    assert.deepEqual(store.findByWorkOrder("wo_nomatch0000000001"), []);
  }));

test("findByWorkOrder() returns full, deep-frozen records, not summaries", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const report = buildReport({}, { idGenerator: () => "dr_fulltest0000001" });
    store.save(report);
    const [found] = store.findByWorkOrder(report.work_order_id);
    assert.equal(found.commit, "7d88509");
    assert.throws(() => {
      found.status = "failed";
    }, TypeError);
  }));

test("list() returns safe summaries ordered chronologically", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildReport({}, { idGenerator: () => "dr_second000000002", now: () => "2026-08-02T00:00:00.000Z" }));
    store.save(buildReport({}, { idGenerator: () => "dr_first0000000001", now: () => "2026-08-01T00:00:00.000Z" }));
    const summaries = store.list();
    assert.deepEqual(
      summaries.map((s) => s.delivery_report_id),
      ["dr_first0000000001", "dr_second000000002"]
    );
  }));

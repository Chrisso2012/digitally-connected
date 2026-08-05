import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";
import {
  InvalidEngineeringWorkOrderStoreAdapterError,
  InvalidEngineeringWorkOrderIdentifierError,
  EngineeringWorkOrderAlreadyExistsError,
  EngineeringWorkOrderNotFoundError,
  CorruptedEngineeringWorkOrderError,
} from "../../src/engineering-work-order-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-eng-work-order-store-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir }) });
}

function buildWorkOrder(overrides = {}, options = {}) {
  return createEngineeringWorkOrder(
    {
      milestone: "DC-003-I029",
      title: "Test Work Order",
      objective: "Exercise the store.",
      reviewCriteria: ["at least one criterion"],
      ...overrides,
    },
    options
  );
}

test("throws InvalidEngineeringWorkOrderStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createEngineeringWorkOrderStore({ adapter: { name: "x" } }), InvalidEngineeringWorkOrderStoreAdapterError);
});

test("save() persists a valid work order and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const workOrder = buildWorkOrder({}, { idGenerator: () => "wo_savetest0000001" });
    const saved = store.save(workOrder);
    assert.equal(saved.work_order_id, "wo_savetest0000001");
    assert.throws(() => {
      saved.status = "approved";
    }, TypeError);
  }));

test("save() rejects a second save for the same work_order_id — never overwrites", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "wo_duplicatetest001";
    store.save(buildWorkOrder({}, { idGenerator: idGen }));
    assert.throws(() => store.save(buildWorkOrder({}, { idGenerator: idGen })), EngineeringWorkOrderAlreadyExistsError);
  }));

test("get() retrieves a stored, immutable work order; throws for missing/invalid identifiers", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const workOrder = buildWorkOrder({}, { idGenerator: () => "wo_gettest00000001" });
    store.save(workOrder);
    const fetched = store.get("wo_gettest00000001");
    assert.equal(fetched.title, "Test Work Order");
    assert.throws(() => store.get("wo_doesnotexist0001"), EngineeringWorkOrderNotFoundError);
    assert.throws(() => store.get("../../etc/passwd"), InvalidEngineeringWorkOrderIdentifierError);
  }));

test("exists() reflects save() and is false for an unknown identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const workOrder = buildWorkOrder({}, { idGenerator: () => "wo_existstest000001" });
    assert.equal(store.exists("wo_existstest000001"), false);
    store.save(workOrder);
    assert.equal(store.exists("wo_existstest000001"), true);
  }));

test("list() returns [] for an empty store, and safe summaries ordered chronologically otherwise", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.deepEqual(store.list(), []);

    store.save(buildWorkOrder({ title: "second" }, { idGenerator: () => "wo_second000000002", now: () => "2026-08-02T00:00:00.000Z" }));
    store.save(buildWorkOrder({ title: "first" }, { idGenerator: () => "wo_first0000000001", now: () => "2026-08-01T00:00:00.000Z" }));

    const summaries = store.list();
    assert.deepEqual(
      summaries.map((s) => s.work_order_id),
      ["wo_first0000000001", "wo_second000000002"]
    );
    assert.deepEqual(Object.keys(summaries[0]).sort(), ["approved_at", "created_at", "milestone", "priority", "status", "title", "work_order_id"].sort());
  }));

test("list() throws CorruptedEngineeringWorkOrderError naming the specific corrupted identifier", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: dir });
    adapter.write("wo_corrupted0000001", "{ not valid json");
    const store = createEngineeringWorkOrderStore({ adapter });
    assert.throws(
      () => store.list(),
      (error) => {
        assert.ok(error instanceof CorruptedEngineeringWorkOrderError);
        assert.equal(error.identifier, "wo_corrupted0000001");
        return true;
      }
    );
  }));

test("list() returns a deep-frozen array", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildWorkOrder());
    assert.throws(() => store.list().push({}), TypeError);
  }));

// Covers both the domain store and its local-json adapter together
// (no separate adapter test file — this milestone is a lean extension
// point, per its own brief, not a new business capability).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBridgeTransportStore } from "../../src/bridge-transport-store.mjs";
import { createLocalJsonBridgeTransportStoreAdapter } from "../../src/local-json-bridge-transport-store-adapter.mjs";
import { createBridgeTransportRecord } from "../../src/bridge-transport-record.mjs";
import {
  InvalidBridgeTransportStoreAdapterError,
  InvalidBridgeTransportRecordIdentifierError,
  BridgeTransportRecordAlreadyExistsError,
  BridgeTransportRecordNotFoundError,
  CorruptedBridgeTransportRecordError,
} from "../../src/bridge-transport-errors.mjs";

const VALID_CHECKSUM = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-bridge-transport-store-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir }) });
}

function buildRecord(overrides = {}, options = {}) {
  return createBridgeTransportRecord(
    {
      objectType: "engineering_work_order",
      objectId: "wo_storetest00000001",
      transportType: "mock",
      status: "delivered",
      source: "engineering-work-order-store",
      destination: "/tmp/outgoing/wo_storetest00000001.json",
      checksum: VALID_CHECKSUM,
      ...overrides,
    },
    options
  );
}

// --- adapter-level behavior (atomic writes, empty store) -------------------

test("adapter: write() creates storageDir, no leftover temp files, list() empty for a never-created dir", () =>
  withTempDir((dir) => {
    const storageDir = path.join(dir, "nested", "bridge");
    const adapter = createLocalJsonBridgeTransportStoreAdapter({ storageDir });
    assert.deepEqual(adapter.list(), []);
    adapter.write("bt_test0000000001", '{"transport_record_id":"bt_test0000000001"}');
    assert.ok(existsSync(storageDir));
    assert.deepEqual(adapter.list(), ["bt_test0000000001"]);
  }));

// --- adapter validation ------------------------------------------------

test("throws InvalidBridgeTransportStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createBridgeTransportStore({ adapter: { name: "x" } }), InvalidBridgeTransportStoreAdapterError);
});

// --- save() / get() / exists() ---------------------------------------------

test("save() persists a valid record and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const record = buildRecord({}, { idGenerator: () => "bt_savetest0000001" });
    const saved = store.save(record);
    assert.equal(saved.transport_record_id, "bt_savetest0000001");
    assert.throws(() => {
      saved.status = "pending";
    }, TypeError);
  }));

test("save() rejects a second save for the same transport_record_id — never overwrites", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "bt_duplicatetest001";
    store.save(buildRecord({}, { idGenerator: idGen }));
    assert.throws(() => store.save(buildRecord({}, { idGenerator: idGen })), BridgeTransportRecordAlreadyExistsError);
  }));

test("get() retrieves a stored, immutable record; throws for missing/invalid/path-traversal identifiers", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const record = buildRecord({}, { idGenerator: () => "bt_gettest00000001" });
    store.save(record);
    const fetched = store.get("bt_gettest00000001");
    assert.equal(fetched.object_id, "wo_storetest00000001");
    assert.throws(() => store.get("bt_doesnotexist0001"), BridgeTransportRecordNotFoundError);
    assert.throws(() => store.get("../../etc/passwd"), InvalidBridgeTransportRecordIdentifierError);
  }));

test("exists() reflects save() and is false for an unknown identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.equal(store.exists("bt_existstest000001"), false);
    store.save(buildRecord({}, { idGenerator: () => "bt_existstest000001" }));
    assert.equal(store.exists("bt_existstest000001"), true);
  }));

// --- list() --------------------------------------------------------------

test("list() returns [] for an empty store, and safe summaries ordered chronologically otherwise", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.deepEqual(store.list(), []);

    store.save(buildRecord({}, { idGenerator: () => "bt_second000000002", now: () => "2026-08-02T00:00:00.000Z" }));
    store.save(buildRecord({}, { idGenerator: () => "bt_first0000000001", now: () => "2026-08-01T00:00:00.000Z" }));

    const summaries = store.list();
    assert.deepEqual(
      summaries.map((s) => s.transport_record_id),
      ["bt_first0000000001", "bt_second000000002"]
    );
  }));

test("list() throws CorruptedBridgeTransportRecordError naming the specific corrupted identifier", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonBridgeTransportStoreAdapter({ storageDir: dir });
    adapter.write("bt_corrupted0000001", "{ not valid json");
    const store = createBridgeTransportStore({ adapter });
    assert.throws(
      () => store.list(),
      (error) => {
        assert.ok(error instanceof CorruptedBridgeTransportRecordError);
        assert.equal(error.identifier, "bt_corrupted0000001");
        return true;
      }
    );
  }));

test("list() returns a deep-frozen array", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord());
    assert.throws(() => store.list().push({}), TypeError);
  }));

// --- findByObject() ----------------------------------------------------

test("findByObject() returns every full record matching the given object_id, ordered chronologically, [] when none match", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const early = buildRecord({ objectId: "wo_target000000001" }, { idGenerator: () => "bt_a00000000000001", now: () => "2026-08-01T00:00:00.000Z" });
    const late = buildRecord(
      { objectId: "wo_target000000001", status: "rejected" },
      { idGenerator: () => "bt_b00000000000002", now: () => "2026-08-05T00:00:00.000Z" }
    );
    const other = buildRecord({ objectId: "wo_other0000000002" }, { idGenerator: () => "bt_c00000000000003" });
    store.save(late); // saved out of order — must still come back sorted
    store.save(early);
    store.save(other);

    const results = store.findByObject("wo_target000000001");
    assert.deepEqual(results.map((r) => r.transport_record_id), ["bt_a00000000000001", "bt_b00000000000002"]);
    assert.deepEqual(store.findByObject("wo_nomatch0000000001"), []);
  }));

test("findByObject() returns full, deep-frozen records, not summaries", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const record = buildRecord({}, { idGenerator: () => "bt_fulltest0000001" });
    store.save(record);
    const [found] = store.findByObject(record.object_id);
    assert.equal(found.checksum, VALID_CHECKSUM);
    assert.throws(() => {
      found.status = "pending";
    }, TypeError);
  }));

test("historical records are never overwritten — rejected and delivered records for the same object both persist", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ status: "rejected" }, { idGenerator: () => "bt_history0000001", now: () => "2026-08-01T00:00:00.000Z" }));
    store.save(buildRecord({ status: "delivered" }, { idGenerator: () => "bt_history0000002", now: () => "2026-08-02T00:00:00.000Z" }));
    const history = store.findByObject("wo_storetest00000001");
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((r) => r.status), ["rejected", "delivered"]);
  }));

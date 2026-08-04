import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProductionMetricsStore } from "../../src/production-metrics-store.mjs";
import { createLocalJsonProductionMetricsStoreAdapter } from "../../src/local-json-production-metrics-store-adapter.mjs";
import { createProductionMetrics } from "../../src/production-metrics.mjs";
import {
  InvalidMetricsStoreAdapterError,
  InvalidMetricsIdentifierError,
  MetricsRecordAlreadyExistsError,
  MetricsRecordNotFoundError,
  CorruptedMetricsRecordError,
} from "../../src/production-metrics-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-metrics-store-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createProductionMetricsStore({ adapter: createLocalJsonProductionMetricsStoreAdapter({ storageDir }) });
}

function buildRecord(overrides = {}) {
  return createProductionMetrics(
    {
      requestId: "req_01J9STORETEST0001",
      executionId: "exec_20260804_deadbeefcafe",
      carouselContentId: "cc_storetest0001",
      carouselId: "car_storetest0001",
      status: "completed",
      requests: { anthropic: 1, templated: 6, googleDrive: 0 },
      durationsMs: { generation: null, render: 20570, export: null, publish: null, total: 33734 },
      outputs: { slidesGenerated: 6, slidesRendered: 6, filesExported: 7, filesPublished: 0 },
      costs: {
        currency: "USD",
        anthropic: { amount: 0.02, calculationType: "estimated" },
        templated: { amount: 0.3, calculationType: "estimated" },
        googleDrive: { amount: 0, calculationType: "unavailable" },
        total: 0.32,
      },
      ...overrides,
    },
    { idGenerator: overrides.idGenerator }
  );
}

// --- Adapter validation --------------------------------------------------

test("throws InvalidMetricsStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createProductionMetricsStore({ adapter: { name: "x" } }), InvalidMetricsStoreAdapterError);
});

// --- save() ----------------------------------------------------------

test("save() persists a valid record and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const record = buildRecord();
    const saved = store.save(record);
    assert.equal(saved.metrics_id, record.metrics_id);
    assert.throws(() => {
      saved.status = "failed";
    }, TypeError);
  }));

test("save() does not mutate the supplied object", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const record = buildRecord();
    const before = JSON.stringify(record);
    store.save(record);
    assert.equal(JSON.stringify(record), before);
  }));

test("save() rejects a second save for the same metrics_id", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "met_duplicatetest0001";
    const first = createProductionMetrics(recordFields(), { idGenerator: idGen });
    store.save(first);
    const second = createProductionMetrics(recordFields(), { idGenerator: idGen });
    assert.throws(() => store.save(second), MetricsRecordAlreadyExistsError);
  }));

function recordFields() {
  return {
    requestId: "req_01J9STORETEST0002",
    executionId: "exec_20260804_deadbeefcafe",
    carouselContentId: "cc_storetest0002",
    carouselId: "car_storetest0002",
    status: "completed",
    requests: { anthropic: 1, templated: 6, googleDrive: 0 },
    durationsMs: { generation: null, render: 20570, export: null, publish: null, total: 33734 },
    outputs: { slidesGenerated: 6, slidesRendered: 6, filesExported: 7, filesPublished: 0 },
    costs: {
      currency: "USD",
      anthropic: { amount: 0.02, calculationType: "estimated" },
      templated: { amount: 0.3, calculationType: "estimated" },
      googleDrive: { amount: 0, calculationType: "unavailable" },
      total: 0.32,
    },
  };
}

test("save() rejects a schema-invalid record", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.throws(() => store.save({ metrics_id: "met_invalid", not: "a valid record" }), CorruptedMetricsRecordError);
  }));

// --- get() -------------------------------------------------------------

test("get() retrieves a stored record, parsed, validated, and immutable", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const record = buildRecord();
    store.save(record);
    const fetched = store.get(record.metrics_id);
    assert.equal(fetched.metrics_id, record.metrics_id);
    assert.throws(() => {
      fetched.status = "failed";
    }, TypeError);
  }));

test("get() throws MetricsRecordNotFoundError for an identifier with no stored record", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.throws(() => store.get("met_doesnotexist00001"), MetricsRecordNotFoundError);
  }));

test("get() throws InvalidMetricsIdentifierError for a path-traversal identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.throws(() => store.get("../../etc/passwd"), InvalidMetricsIdentifierError);
  }));

// --- exists() ----------------------------------------------------------

test("exists() reflects save() and is false for an unknown identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const record = buildRecord();
    assert.equal(store.exists(record.metrics_id), false);
    store.save(record);
    assert.equal(store.exists(record.metrics_id), true);
  }));

// --- list() ------------------------------------------------------------

test("list() returns an empty array for an empty store", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.deepEqual(store.list(), []);
  }));

test("list() returns safe summaries ordered deterministically by metrics_id ascending", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const a = createProductionMetrics(recordFields(), { idGenerator: () => "met_bbbb" });
    const b = createProductionMetrics(recordFields(), { idGenerator: () => "met_aaaa" });
    store.save(a);
    store.save(b);
    const summaries = store.list();
    assert.deepEqual(
      summaries.map((s) => s.metrics_id),
      ["met_aaaa", "met_bbbb"]
    );
    assert.deepEqual(
      Object.keys(summaries[0]).sort(),
      ["metrics_id", "request_id", "execution_id", "carousel_id", "status", "recorded_at", "total_cost", "currency"].sort()
    );
  }));

test("list() throws CorruptedMetricsRecordError naming the specific identifier that is corrupted", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonProductionMetricsStoreAdapter({ storageDir: dir });
    adapter.write("met_corrupted0001", "{ not valid json");
    const store = createProductionMetricsStore({ adapter });
    assert.throws(() => store.list(), (error) => {
      assert.ok(error instanceof CorruptedMetricsRecordError);
      assert.equal(error.identifier, "met_corrupted0001");
      return true;
    });
  }));

test("list() returns a deep-frozen array", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord());
    const summaries = store.list();
    assert.throws(() => summaries.push({}), TypeError);
  }));

// --- findByExecutionId() ------------------------------------------------

test("findByExecutionId() returns every full record matching the given execution_id", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const match1 = createProductionMetrics({ ...recordFields(), executionId: "exec_20260804_target00001" }, { idGenerator: () => "met_match0001" });
    const match2 = createProductionMetrics({ ...recordFields(), executionId: "exec_20260804_target00001" }, { idGenerator: () => "met_match0002" });
    const nonMatch = createProductionMetrics({ ...recordFields(), executionId: "exec_20260804_other000001" }, { idGenerator: () => "met_nomatch001" });
    store.save(match1);
    store.save(match2);
    store.save(nonMatch);

    const results = store.findByExecutionId("exec_20260804_target00001");
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((r) => r.metrics_id),
      ["met_match0001", "met_match0002"]
    );
  }));

test("findByExecutionId() returns an empty array, not an error, when nothing matches", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord());
    assert.deepEqual(store.findByExecutionId("exec_20260804_nomatch0001"), []);
  }));

test("findByExecutionId() returns full, deep-frozen records, not summaries", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const record = buildRecord();
    store.save(record);
    const [found] = store.findByExecutionId(record.execution_id);
    assert.equal(found.requests.templated, 6);
    assert.throws(() => {
      found.status = "failed";
    }, TypeError);
  }));

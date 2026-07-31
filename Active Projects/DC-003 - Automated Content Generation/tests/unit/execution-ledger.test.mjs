import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionLedger } from "../../src/execution-ledger.mjs";
import {
  InvalidLedgerStoreError,
  DuplicateSequenceError,
  ExecutionNotFoundError,
} from "../../src/execution-ledger-errors.mjs";

const FIXED_CLOCK = () => "2026-08-01T00:00:00.000Z";
let idCounter = 0;
function makeIdGenerator() {
  idCounter = 0;
  return () => `rec_test${String(++idCounter).padStart(4, "0")}`;
}

// A minimal, faithful in-memory Ledger Store — exercises execution-ledger.mjs
// against the documented { name, append, readAll } shape without touching
// the filesystem.
function createInMemoryStore() {
  const records = [];
  return {
    name: "in-memory-test-store",
    append(record) {
      records.push(record);
    },
    readAll() {
      return [...records];
    },
  };
}

function baseFields(overrides = {}) {
  return {
    execution_id: "exec_20260801_9f3a2e1c8b4d",
    sequence: 1,
    event_type: "execution.started",
    status: "started",
    ...overrides,
  };
}

test("throws InvalidLedgerStoreError for a store missing required methods", () => {
  assert.throws(() => createExecutionLedger({ store: {} }), InvalidLedgerStoreError);
  assert.throws(() => createExecutionLedger({ store: { name: "x" } }), InvalidLedgerStoreError);
  assert.throws(() => createExecutionLedger({ store: null }), InvalidLedgerStoreError);
});

test("appendRecord accepts increasing sequences for the same execution", () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const idGenerator = makeIdGenerator();

  ledger.appendRecord(baseFields({ sequence: 1 }), { clock: FIXED_CLOCK, idGenerator });
  ledger.appendRecord(baseFields({ sequence: 2, event_type: "topic.loaded" }), { clock: FIXED_CLOCK, idGenerator });
  const third = ledger.appendRecord(
    baseFields({ sequence: 3, event_type: "execution.completed", status: "succeeded" }),
    { clock: FIXED_CLOCK, idGenerator }
  );

  assert.equal(third.sequence, 3);
  assert.equal(ledger.readAll().length, 3);
});

test("appendRecord rejects an exact duplicate sequence", () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const idGenerator = makeIdGenerator();

  ledger.appendRecord(baseFields({ sequence: 1 }), { clock: FIXED_CLOCK, idGenerator });
  assert.throws(
    () => ledger.appendRecord(baseFields({ sequence: 1, event_type: "topic.loaded" }), { clock: FIXED_CLOCK, idGenerator }),
    DuplicateSequenceError
  );
});

test("appendRecord rejects a lower (non-monotonic) sequence, not just an exact duplicate", () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const idGenerator = makeIdGenerator();

  ledger.appendRecord(baseFields({ sequence: 5 }), { clock: FIXED_CLOCK, idGenerator });
  assert.throws(
    () => ledger.appendRecord(baseFields({ sequence: 3, event_type: "topic.loaded" }), { clock: FIXED_CLOCK, idGenerator }),
    DuplicateSequenceError
  );
});

test("sequence uniqueness is scoped per execution_id — the same sequence number is fine across different executions", () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const idGenerator = makeIdGenerator();

  ledger.appendRecord(baseFields({ execution_id: "exec_20260801_aaaaaaaaaaaa", sequence: 1 }), {
    clock: FIXED_CLOCK,
    idGenerator,
  });
  assert.doesNotThrow(() =>
    ledger.appendRecord(baseFields({ execution_id: "exec_20260801_bbbbbbbbbbbb", sequence: 1 }), {
      clock: FIXED_CLOCK,
      idGenerator,
    })
  );
});

test("readAll returns a deep-frozen snapshot", () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  ledger.appendRecord(baseFields(), { clock: FIXED_CLOCK, idGenerator: makeIdGenerator() });

  const records = ledger.readAll();
  assert.throws(() => {
    records[0].status = "tampered";
  }, TypeError);
  assert.throws(() => {
    records.push({});
  }, TypeError);
});

test("reconstructExecution groups by execution_id and orders by sequence, ignoring other executions", () => {
  // Populates the underlying store directly with records already in
  // storage order 1, 3, 2 (bypassing ledger.appendRecord's own monotonic
  // enforcement) — reconstructExecution's sort must not simply trust
  // whatever order the store happens to return records in.
  const store = createInMemoryStore();
  const EXEC_A = "exec_20260801_aaaaaaaaaaaa";
  const EXEC_B = "exec_20260801_bbbbbbbbbbbb";

  store.append({ execution_id: EXEC_A, sequence: 1, event_type: "execution.started", status: "started", record_id: "rec_1", occurred_at: "2026-08-01T00:00:00.000Z" });
  store.append({ execution_id: EXEC_B, sequence: 1, event_type: "execution.started", status: "started", record_id: "rec_2", occurred_at: "2026-08-01T00:00:00.000Z" });
  store.append({ execution_id: EXEC_A, sequence: 3, event_type: "execution.completed", status: "succeeded", record_id: "rec_3", occurred_at: "2026-08-01T00:00:02.000Z" });
  store.append({ execution_id: EXEC_A, sequence: 2, event_type: "topic.loaded", status: "succeeded", record_id: "rec_4", occurred_at: "2026-08-01T00:00:01.000Z" });

  const ledger = createExecutionLedger({ store });
  const execution = ledger.reconstructExecution(EXEC_A);
  assert.equal(execution.recordCount, 3);
  assert.deepEqual(
    execution.records.map((r) => r.sequence),
    [1, 2, 3]
  );
  assert.equal(execution.finalStatus, "succeeded");
});

test("reconstructExecution throws ExecutionNotFoundError for an unknown execution_id", () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  ledger.appendRecord(baseFields({ execution_id: "exec_20260801_aaaaaaaaaaaa" }), {
    clock: FIXED_CLOCK,
    idGenerator: makeIdGenerator(),
  });
  assert.throws(() => ledger.reconstructExecution("exec_20260801_zzzzzzzzzzzz"), ExecutionNotFoundError);
});

test("reconstructExecution's returned summary is deep-frozen", () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  ledger.appendRecord(baseFields(), { clock: FIXED_CLOCK, idGenerator: makeIdGenerator() });

  const execution = ledger.reconstructExecution("exec_20260801_9f3a2e1c8b4d");
  assert.throws(() => {
    execution.finalStatus = "tampered";
  }, TypeError);
  assert.throws(() => {
    execution.records[0].status = "tampered";
  }, TypeError);
});

test("clock and idGenerator are injected through to the underlying ExecutionRecord for determinism", () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const record = ledger.appendRecord(baseFields(), { clock: FIXED_CLOCK, idGenerator: () => "rec_deterministic" });
  assert.equal(record.record_id, "rec_deterministic");
  assert.equal(record.occurred_at, "2026-08-01T00:00:00.000Z");
});

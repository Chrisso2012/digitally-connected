// DC-003-I008 — ExecutionLedger: the authoritative, append-only domain
// model over a Ledger Store. "The ledger itself is not mutable" is
// satisfied literally: createExecutionLedger() returns a plain object with
// no internal mutable state of its own at all — every method is a pure
// function of its arguments plus whatever the injected store currently
// holds. Appending changes the STORE (necessarily, since persistence is
// external), never this wrapper; every value handed back to a caller
// (a single ExecutionRecord, a snapshot array, a reconstructed execution)
// is deep-frozen.
//
// This module knows nothing about files — only the Ledger Store shape
// (execution-ledger-store.mjs). No orchestration logic lives here: it
// records events, it does not decide what should happen next, retry
// anything, or call the renderer/generator/mapper. That's explicitly
// DC-003-I009's job.
//
// Failure behavior: appendRecord() always throws on any failure (a
// malformed record, a non-monotonic sequence, or a store I/O error) —
// there is no silent-failure mode here for any event type, "critical" or
// not. The DC-003-I008 brief distinguishes "critical" records
// (execution.started/completed/failed, which must never silently fail)
// from "stage-level" records (which "may return structured write errors"),
// but also explicitly defers "the exact orchestration behaviour" to
// DC-003-I009. Building two different failure modes into this milestone
// would be guessing at a policy that isn't this milestone's to set — a
// future orchestrator can wrap appendRecord() in its own try/catch and
// decide per event type whether a failure is fatal to the whole execution.
// What DC-003-I008 guarantees is narrower and unconditional: nothing is
// ever swallowed.

import { createExecutionRecord } from "./execution-record.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidLedgerStore } from "./execution-ledger-store.mjs";
import { DuplicateSequenceError, ExecutionNotFoundError } from "./execution-ledger-errors.mjs";

/**
 * Builds an ExecutionLedger over the given Ledger Store.
 *
 * fields.store — required, must satisfy the Ledger Store shape (see
 *   execution-ledger-store.mjs); checked immediately via
 *   assertValidLedgerStore().
 *
 * options.validator — inject a pre-built validator, passed through to
 *   every createExecutionRecord() call this ledger makes.
 *
 * Returns { appendRecord, readAll, reconstructExecution }.
 */
export function createExecutionLedger({ store }, options = {}) {
  assertValidLedgerStore(store);

  /**
   * Validates and appends one ExecutionRecord.
   *
   * recordFields — passed straight through to createExecutionRecord()
   *   (snake_case fields matching execution-record.schema.json).
   * recordOptions — { clock, idGenerator } passed straight through to
   *   createExecutionRecord() for deterministic tests.
   *
   * Throws ExecutionRecordValidationError if the record itself is
   * malformed. Throws DuplicateSequenceError if `sequence` is not strictly
   * greater than the highest existing sequence already stored for the
   * same execution_id — the one check only the ledger (not a single
   * record) can perform, since it alone can see prior records. Returns
   * the newly-appended, immutable ExecutionRecord.
   */
  function appendRecord(recordFields, recordOptions = {}) {
    const record = createExecutionRecord(recordFields, { ...recordOptions, validator: options.validator });

    const maxExistingSequence = store
      .readAll()
      .filter((r) => r.execution_id === record.execution_id)
      .reduce((max, r) => Math.max(max, r.sequence), 0);

    if (record.sequence <= maxExistingSequence) {
      throw new DuplicateSequenceError(record.execution_id, record.sequence, maxExistingSequence);
    }

    store.append(record);
    return record;
  }

  /**
   * Returns every record currently in the store, deep-frozen, in storage
   * order. Records are trusted as already-valid on read: the only writer
   * this ledger recognizes is appendRecord() above, which validates before
   * ever calling store.append().
   */
  function readAll() {
    return deepFreezeClone(store.readAll());
  }

  /**
   * Reconstructs one execution's history: every record for `executionId`,
   * ordered by sequence ascending, plus a small summary. Pure grouping and
   * ordering only — no orchestration logic, no decision-making about what
   * the execution's outcome "should" be beyond reporting its last record's
   * own status.
   *
   * Throws ExecutionNotFoundError if no records exist for `executionId`.
   */
  function reconstructExecution(executionId) {
    const records = store
      .readAll()
      .filter((r) => r.execution_id === executionId)
      .sort((a, b) => a.sequence - b.sequence);

    if (records.length === 0) {
      throw new ExecutionNotFoundError(executionId);
    }

    return deepFreezeClone({
      executionId,
      recordCount: records.length,
      firstEventAt: records[0].occurred_at,
      lastEventAt: records[records.length - 1].occurred_at,
      finalStatus: records[records.length - 1].status,
      records,
    });
  }

  return { appendRecord, readAll, reconstructExecution };
}

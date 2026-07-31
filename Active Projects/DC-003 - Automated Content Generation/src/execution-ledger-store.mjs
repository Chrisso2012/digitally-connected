// DC-003-I008 — Ledger Store abstraction.
//
// The domain layer (execution-ledger.mjs) must know nothing about files —
// or any other storage mechanism. A Ledger Store is any object shaped:
//
//   { name: string, append(record): void, readAll(): object[] }
//
// `append` takes one already-validated ExecutionRecord (produced by
// execution-record.mjs — the store never validates, it only persists) and
// durably adds it. `readAll` returns every record currently stored, in
// storage order, as plain objects (not necessarily re-validated or
// re-frozen — execution-ledger.mjs owns that).
//
// This mirrors DC-003-I006's transport abstraction exactly: no implicit
// default, no base class — just a documented shape plus a runtime guard
// (assertValidLedgerStore) so a caller passing something malformed fails
// fast with a clear error instead of a confusing later crash. A future
// store (SQLite, Postgres, cloud storage, an event store) plugs in by
// implementing this same shape — no changes to execution-ledger.mjs.
//
// jsonl-ledger-store.mjs is the one implementation this milestone ships.

import { InvalidLedgerStoreError } from "./execution-ledger-errors.mjs";

/**
 * Throws InvalidLedgerStoreError if `store` doesn't implement the Ledger
 * Store shape. Used by createExecutionLedger() so a malformed store is
 * caught immediately, not at the first append/read call.
 */
export function assertValidLedgerStore(store) {
  if (
    !store ||
    typeof store.name !== "string" ||
    typeof store.append !== "function" ||
    typeof store.readAll !== "function"
  ) {
    throw new InvalidLedgerStoreError();
  }
}

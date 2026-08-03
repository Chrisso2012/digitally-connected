// DC-003-I015 — Finished Carousel Storage Adapter abstraction.
//
// The domain layer (finished-carousel-store.mjs) must know nothing about
// files — or any other storage mechanism. A Storage Adapter is any object
// shaped:
//
//   { name: string,
//     write(identifier, content): void,
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }
//
// `write`/`read` operate on already-serialized JSON strings — the adapter
// never parses, validates, or interprets carousel content; that stays
// entirely in the domain layer, exactly as jsonl-ledger-store.mjs (DC-003-
// I008) never validates an ExecutionRecord, only persists it. `list()`
// returns raw stored identifiers (no summaries, no parsing) — turning
// those into safe summaries is the domain layer's job too.
//
// This mirrors execution-ledger-store.mjs exactly: no implicit default,
// no base class, just a documented shape plus a runtime guard
// (assertValidCarouselStoreAdapter) so a malformed adapter fails fast with
// a clear error instead of a confusing later crash. A future adapter
// (SQLite, cloud storage) plugs in by implementing this same shape — no
// changes to finished-carousel-store.mjs.
//
// Identifier safety (path traversal, arbitrary paths) is deliberately NOT
// this adapter's concern — every real caller reaches storage through
// finished-carousel-store.mjs, which validates the identifier shape
// before ever calling into an adapter, the same division of
// responsibility every other store/adapter pair in this codebase already
// uses (validation lives in the domain layer, never the storage layer).
//
// local-json-carousel-store-adapter.mjs is the one implementation this
// milestone ships.

import { InvalidCarouselStoreAdapterError } from "./finished-carousel-store-errors.mjs";

/**
 * Throws InvalidCarouselStoreAdapterError if `adapter` doesn't implement
 * the Storage Adapter shape. Used by createFinishedCarouselStore() so a
 * malformed adapter is caught immediately, not at the first save/get call.
 */
export function assertValidCarouselStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidCarouselStoreAdapterError();
  }
}

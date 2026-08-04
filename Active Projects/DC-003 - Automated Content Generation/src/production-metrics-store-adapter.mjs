// DC-003-I023 — Production Metrics Storage Adapter abstraction.
//
// The domain layer (production-metrics-store.mjs) must know nothing about
// files — or any other storage mechanism. A Storage Adapter is any object
// shaped:
//
//   { name: string,
//     write(identifier, content): void,
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }
//
// Identical shape to finished-carousel-store-adapter.mjs (I015) —
// deliberately reused verbatim rather than inventing a parallel
// abstraction, per the I023 brief's own "Implement persistent local JSON
// storage using the same separation used by I015" instruction. I015's own
// files are not imported or modified here — this is a genuinely separate
// store for a genuinely separate domain object, just built from the same
// proven shape.
//
// local-json-production-metrics-store-adapter.mjs is the one
// implementation this milestone ships.

import { InvalidMetricsStoreAdapterError } from "./production-metrics-errors.mjs";

/**
 * Throws InvalidMetricsStoreAdapterError if `adapter` doesn't implement
 * the Storage Adapter shape. Used by createProductionMetricsStore() so a
 * malformed adapter is caught immediately, not at the first save/get call.
 */
export function assertValidMetricsStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidMetricsStoreAdapterError();
  }
}

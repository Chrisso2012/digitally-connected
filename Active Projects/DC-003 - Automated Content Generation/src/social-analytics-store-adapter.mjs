// DC-003-I028 — Social Analytics Storage Adapter abstraction.
//
// The domain layer (social-analytics-store.mjs) must know nothing about
// files or any other storage mechanism. A Storage Adapter is any object
// shaped:
//
//   { name: string,
//     write(identifier, content): void,
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }
//
// Identical shape to production-metrics-store-adapter.mjs (I023) /
// publisher-result-store-adapter.mjs (I025) — reused verbatim rather than
// inventing a parallel abstraction, per this milestone's own brief
// ("Recommended: use the I015/I023/I025 separation pattern").
//
// local-json-social-analytics-store-adapter.mjs is the one implementation
// this milestone ships.

import { InvalidSocialAnalyticsStoreAdapterError } from "./social-analytics-errors.mjs";

/**
 * Throws InvalidSocialAnalyticsStoreAdapterError if `adapter` doesn't
 * implement the Storage Adapter shape. Used by createSocialAnalyticsStore()
 * so a malformed adapter is caught immediately, not at the first call.
 */
export function assertValidSocialAnalyticsStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidSocialAnalyticsStoreAdapterError();
  }
}

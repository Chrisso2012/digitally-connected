// DC-003-I029 — Engineering Work Order Storage Adapter abstraction.
// Identical shape to every other Storage Adapter in this codebase
// (production-metrics-store-adapter.mjs, publisher-result-store-adapter.mjs,
// social-analytics-store-adapter.mjs):
//
//   { name: string,
//     write(identifier, content): void,
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }

import { InvalidEngineeringWorkOrderStoreAdapterError } from "./engineering-work-order-errors.mjs";

export function assertValidEngineeringWorkOrderStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidEngineeringWorkOrderStoreAdapterError();
  }
}

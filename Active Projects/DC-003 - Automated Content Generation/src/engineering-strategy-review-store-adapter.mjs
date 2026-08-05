// DC-003-I029.3 — Engineering Strategy Review Storage Adapter abstraction.
// Identical shape to every other Storage Adapter in this codebase:
//
//   { name: string,
//     write(identifier, content): void,
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }

import { InvalidEngineeringStrategyReviewStoreAdapterError } from "./engineering-strategy-review-errors.mjs";

export function assertValidEngineeringStrategyReviewStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidEngineeringStrategyReviewStoreAdapterError();
  }
}

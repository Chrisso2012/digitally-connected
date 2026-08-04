// DC-003-I025 — Publisher Result Storage Adapter abstraction. The domain
// layer (publisher-result-store.mjs) must know nothing about files, S3,
// or any other storage mechanism — only this shape. Mirrors
// production-metrics-store-adapter.mjs exactly:
//
//   { name: string,
//     write(identifier, content),
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }

import { InvalidPublisherResultStoreAdapterError } from "./publisher-result-errors.mjs";

/**
 * Throws InvalidPublisherResultStoreAdapterError if `adapter` doesn't
 * implement the Publisher Result Storage Adapter shape.
 */
export function assertValidPublisherResultStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidPublisherResultStoreAdapterError();
  }
}

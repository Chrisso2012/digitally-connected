// DC-003-I030 — Storage Adapter contract for the Ingested Content Store.
// Byte-for-byte mirror of engineering-work-order-store-adapter.mjs — a
// shape check, not a base class.
//
//   { name: string,
//     write(identifier, content),
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }

import { InvalidIngestedContentStoreAdapterError } from "./ingested-content-errors.mjs";

export function assertValidIngestedContentStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidIngestedContentStoreAdapterError();
  }
}

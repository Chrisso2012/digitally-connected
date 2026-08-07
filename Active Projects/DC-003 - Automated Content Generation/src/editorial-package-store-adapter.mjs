// DC-003-I031 — Storage Adapter contract for the Editorial Package Store.
// Byte-for-byte mirror of ingested-content-store-adapter.mjs — a shape
// check, not a base class.
//
//   { name: string,
//     write(identifier, content),
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }

import { InvalidEditorialPackageStoreAdapterError } from "./editorial-package-errors.mjs";

export function assertValidEditorialPackageStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidEditorialPackageStoreAdapterError();
  }
}

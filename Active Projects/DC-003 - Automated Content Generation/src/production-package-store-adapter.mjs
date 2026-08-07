// DC-003-I033 — Storage Adapter contract for the Production Package
// Store. Byte-for-byte mirror of social-media-package-store-adapter.mjs
// — a shape check, not a base class.
//
//   { name: string,
//     write(identifier, content),
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }

import { InvalidProductionPackageStoreAdapterError } from "./production-package-errors.mjs";

export function assertValidProductionPackageStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidProductionPackageStoreAdapterError();
  }
}

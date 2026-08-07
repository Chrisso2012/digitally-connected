// DC-003-I032 — Storage Adapter contract for the Social Media Package
// Store. Byte-for-byte mirror of editorial-package-store-adapter.mjs — a
// shape check, not a base class.
//
//   { name: string,
//     write(identifier, content),
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }

import { InvalidSocialMediaPackageStoreAdapterError } from "./social-media-package-errors.mjs";

export function assertValidSocialMediaPackageStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidSocialMediaPackageStoreAdapterError();
  }
}

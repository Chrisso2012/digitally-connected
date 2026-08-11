// DC-003-I032.10.1 — Storage Adapter contract for the Carousel Content
// Package Store. Byte-for-byte mirror of editorial-package-store-adapter.mjs
// — a shape check, not a base class.
//
//   { name: string,
//     write(identifier, content),
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }

import { InvalidCarouselContentPackageStoreAdapterError } from "./carousel-content-package-errors.mjs";

export function assertValidCarouselContentPackageStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidCarouselContentPackageStoreAdapterError();
  }
}

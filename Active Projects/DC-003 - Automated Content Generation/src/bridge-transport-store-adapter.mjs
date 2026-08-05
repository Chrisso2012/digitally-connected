// DC-003-I029.1 — Bridge Transport Storage Adapter abstraction. Identical
// shape to every other Storage Adapter in this codebase:
//
//   { name: string,
//     write(identifier, content): void,
//     read(identifier): string,
//     list(): string[],
//     exists(identifier): boolean }

import { InvalidBridgeTransportStoreAdapterError } from "./bridge-transport-errors.mjs";

export function assertValidBridgeTransportStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidBridgeTransportStoreAdapterError();
  }
}

// DC-003-I029 — Engineering Delivery Report Storage Adapter abstraction.
// Mirrors engineering-work-order-store-adapter.mjs exactly.

import { InvalidEngineeringDeliveryReportStoreAdapterError } from "./engineering-delivery-report-errors.mjs";

export function assertValidEngineeringDeliveryReportStoreAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.write !== "function" ||
    typeof adapter.read !== "function" ||
    typeof adapter.list !== "function" ||
    typeof adapter.exists !== "function"
  ) {
    throw new InvalidEngineeringDeliveryReportStoreAdapterError();
  }
}

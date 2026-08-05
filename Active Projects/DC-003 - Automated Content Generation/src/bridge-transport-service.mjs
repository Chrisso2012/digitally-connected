// DC-003-I029.1 — Bridge Transport Service: the only module that moves an
// Engineering Work Order out or an Engineering Delivery Report in, and
// records what happened. "Transport is intentionally dumb" (this
// milestone's own brief) — no approvals, no engineering decisions, no
// prompt generation, no interpretation of intent. Neither Engineering
// Store is ever mutated except the one legitimate write import performs
// (persisting an already-valid, already-approved-elsewhere Delivery
// Report into its own permanent store) — the Work Order Store is only
// ever read.
//
// Checksums are computed by THIS SERVICE, from the object it already has
// in hand, not by the transport adapter — this means a checksum is always
// available for a Bridge Transport Record regardless of whether the
// adapter call itself succeeds, so a transport FAILURE can still be
// recorded as real history (a "rejected" record), never silently
// dropped. The one exception: an import payload that fails to even parse
// has no real object_id to record against — no Bridge Transport Record
// is created for that case (mirrors DC-003-I028's own "malformed input
// persists nothing" discipline), and the caller just sees the error.
//
// Transport Adapter shape (see bridge-transport-mock-adapter.mjs for the
// only implementation this milestone ships):
//   { name: string,
//     sendWorkOrder({ workOrder, destinationDir }): Promise<{ destinationPath, checksum }>,
//     receiveDeliveryReport({ sourcePath }): Promise<{ deliveryReport, checksum }> }

import { createHash } from "node:crypto";
import { createBridgeTransportRecord } from "./bridge-transport-record.mjs";
import { createValidator } from "./validator.mjs";
import { DuplicateBridgeTransportError, BridgeTransportCorruptionError } from "./bridge-transport-errors.mjs";

function checksumOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function recordTransport(transportStore, fields, options) {
  const record = createBridgeTransportRecord(fields, options);
  transportStore.save(record);
  return record;
}

/**
 * Exports one Engineering Work Order — reads it (read-only), then hands
 * it to the transport adapter's own sendWorkOrder().
 *
 * fields.workOrderId — required.
 * fields.destinationDir — required, the local directory the mock adapter
 *   writes the exported JSON to (the closest honest thing to an
 *   "Outgoing Queue" this milestone can build — see
 *   bridge-transport-mock-adapter.mjs's own header comment).
 *
 * dependencies.workOrderStore — required, an Engineering Work Order Store
 *   (I029) — never mutated.
 * dependencies.transportStore — required, a Bridge Transport Store.
 * dependencies.adapter — required, a Transport Adapter.
 * dependencies.now / idGenerator / validator / rootDir — forwarded to
 *   createBridgeTransportRecord() unchanged, for deterministic tests.
 *
 * Propagates whatever error workOrderStore.get() itself throws for an
 * unknown ID — no transport record is created for that case (there is no
 * real object to record against). Throws DuplicateBridgeTransportError if
 * this Work Order was already successfully transported outgoing — a
 * "rejected" record is saved first, since the checksum is already known.
 * Throws whatever the adapter itself throws on a genuine transport
 * failure — likewise recorded as "rejected" first.
 */
export async function exportWorkOrder(fields = {}, dependencies = {}) {
  const { workOrderId, destinationDir } = fields;
  const { workOrderStore, transportStore, adapter } = dependencies;
  const transportType = adapter.name;

  const workOrder = workOrderStore.get(workOrderId);
  const checksum = checksumOf(workOrder);
  const source = "engineering-work-order-store";

  const alreadyDelivered = transportStore.findByObject(workOrderId).some((r) => r.status === "delivered" && r.direction === "outgoing");
  if (alreadyDelivered) {
    recordTransport(
      transportStore,
      { objectType: "engineering_work_order", objectId: workOrderId, transportType, status: "rejected", source, destination: destinationDir, checksum },
      dependencies
    );
    throw new DuplicateBridgeTransportError(workOrderId, "outgoing");
  }

  let result;
  try {
    result = await adapter.sendWorkOrder({ workOrder, destinationDir });
  } catch (cause) {
    recordTransport(
      transportStore,
      { objectType: "engineering_work_order", objectId: workOrderId, transportType, status: "rejected", source, destination: destinationDir, checksum, notes: cause.message },
      dependencies
    );
    throw cause;
  }

  if (result.checksum !== checksum) {
    recordTransport(
      transportStore,
      { objectType: "engineering_work_order", objectId: workOrderId, transportType, status: "rejected", source, destination: result.destinationPath, checksum },
      dependencies
    );
    throw new BridgeTransportCorruptionError("the exported payload's checksum did not match the source Work Order");
  }

  const record = recordTransport(
    transportStore,
    { objectType: "engineering_work_order", objectId: workOrderId, transportType, status: "delivered", source, destination: result.destinationPath, checksum },
    dependencies
  );
  return { transportRecordId: record.transport_record_id, workOrderId, destinationPath: result.destinationPath, status: "delivered" };
}

/**
 * Imports one Engineering Delivery Report from a local path, validates
 * it, persists it into the real Engineering Delivery Report Store, and
 * records the transport.
 *
 * fields.sourcePath — required, a local file path the mock adapter reads.
 *
 * dependencies.deliveryReportStore — required, an Engineering Delivery
 *   Report Store (I029).
 * dependencies.transportStore — required, a Bridge Transport Store.
 * dependencies.adapter — required, a Transport Adapter.
 *
 * Propagates whatever the adapter itself throws for an unreadable/corrupt
 * payload — no Bridge Transport Record is created, since there is no
 * trustworthy object_id to record against yet. Throws
 * BridgeTransportCorruptionError if the payload parses as JSON but does
 * not validate against engineering-delivery-report.schema.json — same
 * "no record without a real object_id" rule. Throws
 * DuplicateBridgeTransportError if this Delivery Report already exists in
 * the store — a "rejected" record is saved first.
 */
export async function importDeliveryReport(fields = {}, dependencies = {}) {
  const { sourcePath } = fields;
  const { deliveryReportStore, transportStore, adapter, validator: injectedValidator, rootDir } = dependencies;
  const transportType = adapter.name;
  const validator = injectedValidator ?? createValidator({ rootDir });

  const { deliveryReport, checksum } = await adapter.receiveDeliveryReport({ sourcePath });

  const validation = validator.validate("engineeringDeliveryReport", deliveryReport);
  if (!validation.valid) {
    throw new BridgeTransportCorruptionError(
      `the imported payload does not match engineering-delivery-report.schema.json (${validation.errors.length} error(s))`
    );
  }

  const objectId = deliveryReport.delivery_report_id;
  const source = sourcePath;
  const destination = "engineering-delivery-report-store";

  if (deliveryReportStore.exists(objectId)) {
    recordTransport(
      transportStore,
      { objectType: "engineering_delivery_report", objectId, transportType, status: "rejected", source, destination, checksum },
      dependencies
    );
    throw new DuplicateBridgeTransportError(objectId, "incoming");
  }

  deliveryReportStore.save(deliveryReport);

  const record = recordTransport(
    transportStore,
    { objectType: "engineering_delivery_report", objectId, transportType, status: "delivered", source, destination, checksum },
    dependencies
  );
  return { transportRecordId: record.transport_record_id, deliveryReportId: objectId, status: "delivered" };
}

/**
 * Assembles the Bridge Transport queue purely from repository evidence:
 * pending_exports/pending_imports (reserved for a future asynchronous
 * transport provider — always 0 under the synchronous mock, honestly),
 * delivered/rejected counts, and the most recent record.
 */
export function getQueue(dependencies = {}) {
  const { transportStore } = dependencies;
  const summaries = transportStore.list();
  return {
    pending_exports: summaries.filter((r) => r.direction === "outgoing" && r.status === "pending").length,
    pending_imports: summaries.filter((r) => r.direction === "incoming" && r.status === "pending").length,
    delivered: summaries.filter((r) => r.status === "delivered").length,
    rejected: summaries.filter((r) => r.status === "rejected").length,
    last_transport: summaries.length > 0 ? summaries[summaries.length - 1] : null,
    history_count: summaries.length,
  };
}

/** Full transport history, chronological — the store's own list() already sorts it. */
export function getHistory(dependencies = {}) {
  return dependencies.transportStore.list();
}

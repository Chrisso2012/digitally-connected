// DC-003-I029.1 — Bridge Transport Record domain object factory. Mirrors
// the "assemble, then validate, then deep-freeze" discipline every other
// domain-object factory in this codebase already applies to itself. No
// filesystem, no networking — composition only.
//
// `direction` is DERIVED from `objectType`, never accepted as caller
// input — an Engineering Work Order only ever travels "outgoing", an
// Engineering Delivery Report only ever travels "incoming" (see the
// schema's own header comment for why this is a real architectural rule,
// not an invented one). This makes an inconsistent direction structurally
// impossible, not just schema-checked after the fact.

import { randomUUID } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidBridgeTransportRecordInputError, BridgeTransportRecordValidationError } from "./bridge-transport-errors.mjs";

const OBJECT_TYPES = {
  engineering_work_order: { direction: "outgoing", idPattern: /^wo_[A-Za-z0-9]+$/ },
  engineering_delivery_report: { direction: "incoming", idPattern: /^dr_[A-Za-z0-9]+$/ },
};
const STATUSES = ["pending", "delivered", "rejected"];
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

function generateTransportRecordId() {
  return "bt_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Builds an immutable Bridge Transport Record.
 *
 * fields.objectType — required, "engineering_work_order" |
 *   "engineering_delivery_report". Determines `direction` — never
 *   supplied separately.
 * fields.objectId — required, must match the pattern implied by
 *   objectType (wo_... / dr_...).
 * fields.transportType — required, non-empty string (e.g. "mock").
 * fields.status — required, "pending" | "delivered" | "rejected".
 * fields.source / destination — required, non-empty strings.
 * fields.checksum — required, a 64-character lowercase hex SHA-256 digest.
 * fields.notes — optional, string or null.
 *
 * options.now / idGenerator / validator / rootDir — injectable for tests.
 *
 * Throws InvalidBridgeTransportRecordInputError for structurally invalid
 * input. Throws BridgeTransportRecordValidationError if the assembled
 * object still fails schema validation.
 */
export function createBridgeTransportRecord(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateTransportRecordId;
  const validator = options.validator ?? createValidator(options);

  const objectTypeInfo = OBJECT_TYPES[fields.objectType];
  if (!objectTypeInfo) {
    throw new InvalidBridgeTransportRecordInputError(`fields.objectType must be one of ${Object.keys(OBJECT_TYPES).join(", ")}`);
  }
  if (typeof fields.objectId !== "string" || !objectTypeInfo.idPattern.test(fields.objectId)) {
    throw new InvalidBridgeTransportRecordInputError(`fields.objectId does not match the expected identifier shape for "${fields.objectType}"`);
  }
  if (!isNonEmptyString(fields.transportType)) {
    throw new InvalidBridgeTransportRecordInputError("fields.transportType is required and must be a non-empty string");
  }
  if (!STATUSES.includes(fields.status)) {
    throw new InvalidBridgeTransportRecordInputError(`fields.status must be one of ${STATUSES.join(", ")}`);
  }
  if (!isNonEmptyString(fields.source)) {
    throw new InvalidBridgeTransportRecordInputError("fields.source is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.destination)) {
    throw new InvalidBridgeTransportRecordInputError("fields.destination is required and must be a non-empty string");
  }
  if (typeof fields.checksum !== "string" || !CHECKSUM_PATTERN.test(fields.checksum)) {
    throw new InvalidBridgeTransportRecordInputError("fields.checksum must be a 64-character lowercase hex SHA-256 digest");
  }
  if (fields.notes !== null && fields.notes !== undefined && typeof fields.notes !== "string") {
    throw new InvalidBridgeTransportRecordInputError("fields.notes must be a string or null");
  }

  const record = {
    transport_record_id: idGenerator(),
    object_type: fields.objectType,
    object_id: fields.objectId,
    direction: objectTypeInfo.direction,
    transport_type: fields.transportType,
    status: fields.status,
    transported_at: fields.transportedAt ?? now(),
    source: fields.source,
    destination: fields.destination,
    checksum: fields.checksum,
    notes: fields.notes ?? null,
  };

  const validation = validator.validate("bridgeTransportRecord", record);
  if (!validation.valid) {
    throw new BridgeTransportRecordValidationError(validation.errors);
  }

  return deepFreezeClone(record);
}

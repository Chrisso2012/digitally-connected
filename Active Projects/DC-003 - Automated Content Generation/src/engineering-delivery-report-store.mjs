// DC-003-I029 — Engineering Delivery Report Store: the domain layer over a
// Storage Adapter. Mirrors engineering-work-order-store.mjs exactly, plus
// one addition — findByWorkOrder() — needed by the Engineering Work
// Management Service to join a Work Order to its own Delivery Report(s).
//
// No replace()/update(): a Delivery Report is a point-in-time record of
// one completed engineering task — never intentionally revised in place.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidEngineeringDeliveryReportStoreAdapter } from "./engineering-delivery-report-store-adapter.mjs";
import {
  InvalidEngineeringDeliveryReportIdentifierError,
  EngineeringDeliveryReportAlreadyExistsError,
  EngineeringDeliveryReportNotFoundError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
} from "./engineering-delivery-report-errors.mjs";

const DELIVERY_REPORT_ID_PATTERN = /^dr_[A-Za-z0-9]+$/;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !DELIVERY_REPORT_ID_PATTERN.test(identifier)) {
    throw new InvalidEngineeringDeliveryReportIdentifierError(identifier);
  }
}

function parseStoredContent(identifier, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptedEngineeringDeliveryReportError(identifier, "stored content is not valid JSON");
  }
}

function validateStoredReport(identifier, report, validator) {
  const validation = validator.validate("engineeringDeliveryReport", report);
  if (!validation.valid) {
    throw new CorruptedEngineeringDeliveryReportError(
      identifier,
      `stored content does not match engineering-delivery-report.schema.json (${validation.errors.length} error(s))`
    );
  }
}

function summarize(record) {
  return {
    delivery_report_id: record.delivery_report_id,
    work_order_id: record.work_order_id,
    milestone: record.milestone,
    status: record.status,
    commit: record.commit,
    delivery_timestamp: record.delivery_timestamp,
  };
}

/**
 * Builds an Engineering Delivery Report Store over the given Storage
 * Adapter. Returns { name, save, get, list, findByWorkOrder, exists }.
 */
export function createEngineeringDeliveryReportStore({ adapter } = {}, options = {}) {
  assertValidEngineeringDeliveryReportStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);

  function readAllRecords() {
    let identifiers;
    try {
      identifiers = adapter.list();
    } catch (cause) {
      throw new EngineeringDeliveryReportPersistenceError("(list)", "list", cause);
    }
    return identifiers.map((identifier) => {
      let raw;
      try {
        raw = adapter.read(identifier);
      } catch (cause) {
        throw new EngineeringDeliveryReportPersistenceError(identifier, "read", cause);
      }
      const record = parseStoredContent(identifier, raw);
      validateStoredReport(identifier, record, validator);
      return record;
    });
  }

  function save(report) {
    const validation = validator.validate("engineeringDeliveryReport", report);
    if (!validation.valid) {
      throw new CorruptedEngineeringDeliveryReportError(
        report?.delivery_report_id ?? "(unknown)",
        `supplied record does not match engineering-delivery-report.schema.json (${validation.errors.length} error(s))`
      );
    }

    const identifier = report.delivery_report_id;
    checkIdentifier(identifier);

    let alreadyExists;
    try {
      alreadyExists = adapter.exists(identifier);
    } catch (cause) {
      throw new EngineeringDeliveryReportPersistenceError(identifier, "exists-check", cause);
    }
    if (alreadyExists) {
      throw new EngineeringDeliveryReportAlreadyExistsError(identifier);
    }

    const content = JSON.stringify(report);
    try {
      adapter.write(identifier, content);
    } catch (cause) {
      throw new EngineeringDeliveryReportPersistenceError(identifier, "write", cause);
    }

    return deepFreezeClone(report);
  }

  function get(identifier) {
    checkIdentifier(identifier);

    let found;
    try {
      found = adapter.exists(identifier);
    } catch (cause) {
      throw new EngineeringDeliveryReportPersistenceError(identifier, "exists-check", cause);
    }
    if (!found) {
      throw new EngineeringDeliveryReportNotFoundError(identifier);
    }

    let raw;
    try {
      raw = adapter.read(identifier);
    } catch (cause) {
      throw new EngineeringDeliveryReportPersistenceError(identifier, "read", cause);
    }

    const record = parseStoredContent(identifier, raw);
    validateStoredReport(identifier, record, validator);

    return deepFreezeClone(record);
  }

  function exists(identifier) {
    checkIdentifier(identifier);
    try {
      return adapter.exists(identifier);
    } catch (cause) {
      throw new EngineeringDeliveryReportPersistenceError(identifier, "exists-check", cause);
    }
  }

  /**
   * Returns a safe summary for every stored Delivery Report, ordered
   * chronologically by delivery_timestamp ascending (ties broken by
   * delivery_report_id).
   */
  function list() {
    const records = readAllRecords();
    const summaries = records.map(summarize);
    summaries.sort((a, b) =>
      a.delivery_timestamp < b.delivery_timestamp
        ? -1
        : a.delivery_timestamp > b.delivery_timestamp
          ? 1
          : a.delivery_report_id < b.delivery_report_id
            ? -1
            : 1
    );
    return deepFreezeClone(summaries);
  }

  /**
   * Returns every stored, full Delivery Report whose work_order_id
   * matches, ordered chronologically. Returns [] when none exist yet —
   * a legitimate state (a Work Order not yet delivered), never an error.
   */
  function findByWorkOrder(workOrderId) {
    const matches = readAllRecords()
      .filter((record) => record.work_order_id === workOrderId)
      .sort((a, b) =>
        a.delivery_timestamp < b.delivery_timestamp
          ? -1
          : a.delivery_timestamp > b.delivery_timestamp
            ? 1
            : a.delivery_report_id < b.delivery_report_id
              ? -1
              : 1
      );
    return deepFreezeClone(matches);
  }

  return { name: adapter.name, save, get, list, findByWorkOrder, exists };
}

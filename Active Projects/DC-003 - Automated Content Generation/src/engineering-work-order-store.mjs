// DC-003-I029 — Engineering Work Order Store: the domain layer over a
// Storage Adapter. Mirrors production-metrics-store.mjs (I023) /
// social-analytics-store.mjs (I028) exactly — never imports node:fs, every
// domain rule (duplicate rejection, existence checks, schema validation on
// both write and read, identifier safety, immutability, chronological
// ordering) lives here.
//
// No replace()/update(): a Work Order is authored once by the Strategy
// Office — this milestone's own brief explicitly forbids inventing
// workflow-transition mutation (see engineering-work-order.mjs's own
// header comment). save() rejects a duplicate work_order_id outright.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidEngineeringWorkOrderStoreAdapter } from "./engineering-work-order-store-adapter.mjs";
import {
  InvalidEngineeringWorkOrderIdentifierError,
  EngineeringWorkOrderAlreadyExistsError,
  EngineeringWorkOrderNotFoundError,
  CorruptedEngineeringWorkOrderError,
  EngineeringWorkOrderPersistenceError,
} from "./engineering-work-order-errors.mjs";

const WORK_ORDER_ID_PATTERN = /^wo_[A-Za-z0-9]+$/;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !WORK_ORDER_ID_PATTERN.test(identifier)) {
    throw new InvalidEngineeringWorkOrderIdentifierError(identifier);
  }
}

function parseStoredContent(identifier, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptedEngineeringWorkOrderError(identifier, "stored content is not valid JSON");
  }
}

function validateStoredWorkOrder(identifier, workOrder, validator) {
  const validation = validator.validate("engineeringWorkOrder", workOrder);
  if (!validation.valid) {
    throw new CorruptedEngineeringWorkOrderError(
      identifier,
      `stored content does not match engineering-work-order.schema.json (${validation.errors.length} error(s))`
    );
  }
}

function summarize(record) {
  return {
    work_order_id: record.work_order_id,
    milestone: record.milestone,
    title: record.title,
    status: record.status,
    priority: record.priority,
    created_at: record.created_at,
    approved_at: record.approved_at,
  };
}

/**
 * Builds an Engineering Work Order Store over the given Storage Adapter.
 * Returns { name, save, get, list, exists }.
 */
export function createEngineeringWorkOrderStore({ adapter } = {}, options = {}) {
  assertValidEngineeringWorkOrderStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);

  function readAllRecords() {
    let identifiers;
    try {
      identifiers = adapter.list();
    } catch (cause) {
      throw new EngineeringWorkOrderPersistenceError("(list)", "list", cause);
    }
    return identifiers.map((identifier) => {
      let raw;
      try {
        raw = adapter.read(identifier);
      } catch (cause) {
        throw new EngineeringWorkOrderPersistenceError(identifier, "read", cause);
      }
      const record = parseStoredContent(identifier, raw);
      validateStoredWorkOrder(identifier, record, validator);
      return record;
    });
  }

  function save(workOrder) {
    const validation = validator.validate("engineeringWorkOrder", workOrder);
    if (!validation.valid) {
      throw new CorruptedEngineeringWorkOrderError(
        workOrder?.work_order_id ?? "(unknown)",
        `supplied record does not match engineering-work-order.schema.json (${validation.errors.length} error(s))`
      );
    }

    const identifier = workOrder.work_order_id;
    checkIdentifier(identifier);

    let alreadyExists;
    try {
      alreadyExists = adapter.exists(identifier);
    } catch (cause) {
      throw new EngineeringWorkOrderPersistenceError(identifier, "exists-check", cause);
    }
    if (alreadyExists) {
      throw new EngineeringWorkOrderAlreadyExistsError(identifier);
    }

    const content = JSON.stringify(workOrder);
    try {
      adapter.write(identifier, content);
    } catch (cause) {
      throw new EngineeringWorkOrderPersistenceError(identifier, "write", cause);
    }

    return deepFreezeClone(workOrder);
  }

  function get(identifier) {
    checkIdentifier(identifier);

    let found;
    try {
      found = adapter.exists(identifier);
    } catch (cause) {
      throw new EngineeringWorkOrderPersistenceError(identifier, "exists-check", cause);
    }
    if (!found) {
      throw new EngineeringWorkOrderNotFoundError(identifier);
    }

    let raw;
    try {
      raw = adapter.read(identifier);
    } catch (cause) {
      throw new EngineeringWorkOrderPersistenceError(identifier, "read", cause);
    }

    const record = parseStoredContent(identifier, raw);
    validateStoredWorkOrder(identifier, record, validator);

    return deepFreezeClone(record);
  }

  function exists(identifier) {
    checkIdentifier(identifier);
    try {
      return adapter.exists(identifier);
    } catch (cause) {
      throw new EngineeringWorkOrderPersistenceError(identifier, "exists-check", cause);
    }
  }

  /**
   * Returns a safe summary for every stored Work Order, ordered
   * chronologically by created_at ascending (ties broken by
   * work_order_id, for full determinism).
   */
  function list() {
    const records = readAllRecords();
    const summaries = records.map(summarize);
    summaries.sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.work_order_id < b.work_order_id ? -1 : 1
    );
    return deepFreezeClone(summaries);
  }

  return { name: adapter.name, save, get, list, exists };
}

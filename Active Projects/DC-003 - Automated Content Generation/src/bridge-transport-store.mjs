// DC-003-I029.1 — Bridge Transport Store: the domain layer over a Storage
// Adapter. Mirrors engineering-work-order-store.mjs (I029) exactly —
// never imports node:fs, every domain rule (duplicate rejection,
// existence checks, schema validation on both write and read, identifier
// safety, immutability, chronological ordering) lives here.
//
// No replace()/update(): a transport event, once recorded, is permanent
// history — even a "rejected" record is never revised or deleted.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidBridgeTransportStoreAdapter } from "./bridge-transport-store-adapter.mjs";
import {
  InvalidBridgeTransportRecordIdentifierError,
  BridgeTransportRecordAlreadyExistsError,
  BridgeTransportRecordNotFoundError,
  CorruptedBridgeTransportRecordError,
  BridgeTransportPersistenceError,
} from "./bridge-transport-errors.mjs";

const TRANSPORT_RECORD_ID_PATTERN = /^bt_[A-Za-z0-9]+$/;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !TRANSPORT_RECORD_ID_PATTERN.test(identifier)) {
    throw new InvalidBridgeTransportRecordIdentifierError(identifier);
  }
}

function parseStoredContent(identifier, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptedBridgeTransportRecordError(identifier, "stored content is not valid JSON");
  }
}

function validateStoredRecord(identifier, record, validator) {
  const validation = validator.validate("bridgeTransportRecord", record);
  if (!validation.valid) {
    throw new CorruptedBridgeTransportRecordError(
      identifier,
      `stored content does not match bridge-transport-record.schema.json (${validation.errors.length} error(s))`
    );
  }
}

function summarize(record) {
  return {
    transport_record_id: record.transport_record_id,
    object_type: record.object_type,
    object_id: record.object_id,
    direction: record.direction,
    status: record.status,
    transported_at: record.transported_at,
  };
}

function sortChronologically(records) {
  return [...records].sort((a, b) =>
    a.transported_at < b.transported_at ? -1 : a.transported_at > b.transported_at ? 1 : a.transport_record_id < b.transport_record_id ? -1 : 1
  );
}

/**
 * Builds a Bridge Transport Store over the given Storage Adapter.
 * Returns { name, save, get, list, findByObject, exists }.
 */
export function createBridgeTransportStore({ adapter } = {}, options = {}) {
  assertValidBridgeTransportStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);

  function readAllRecords() {
    let identifiers;
    try {
      identifiers = adapter.list();
    } catch (cause) {
      throw new BridgeTransportPersistenceError("(list)", "list", cause);
    }
    return identifiers.map((identifier) => {
      let raw;
      try {
        raw = adapter.read(identifier);
      } catch (cause) {
        throw new BridgeTransportPersistenceError(identifier, "read", cause);
      }
      const record = parseStoredContent(identifier, raw);
      validateStoredRecord(identifier, record, validator);
      return record;
    });
  }

  function save(record) {
    const validation = validator.validate("bridgeTransportRecord", record);
    if (!validation.valid) {
      throw new CorruptedBridgeTransportRecordError(
        record?.transport_record_id ?? "(unknown)",
        `supplied record does not match bridge-transport-record.schema.json (${validation.errors.length} error(s))`
      );
    }

    const identifier = record.transport_record_id;
    checkIdentifier(identifier);

    let alreadyExists;
    try {
      alreadyExists = adapter.exists(identifier);
    } catch (cause) {
      throw new BridgeTransportPersistenceError(identifier, "exists-check", cause);
    }
    if (alreadyExists) {
      throw new BridgeTransportRecordAlreadyExistsError(identifier);
    }

    const content = JSON.stringify(record);
    try {
      adapter.write(identifier, content);
    } catch (cause) {
      throw new BridgeTransportPersistenceError(identifier, "write", cause);
    }

    return deepFreezeClone(record);
  }

  function get(identifier) {
    checkIdentifier(identifier);

    let found;
    try {
      found = adapter.exists(identifier);
    } catch (cause) {
      throw new BridgeTransportPersistenceError(identifier, "exists-check", cause);
    }
    if (!found) {
      throw new BridgeTransportRecordNotFoundError(identifier);
    }

    let raw;
    try {
      raw = adapter.read(identifier);
    } catch (cause) {
      throw new BridgeTransportPersistenceError(identifier, "read", cause);
    }

    const record = parseStoredContent(identifier, raw);
    validateStoredRecord(identifier, record, validator);

    return deepFreezeClone(record);
  }

  function exists(identifier) {
    checkIdentifier(identifier);
    try {
      return adapter.exists(identifier);
    } catch (cause) {
      throw new BridgeTransportPersistenceError(identifier, "exists-check", cause);
    }
  }

  /**
   * Returns a safe summary for every stored record, ordered
   * chronologically by transported_at ascending.
   */
  function list() {
    const summaries = sortChronologically(readAllRecords()).map(summarize);
    return deepFreezeClone(summaries);
  }

  /**
   * Returns every stored, full record whose object_id matches, ordered
   * chronologically. Returns [] for "never transported" — a legitimate
   * state, never an error.
   */
  function findByObject(objectId) {
    const matches = sortChronologically(readAllRecords().filter((record) => record.object_id === objectId));
    return deepFreezeClone(matches);
  }

  return { name: adapter.name, save, get, list, findByObject, exists };
}

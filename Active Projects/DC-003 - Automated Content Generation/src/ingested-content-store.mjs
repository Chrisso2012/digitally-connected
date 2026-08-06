// DC-003-I030 — Ingested Content Store: the domain layer over a Storage
// Adapter. Mirrors engineering-work-order-store.mjs exactly — never
// imports node:fs, every domain rule (duplicate rejection, existence
// checks, schema validation on both write and read, identifier safety,
// immutability, chronological ordering) lives here.
//
// No replace()/update(): an Ingested Content record is immutable — see
// ingested-content.schema.json's own header comment. save() rejects a
// duplicate ingested_content_id outright (defense-in-depth; IDs are
// randomly generated and collision is not expected in practice —
// duplicate SOURCE ingestion is a separate concern, handled by
// findBySourceReference() below, used by content-ingestion-service.mjs).

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidIngestedContentStoreAdapter } from "./ingested-content-store-adapter.mjs";
import {
  InvalidIngestedContentIdentifierError,
  IngestedContentAlreadyExistsError,
  IngestedContentNotFoundError,
  CorruptedIngestedContentError,
  IngestedContentPersistenceError,
} from "./ingested-content-errors.mjs";

const IDENTIFIER_PATTERN = /^ic_[A-Za-z0-9]+$/;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !IDENTIFIER_PATTERN.test(identifier)) {
    throw new InvalidIngestedContentIdentifierError(identifier);
  }
}

function parseStoredContent(identifier, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptedIngestedContentError(identifier, "stored content is not valid JSON");
  }
}

function validateStoredRecord(identifier, record, validator) {
  const validation = validator.validate("ingestedContent", record);
  if (!validation.valid) {
    throw new CorruptedIngestedContentError(
      identifier,
      `stored content does not match ingested-content.schema.json (${validation.errors.length} error(s))`
    );
  }
}

function summarize(record) {
  return {
    ingested_content_id: record.ingested_content_id,
    source_type: record.source_type,
    source_reference: record.source_reference,
    title: record.title,
    status: record.status,
    approval_state: record.approval_state,
    word_count: record.word_count,
    created_at: record.created_at,
  };
}

/**
 * Builds an Ingested Content Store over the given Storage Adapter.
 * Returns { name, save, get, list, exists, findBySourceReference }.
 */
export function createIngestedContentStore({ adapter } = {}, options = {}) {
  assertValidIngestedContentStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);

  function readAllRecords() {
    let identifiers;
    try {
      identifiers = adapter.list();
    } catch (cause) {
      throw new IngestedContentPersistenceError("(list)", "list", cause);
    }
    return identifiers.map((identifier) => {
      let raw;
      try {
        raw = adapter.read(identifier);
      } catch (cause) {
        throw new IngestedContentPersistenceError(identifier, "read", cause);
      }
      const record = parseStoredContent(identifier, raw);
      validateStoredRecord(identifier, record, validator);
      return record;
    });
  }

  function save(ingestedContent) {
    const validation = validator.validate("ingestedContent", ingestedContent);
    if (!validation.valid) {
      throw new CorruptedIngestedContentError(
        ingestedContent?.ingested_content_id ?? "(unknown)",
        `supplied record does not match ingested-content.schema.json (${validation.errors.length} error(s))`
      );
    }

    const identifier = ingestedContent.ingested_content_id;
    checkIdentifier(identifier);

    let alreadyExists;
    try {
      alreadyExists = adapter.exists(identifier);
    } catch (cause) {
      throw new IngestedContentPersistenceError(identifier, "exists-check", cause);
    }
    if (alreadyExists) {
      throw new IngestedContentAlreadyExistsError(identifier);
    }

    const content = JSON.stringify(ingestedContent);
    try {
      adapter.write(identifier, content);
    } catch (cause) {
      throw new IngestedContentPersistenceError(identifier, "write", cause);
    }

    return deepFreezeClone(ingestedContent);
  }

  function get(identifier) {
    checkIdentifier(identifier);

    let found;
    try {
      found = adapter.exists(identifier);
    } catch (cause) {
      throw new IngestedContentPersistenceError(identifier, "exists-check", cause);
    }
    if (!found) {
      throw new IngestedContentNotFoundError(identifier);
    }

    let raw;
    try {
      raw = adapter.read(identifier);
    } catch (cause) {
      throw new IngestedContentPersistenceError(identifier, "read", cause);
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
      throw new IngestedContentPersistenceError(identifier, "exists-check", cause);
    }
  }

  /**
   * Returns a safe summary for every stored record, ordered
   * chronologically by created_at ascending (ties broken by
   * ingested_content_id, for full determinism).
   */
  function list() {
    const records = readAllRecords();
    const summaries = records.map(summarize);
    summaries.sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.ingested_content_id < b.ingested_content_id ? -1 : 1
    );
    return deepFreezeClone(summaries);
  }

  /**
   * Returns every full record whose source_reference matches, ordered
   * chronologically by created_at ascending — used by
   * content-ingestion-service.mjs to detect a duplicate (unchanged
   * source_fingerprint) vs. a legitimate re-ingestion (changed
   * source_fingerprint) of the same source document.
   */
  function findBySourceReference(sourceReference) {
    const records = readAllRecords().filter((record) => record.source_reference === sourceReference);
    records.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    return deepFreezeClone(records);
  }

  return { name: adapter.name, save, get, list, exists, findBySourceReference };
}

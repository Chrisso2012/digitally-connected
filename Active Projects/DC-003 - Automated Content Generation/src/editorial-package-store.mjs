// DC-003-I031 — Editorial Package Store: the domain layer over a Storage
// Adapter. Mirrors ingested-content-store.mjs exactly — never imports
// node:fs, every domain rule (duplicate rejection, existence checks,
// schema validation on both write and read, identifier safety,
// immutability, chronological ordering) lives here.
//
// No replace()/update(): an Editorial Package is immutable — see
// editorial-package.schema.json's own header comment. save() rejects a
// duplicate editorial_package_id outright (defense-in-depth; IDs are
// randomly generated). The real duplicate concern — at most one Editorial
// Package per ingested_content_id — is enforced by
// editorial-package-generator.mjs using findByIngestedContentId() below,
// mirroring ingested-content-store.mjs's own findBySourceReference() precedent.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidEditorialPackageStoreAdapter } from "./editorial-package-store-adapter.mjs";
import {
  InvalidEditorialPackageIdentifierError,
  EditorialPackageAlreadyExistsError,
  EditorialPackageNotFoundError,
  CorruptedEditorialPackageError,
  EditorialPackagePersistenceError,
} from "./editorial-package-errors.mjs";

const IDENTIFIER_PATTERN = /^ep_[A-Za-z0-9]+$/;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !IDENTIFIER_PATTERN.test(identifier)) {
    throw new InvalidEditorialPackageIdentifierError(identifier);
  }
}

function parseStoredContent(identifier, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptedEditorialPackageError(identifier, "stored content is not valid JSON");
  }
}

function validateStoredRecord(identifier, record, validator) {
  const validation = validator.validate("editorialPackage", record);
  if (!validation.valid) {
    throw new CorruptedEditorialPackageError(
      identifier,
      `stored content does not match editorial-package.schema.json (${validation.errors.length} error(s))`
    );
  }
}

function summarize(record) {
  return {
    editorial_package_id: record.editorial_package_id,
    ingested_content_id: record.ingested_content_id,
    status: record.status,
    primary_headline: record.primary_headline,
    generated_at: record.generated_at,
  };
}

/**
 * Builds an Editorial Package Store over the given Storage Adapter.
 * Returns { name, save, get, list, exists, findByIngestedContentId }.
 */
export function createEditorialPackageStore({ adapter } = {}, options = {}) {
  assertValidEditorialPackageStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);

  function readAllRecords() {
    let identifiers;
    try {
      identifiers = adapter.list();
    } catch (cause) {
      throw new EditorialPackagePersistenceError("(list)", "list", cause);
    }
    return identifiers.map((identifier) => {
      let raw;
      try {
        raw = adapter.read(identifier);
      } catch (cause) {
        throw new EditorialPackagePersistenceError(identifier, "read", cause);
      }
      const record = parseStoredContent(identifier, raw);
      validateStoredRecord(identifier, record, validator);
      return record;
    });
  }

  function save(editorialPackage) {
    const validation = validator.validate("editorialPackage", editorialPackage);
    if (!validation.valid) {
      throw new CorruptedEditorialPackageError(
        editorialPackage?.editorial_package_id ?? "(unknown)",
        `supplied record does not match editorial-package.schema.json (${validation.errors.length} error(s))`
      );
    }

    const identifier = editorialPackage.editorial_package_id;
    checkIdentifier(identifier);

    let alreadyExists;
    try {
      alreadyExists = adapter.exists(identifier);
    } catch (cause) {
      throw new EditorialPackagePersistenceError(identifier, "exists-check", cause);
    }
    if (alreadyExists) {
      throw new EditorialPackageAlreadyExistsError(identifier);
    }

    const content = JSON.stringify(editorialPackage);
    try {
      adapter.write(identifier, content);
    } catch (cause) {
      throw new EditorialPackagePersistenceError(identifier, "write", cause);
    }

    return deepFreezeClone(editorialPackage);
  }

  function get(identifier) {
    checkIdentifier(identifier);

    let found;
    try {
      found = adapter.exists(identifier);
    } catch (cause) {
      throw new EditorialPackagePersistenceError(identifier, "exists-check", cause);
    }
    if (!found) {
      throw new EditorialPackageNotFoundError(identifier);
    }

    let raw;
    try {
      raw = adapter.read(identifier);
    } catch (cause) {
      throw new EditorialPackagePersistenceError(identifier, "read", cause);
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
      throw new EditorialPackagePersistenceError(identifier, "exists-check", cause);
    }
  }

  /**
   * Returns a safe summary for every stored record, ordered
   * chronologically by generated_at ascending (ties broken by
   * editorial_package_id, for full determinism).
   */
  function list() {
    const records = readAllRecords();
    const summaries = records.map(summarize);
    summaries.sort((a, b) =>
      a.generated_at < b.generated_at ? -1 : a.generated_at > b.generated_at ? 1 : a.editorial_package_id < b.editorial_package_id ? -1 : 1
    );
    return deepFreezeClone(summaries);
  }

  /**
   * Returns every full record whose ingested_content_id matches, ordered
   * chronologically by generated_at ascending — used by
   * editorial-package-generator.mjs to enforce "at most one Editorial
   * Package per Ingested Content record."
   */
  function findByIngestedContentId(ingestedContentId) {
    const records = readAllRecords().filter((record) => record.ingested_content_id === ingestedContentId);
    records.sort((a, b) => (a.generated_at < b.generated_at ? -1 : a.generated_at > b.generated_at ? 1 : 0));
    return deepFreezeClone(records);
  }

  return { name: adapter.name, save, get, list, exists, findByIngestedContentId };
}

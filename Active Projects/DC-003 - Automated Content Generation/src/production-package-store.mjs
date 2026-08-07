// DC-003-I033 — Production Package Store: the domain layer over a
// Storage Adapter. Mirrors social-media-package-store.mjs exactly —
// never imports node:fs, every domain rule (duplicate rejection,
// existence checks, schema validation on both write and read,
// identifier safety, immutability, chronological ordering) lives here.
//
// No replace()/update(): a Production Package is immutable. save()
// rejects a duplicate production_package_id outright (defense-in-depth;
// IDs are randomly generated). The real duplicate concern — at most one
// Production Package per social_media_package_id — is enforced by
// production-package-generator.mjs using findBySocialMediaPackageId()
// below, mirroring social-media-package-store.mjs's own
// findByEditorialPackageId() precedent.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidProductionPackageStoreAdapter } from "./production-package-store-adapter.mjs";
import {
  InvalidProductionPackageIdentifierError,
  ProductionPackageAlreadyExistsError,
  ProductionPackageNotFoundError,
  CorruptedProductionPackageError,
  ProductionPackagePersistenceError,
} from "./production-package-errors.mjs";

const IDENTIFIER_PATTERN = /^pp_[A-Za-z0-9]+$/;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !IDENTIFIER_PATTERN.test(identifier)) {
    throw new InvalidProductionPackageIdentifierError(identifier);
  }
}

function parseStoredContent(identifier, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptedProductionPackageError(identifier, "stored content is not valid JSON");
  }
}

function validateStoredRecord(identifier, record, validator) {
  const validation = validator.validate("productionPackage", record);
  if (!validation.valid) {
    throw new CorruptedProductionPackageError(
      identifier,
      `stored content does not match production-package.schema.json (${validation.errors.length} error(s))`
    );
  }
}

function summarize(record) {
  return {
    production_package_id: record.production_package_id,
    social_media_package_id: record.social_media_package_id,
    status: record.status,
    renderer: record.renderer,
    template_id: record.template_id,
    generated_at: record.generated_at,
  };
}

/**
 * Builds a Production Package Store over the given Storage Adapter.
 * Returns { name, save, get, list, exists, findBySocialMediaPackageId }.
 */
export function createProductionPackageStore({ adapter } = {}, options = {}) {
  assertValidProductionPackageStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);

  function readAllRecords() {
    let identifiers;
    try {
      identifiers = adapter.list();
    } catch (cause) {
      throw new ProductionPackagePersistenceError("(list)", "list", cause);
    }
    return identifiers.map((identifier) => {
      let raw;
      try {
        raw = adapter.read(identifier);
      } catch (cause) {
        throw new ProductionPackagePersistenceError(identifier, "read", cause);
      }
      const record = parseStoredContent(identifier, raw);
      validateStoredRecord(identifier, record, validator);
      return record;
    });
  }

  function save(productionPackage) {
    const validation = validator.validate("productionPackage", productionPackage);
    if (!validation.valid) {
      throw new CorruptedProductionPackageError(
        productionPackage?.production_package_id ?? "(unknown)",
        `supplied record does not match production-package.schema.json (${validation.errors.length} error(s))`
      );
    }

    const identifier = productionPackage.production_package_id;
    checkIdentifier(identifier);

    let alreadyExists;
    try {
      alreadyExists = adapter.exists(identifier);
    } catch (cause) {
      throw new ProductionPackagePersistenceError(identifier, "exists-check", cause);
    }
    if (alreadyExists) {
      throw new ProductionPackageAlreadyExistsError(identifier);
    }

    const content = JSON.stringify(productionPackage);
    try {
      adapter.write(identifier, content);
    } catch (cause) {
      throw new ProductionPackagePersistenceError(identifier, "write", cause);
    }

    return deepFreezeClone(productionPackage);
  }

  function get(identifier) {
    checkIdentifier(identifier);

    let found;
    try {
      found = adapter.exists(identifier);
    } catch (cause) {
      throw new ProductionPackagePersistenceError(identifier, "exists-check", cause);
    }
    if (!found) {
      throw new ProductionPackageNotFoundError(identifier);
    }

    let raw;
    try {
      raw = adapter.read(identifier);
    } catch (cause) {
      throw new ProductionPackagePersistenceError(identifier, "read", cause);
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
      throw new ProductionPackagePersistenceError(identifier, "exists-check", cause);
    }
  }

  /**
   * Returns a safe summary for every stored record, ordered
   * chronologically by generated_at ascending (ties broken by
   * production_package_id, for full determinism).
   */
  function list() {
    const records = readAllRecords();
    const summaries = records.map(summarize);
    summaries.sort((a, b) =>
      a.generated_at < b.generated_at ? -1 : a.generated_at > b.generated_at ? 1 : a.production_package_id < b.production_package_id ? -1 : 1
    );
    return deepFreezeClone(summaries);
  }

  /**
   * Returns every full record whose social_media_package_id matches,
   * ordered chronologically by generated_at ascending — used by
   * production-package-generator.mjs to enforce "at most one Production
   * Package per Social Media Package."
   */
  function findBySocialMediaPackageId(socialMediaPackageId) {
    const records = readAllRecords().filter((record) => record.social_media_package_id === socialMediaPackageId);
    records.sort((a, b) => (a.generated_at < b.generated_at ? -1 : a.generated_at > b.generated_at ? 1 : 0));
    return deepFreezeClone(records);
  }

  return { name: adapter.name, save, get, list, exists, findBySocialMediaPackageId };
}

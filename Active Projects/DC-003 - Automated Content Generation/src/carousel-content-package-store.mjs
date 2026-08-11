// DC-003-I032.10.1 — Carousel Content Package Store: the domain layer
// over a Storage Adapter. Mirrors editorial-package-store.mjs exactly —
// never imports node:fs, every domain rule (duplicate rejection,
// existence checks, schema validation on both write and read, identifier
// safety) lives here.
//
// No replace()/update(): a Carousel Content Package is immutable — no
// revision/correction mechanism is implemented for this object in this
// milestone (see the I032.10.1 report). save() rejects a duplicate
// carousel_content_package_id outright (defense-in-depth; IDs are
// randomly generated). Unlike editorial-package-store.mjs/
// social-media-package-store.mjs, there is no findBy*() duplicate-
// protection lookup here either — a Carousel Content Package does not
// derive from any other DC-003 object by identifier (it is sourced from
// an upstream article title/reference, never an editorial_package_id),
// so there is no "at most one per X" concern to enforce.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidCarouselContentPackageStoreAdapter } from "./carousel-content-package-store-adapter.mjs";
import {
  InvalidCarouselContentPackageIdentifierError,
  CarouselContentPackageAlreadyExistsError,
  CarouselContentPackageNotFoundError,
  CorruptedCarouselContentPackageError,
  CarouselContentPackagePersistenceError,
} from "./carousel-content-package-errors.mjs";

const IDENTIFIER_PATTERN = /^ccp_[A-Za-z0-9]+$/;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !IDENTIFIER_PATTERN.test(identifier)) {
    throw new InvalidCarouselContentPackageIdentifierError(identifier);
  }
}

function parseStoredContent(identifier, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptedCarouselContentPackageError(identifier, "stored content is not valid JSON");
  }
}

function validateStoredRecord(identifier, record, validator) {
  const validation = validator.validate("carouselContentPackage", record);
  if (!validation.valid) {
    throw new CorruptedCarouselContentPackageError(
      identifier,
      `stored content does not match carousel-content-package.schema.json (${validation.errors.length} error(s))`
    );
  }
}

function summarize(record) {
  return {
    carousel_content_package_id: record.carousel_content_package_id,
    carousel_title: record.carousel_title,
    industry_name: record.industry_name,
    industry_series: record.industry_series,
    total_slides: record.total_slides,
    created_at: record.created_at,
  };
}

/**
 * Builds a Carousel Content Package Store over the given Storage
 * Adapter. Returns { name, save, get, list, exists }.
 */
export function createCarouselContentPackageStore({ adapter } = {}, options = {}) {
  assertValidCarouselContentPackageStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);

  function readAllRecords() {
    let identifiers;
    try {
      identifiers = adapter.list();
    } catch (cause) {
      throw new CarouselContentPackagePersistenceError("(list)", "list", cause);
    }
    return identifiers.map((identifier) => {
      let raw;
      try {
        raw = adapter.read(identifier);
      } catch (cause) {
        throw new CarouselContentPackagePersistenceError(identifier, "read", cause);
      }
      const record = parseStoredContent(identifier, raw);
      validateStoredRecord(identifier, record, validator);
      return record;
    });
  }

  /**
   * Persists a new, validated Carousel Content Package. Never mutates
   * the supplied object. Returns an immutable, deep-frozen copy of
   * exactly what was stored.
   *
   * Throws CorruptedCarouselContentPackageError if `carouselContentPackage`
   * fails schema validation. Throws CarouselContentPackageAlreadyExistsError
   * if a record already exists for its carousel_content_package_id.
   */
  function save(carouselContentPackage) {
    const validation = validator.validate("carouselContentPackage", carouselContentPackage);
    if (!validation.valid) {
      throw new CorruptedCarouselContentPackageError(
        carouselContentPackage?.carousel_content_package_id ?? "(unknown)",
        `supplied record does not match carousel-content-package.schema.json (${validation.errors.length} error(s))`
      );
    }

    const identifier = carouselContentPackage.carousel_content_package_id;
    checkIdentifier(identifier);

    let alreadyExists;
    try {
      alreadyExists = adapter.exists(identifier);
    } catch (cause) {
      throw new CarouselContentPackagePersistenceError(identifier, "exists-check", cause);
    }
    if (alreadyExists) {
      throw new CarouselContentPackageAlreadyExistsError(identifier);
    }

    const content = JSON.stringify(carouselContentPackage);
    try {
      adapter.write(identifier, content);
    } catch (cause) {
      throw new CarouselContentPackagePersistenceError(identifier, "write", cause);
    }

    return deepFreezeClone(carouselContentPackage);
  }

  /**
   * Retrieves the stored Carousel Content Package for `identifier`.
   * Parses and validates the stored JSON before returning it. Returns an
   * immutable, deep-frozen object.
   *
   * Throws InvalidCarouselContentPackageIdentifierError for a malformed
   * identifier. Throws CarouselContentPackageNotFoundError if no record
   * exists. Throws CorruptedCarouselContentPackageError if the stored
   * content is not valid JSON, or doesn't validate against
   * carousel-content-package.schema.json.
   */
  function get(identifier) {
    checkIdentifier(identifier);

    let found;
    try {
      found = adapter.exists(identifier);
    } catch (cause) {
      throw new CarouselContentPackagePersistenceError(identifier, "exists-check", cause);
    }
    if (!found) {
      throw new CarouselContentPackageNotFoundError(identifier);
    }

    let raw;
    try {
      raw = adapter.read(identifier);
    } catch (cause) {
      throw new CarouselContentPackagePersistenceError(identifier, "read", cause);
    }

    const record = parseStoredContent(identifier, raw);
    validateStoredRecord(identifier, record, validator);

    return deepFreezeClone(record);
  }

  /**
   * Returns true if a stored record exists for `identifier`, without
   * reading or validating it.
   */
  function exists(identifier) {
    checkIdentifier(identifier);
    try {
      return adapter.exists(identifier);
    } catch (cause) {
      throw new CarouselContentPackagePersistenceError(identifier, "exists-check", cause);
    }
  }

  /**
   * Returns a safe summary for every stored record, ordered
   * chronologically by created_at ascending (ties broken by
   * carousel_content_package_id, for full determinism).
   */
  function list() {
    const records = readAllRecords();
    const summaries = records.map(summarize);
    summaries.sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.carousel_content_package_id < b.carousel_content_package_id ? -1 : 1
    );
    return deepFreezeClone(summaries);
  }

  return { name: adapter.name, save, get, list, exists };
}

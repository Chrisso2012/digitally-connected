// DC-003-I032 — Social Media Package Store: the domain layer over a
// Storage Adapter. Mirrors editorial-package-store.mjs exactly — never
// imports node:fs, every domain rule (duplicate rejection, existence
// checks, schema validation on both write and read, identifier safety,
// immutability, chronological ordering) lives here.
//
// No replace()/update(): a Social Media Package is immutable. save()
// rejects a duplicate social_media_package_id outright (defense-in-depth;
// IDs are randomly generated). The real duplicate concern — at most one
// Social Media Package per editorial_package_id — is enforced by
// social-media-package-generator.mjs using findByEditorialPackageId()
// below, mirroring editorial-package-store.mjs's own
// findByIngestedContentId() precedent.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidSocialMediaPackageStoreAdapter } from "./social-media-package-store-adapter.mjs";
import {
  InvalidSocialMediaPackageIdentifierError,
  SocialMediaPackageAlreadyExistsError,
  SocialMediaPackageNotFoundError,
  CorruptedSocialMediaPackageError,
  SocialMediaPackagePersistenceError,
} from "./social-media-package-errors.mjs";

const IDENTIFIER_PATTERN = /^sm_[A-Za-z0-9]+$/;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !IDENTIFIER_PATTERN.test(identifier)) {
    throw new InvalidSocialMediaPackageIdentifierError(identifier);
  }
}

function parseStoredContent(identifier, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptedSocialMediaPackageError(identifier, "stored content is not valid JSON");
  }
}

function validateStoredRecord(identifier, record, validator) {
  const validation = validator.validate("socialMediaPackage", record);
  if (!validation.valid) {
    throw new CorruptedSocialMediaPackageError(
      identifier,
      `stored content does not match social-media-package.schema.json (${validation.errors.length} error(s))`
    );
  }
}

function summarize(record) {
  return {
    social_media_package_id: record.social_media_package_id,
    editorial_package_id: record.editorial_package_id,
    status: record.status,
    hook: record.hook,
    generated_at: record.generated_at,
  };
}

/**
 * Builds a Social Media Package Store over the given Storage Adapter.
 * Returns { name, save, get, list, exists, findByEditorialPackageId }.
 */
export function createSocialMediaPackageStore({ adapter } = {}, options = {}) {
  assertValidSocialMediaPackageStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);

  function readAllRecords() {
    let identifiers;
    try {
      identifiers = adapter.list();
    } catch (cause) {
      throw new SocialMediaPackagePersistenceError("(list)", "list", cause);
    }
    return identifiers.map((identifier) => {
      let raw;
      try {
        raw = adapter.read(identifier);
      } catch (cause) {
        throw new SocialMediaPackagePersistenceError(identifier, "read", cause);
      }
      const record = parseStoredContent(identifier, raw);
      validateStoredRecord(identifier, record, validator);
      return record;
    });
  }

  function save(socialMediaPackage) {
    const validation = validator.validate("socialMediaPackage", socialMediaPackage);
    if (!validation.valid) {
      throw new CorruptedSocialMediaPackageError(
        socialMediaPackage?.social_media_package_id ?? "(unknown)",
        `supplied record does not match social-media-package.schema.json (${validation.errors.length} error(s))`
      );
    }

    const identifier = socialMediaPackage.social_media_package_id;
    checkIdentifier(identifier);

    let alreadyExists;
    try {
      alreadyExists = adapter.exists(identifier);
    } catch (cause) {
      throw new SocialMediaPackagePersistenceError(identifier, "exists-check", cause);
    }
    if (alreadyExists) {
      throw new SocialMediaPackageAlreadyExistsError(identifier);
    }

    const content = JSON.stringify(socialMediaPackage);
    try {
      adapter.write(identifier, content);
    } catch (cause) {
      throw new SocialMediaPackagePersistenceError(identifier, "write", cause);
    }

    return deepFreezeClone(socialMediaPackage);
  }

  function get(identifier) {
    checkIdentifier(identifier);

    let found;
    try {
      found = adapter.exists(identifier);
    } catch (cause) {
      throw new SocialMediaPackagePersistenceError(identifier, "exists-check", cause);
    }
    if (!found) {
      throw new SocialMediaPackageNotFoundError(identifier);
    }

    let raw;
    try {
      raw = adapter.read(identifier);
    } catch (cause) {
      throw new SocialMediaPackagePersistenceError(identifier, "read", cause);
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
      throw new SocialMediaPackagePersistenceError(identifier, "exists-check", cause);
    }
  }

  /**
   * Returns a safe summary for every stored record, ordered
   * chronologically by generated_at ascending (ties broken by
   * social_media_package_id, for full determinism).
   */
  function list() {
    const records = readAllRecords();
    const summaries = records.map(summarize);
    summaries.sort((a, b) =>
      a.generated_at < b.generated_at ? -1 : a.generated_at > b.generated_at ? 1 : a.social_media_package_id < b.social_media_package_id ? -1 : 1
    );
    return deepFreezeClone(summaries);
  }

  /**
   * Returns every full record whose editorial_package_id matches,
   * ordered chronologically by generated_at ascending — used by
   * social-media-package-generator.mjs to enforce "at most one Social
   * Media Package per Editorial Package."
   */
  function findByEditorialPackageId(editorialPackageId) {
    const records = readAllRecords().filter((record) => record.editorial_package_id === editorialPackageId);
    records.sort((a, b) => (a.generated_at < b.generated_at ? -1 : a.generated_at > b.generated_at ? 1 : 0));
    return deepFreezeClone(records);
  }

  return { name: adapter.name, save, get, list, exists, findByEditorialPackageId };
}

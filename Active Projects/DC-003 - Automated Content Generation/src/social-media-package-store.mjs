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
import { createSocialMediaPackageSchemaHistory, applyCompatibilityView } from "./social-media-package-schema-history.mjs";
import { deriveLineage } from "./social-media-package-lineage.mjs";
import { loadVersions } from "./config-loader.mjs";
import {
  InvalidSocialMediaPackageIdentifierError,
  SocialMediaPackageAlreadyExistsError,
  SocialMediaPackageNotFoundError,
  CorruptedSocialMediaPackageError,
  UnsupportedSchemaVersionError,
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

// DC-003-I032.7 — validates a STORED (previously persisted) record
// against the schema/version contract it actually declares, never
// against whatever the schema has since evolved into. See
// social-media-package-schema-history.mjs's own header comment for the
// full architectural rationale and the real defect this replaces.
//
// A record whose own schema_version matches the current live schema
// validates exactly as before (the fast, common case — every record
// this store has ever written under the current schema). A record
// declaring an older, archived version validates against that
// version's own real historical schema instead, then — only once
// confirmed genuinely valid under ITS OWN contract — receives an
// in-memory-only compatibility view for any additive field a newer
// consumer might expect (never written back to disk; see
// applyCompatibilityView()'s own header comment). A record declaring
// neither the current version nor any archived historical version
// fails explicitly and distinctly (UnsupportedSchemaVersionError), never
// silently treated as either valid or as ordinary corruption. A record
// that is genuinely malformed FOR ITS OWN declared version still fails
// as CorruptedSocialMediaPackageError — this is strictly more precise
// than the old current-schema-only check, never more permissive.
function validateStoredRecordForItsOwnVersion(identifier, record, { validator, schemaHistory, currentVersion }) {
  const version = record?.schema_version;

  if (version === currentVersion) {
    const validation = validator.validate("socialMediaPackage", record);
    if (!validation.valid) {
      throw new CorruptedSocialMediaPackageError(
        identifier,
        `stored content does not match social-media-package.schema.json version "${currentVersion}" (its own declared version) (${validation.errors.length} error(s))`
      );
    }
    return record;
  }

  if (schemaHistory.isKnownHistoricalVersion(version)) {
    const validation = schemaHistory.validate(version, record);
    if (!validation.valid) {
      throw new CorruptedSocialMediaPackageError(
        identifier,
        `stored content does not match its own declared schema_version "${version}" (${validation.errors.length} error(s))`
      );
    }
    return applyCompatibilityView(record, version);
  }

  throw new UnsupportedSchemaVersionError(identifier, version, [...schemaHistory.knownVersions, currentVersion]);
}

function summarize(record) {
  return {
    social_media_package_id: record.social_media_package_id,
    editorial_package_id: record.editorial_package_id,
    status: record.status,
    hook: record.hook,
    generated_at: record.generated_at,
    revision: record.revision,
    supersedes: record.supersedes,
  };
}

/**
 * Builds a Social Media Package Store over the given Storage Adapter.
 * Returns { name, save, get, list, exists, findByEditorialPackageId }.
 *
 * options.schemaHistory — inject a pre-built historical-schema archive
 *   (createSocialMediaPackageSchemaHistory()) instead of loading the
 *   real one — used by tests pointing at a temporary archive directory.
 * options.currentVersion — override the "current" schema_version value
 *   (normally read from config/versions.json, the same source every
 *   generator already stamps onto brand-new records) — used by tests.
 */
export function createSocialMediaPackageStore({ adapter } = {}, options = {}) {
  assertValidSocialMediaPackageStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);
  const schemaHistory = options.schemaHistory ?? createSocialMediaPackageSchemaHistory(options);
  const currentVersion = options.currentVersion ?? loadVersions(options).schema_versions?.social_media_package;

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
      return validateStoredRecordForItsOwnVersion(identifier, record, { validator, schemaHistory, currentVersion });
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
    const compatibleRecord = validateStoredRecordForItsOwnVersion(identifier, record, { validator, schemaHistory, currentVersion });

    return deepFreezeClone(compatibleRecord);
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

  /**
   * DC-003-I032.8 — reconstructs and validates the full revision chain
   * for one Editorial Package, deriving "latest" from the immutable
   * supersedes chain rather than any stored flag (see
   * social-media-package-lineage.mjs's own header comment). Returns
   * { chain, latest } — chain is every revision in true V1..Vn order,
   * each annotated `is_latest`; latest is chain's last entry, or null
   * when no Social Media Package exists yet for this Editorial Package.
   *
   * Throws MalformedSocialMediaPackageLineageError if the stored records
   * for this editorial_package_id don't form a single well-formed chain
   * (a fork, a cycle, a dangling supersedes reference, or a revision
   * number that disagrees with true chain position) — this can only
   * happen from a persistence-layer defect or manual file tampering,
   * never from ordinary generateSocialMediaPackage()/
   * reviseSocialMediaPackage() use, both of which only ever extend a
   * chain that was already well-formed.
   */
  function getLineage(editorialPackageId) {
    const records = findByEditorialPackageId(editorialPackageId);
    return deepFreezeClone(deriveLineage(records));
  }

  /**
   * Convenience wrapper over getLineage() — returns just the current
   * latest-revision record (or null), for callers that don't need the
   * full chain.
   */
  function findLatestRevision(editorialPackageId) {
    return getLineage(editorialPackageId).latest;
  }

  return { name: adapter.name, save, get, list, exists, findByEditorialPackageId, getLineage, findLatestRevision };
}

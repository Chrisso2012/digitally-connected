// DC-003-I028 — Social Analytics Store: the domain layer over a Storage
// Adapter (social-analytics-store-adapter.mjs). Mirrors
// production-metrics-store.mjs (I023) / publisher-result-store.mjs (I025)
// exactly — this module knows nothing about files, only the Storage
// Adapter shape; it never imports node:fs. Every domain rule (duplicate
// rejection, existence checks, schema validation on both write and read,
// identifier safety, immutability, deterministic ordering) lives here; the
// adapter only ever moves bytes.
//
// No replace()/update(): a Social Analytics Snapshot is a point-in-time
// observation — historical snapshots are never overwritten (brief §10).
// save() rejects a duplicate analytics_snapshot_id outright; every genuine
// re-collection produces a fresh snapshot with its own fresh ID instead.
//
// findByPublisherResult()/findByCarousel() return full records ordered by
// collected_at ascending (chronological history). latestByPublisherResult()
// picks the maximum collected_at, tie-broken by analytics_snapshot_id
// descending for a fully deterministic result even if two collections
// somehow share a timestamp.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidSocialAnalyticsStoreAdapter } from "./social-analytics-store-adapter.mjs";
import {
  InvalidSocialAnalyticsSnapshotIdentifierError,
  SocialAnalyticsSnapshotAlreadyExistsError,
  SocialAnalyticsSnapshotNotFoundError,
  CorruptedSocialAnalyticsSnapshotError,
  SocialAnalyticsPersistenceError,
} from "./social-analytics-errors.mjs";

// Matches social-analytics-snapshot.schema.json's own analytics_snapshot_id
// pattern exactly — the one check standing between a caller-supplied
// string and a real filesystem path. Blocks path traversal by
// construction, not by a denylist.
const SNAPSHOT_ID_PATTERN = /^sas_[A-Za-z0-9]+$/;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !SNAPSHOT_ID_PATTERN.test(identifier)) {
    throw new InvalidSocialAnalyticsSnapshotIdentifierError(identifier);
  }
}

function parseStoredContent(identifier, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptedSocialAnalyticsSnapshotError(identifier, "stored content is not valid JSON");
  }
}

function validateStoredSnapshot(identifier, snapshot, validator) {
  const validation = validator.validate("socialAnalyticsSnapshot", snapshot);
  if (!validation.valid) {
    throw new CorruptedSocialAnalyticsSnapshotError(
      identifier,
      `stored content does not match social-analytics-snapshot.schema.json (${validation.errors.length} error(s))`
    );
  }
}

function summarize(record) {
  return {
    analytics_snapshot_id: record.analytics_snapshot_id,
    publisher_result_id: record.publisher_result_id,
    carousel_id: record.carousel_id,
    provider: record.provider,
    destination: record.destination,
    collected_at: record.collected_at,
  };
}

function sortByCollectedAtAscending(records) {
  return [...records].sort((a, b) =>
    a.collected_at < b.collected_at ? -1 : a.collected_at > b.collected_at ? 1 : a.analytics_snapshot_id < b.analytics_snapshot_id ? -1 : 1
  );
}

/**
 * Builds a Social Analytics Store over the given Storage Adapter.
 *
 * fields.adapter — required, must satisfy the Storage Adapter shape.
 * options.validator / rootDir — injectable for tests.
 *
 * Returns { name, save, get, list, findByPublisherResult, findByCarousel,
 * latestByPublisherResult, exists }.
 */
export function createSocialAnalyticsStore({ adapter } = {}, options = {}) {
  assertValidSocialAnalyticsStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);

  function readAllRecords() {
    let identifiers;
    try {
      identifiers = adapter.list();
    } catch (cause) {
      throw new SocialAnalyticsPersistenceError("(list)", "list", cause);
    }
    return identifiers.map((identifier) => {
      let raw;
      try {
        raw = adapter.read(identifier);
      } catch (cause) {
        throw new SocialAnalyticsPersistenceError(identifier, "read", cause);
      }
      const record = parseStoredContent(identifier, raw);
      validateStoredSnapshot(identifier, record, validator);
      return record;
    });
  }

  /**
   * Persists a new, validated Social Analytics Snapshot. Never mutates the
   * supplied object. Returns an immutable, deep-frozen copy of exactly
   * what was stored.
   *
   * Throws InvalidSocialAnalyticsSnapshotIdentifierError for a malformed
   * analytics_snapshot_id. Throws SocialAnalyticsSnapshotAlreadyExistsError
   * if a record already exists for its identifier — save() never
   * overwrites.
   */
  function save(snapshot) {
    const validation = validator.validate("socialAnalyticsSnapshot", snapshot);
    if (!validation.valid) {
      throw new CorruptedSocialAnalyticsSnapshotError(
        snapshot?.analytics_snapshot_id ?? "(unknown)",
        `supplied record does not match social-analytics-snapshot.schema.json (${validation.errors.length} error(s))`
      );
    }

    const identifier = snapshot.analytics_snapshot_id;
    checkIdentifier(identifier);

    let alreadyExists;
    try {
      alreadyExists = adapter.exists(identifier);
    } catch (cause) {
      throw new SocialAnalyticsPersistenceError(identifier, "exists-check", cause);
    }
    if (alreadyExists) {
      throw new SocialAnalyticsSnapshotAlreadyExistsError(identifier);
    }

    const content = JSON.stringify(snapshot);
    try {
      adapter.write(identifier, content);
    } catch (cause) {
      throw new SocialAnalyticsPersistenceError(identifier, "write", cause);
    }

    return deepFreezeClone(snapshot);
  }

  /**
   * Retrieves the stored Social Analytics Snapshot for `identifier`.
   * Throws InvalidSocialAnalyticsSnapshotIdentifierError,
   * SocialAnalyticsSnapshotNotFoundError, or
   * CorruptedSocialAnalyticsSnapshotError as appropriate.
   */
  function get(identifier) {
    checkIdentifier(identifier);

    let found;
    try {
      found = adapter.exists(identifier);
    } catch (cause) {
      throw new SocialAnalyticsPersistenceError(identifier, "exists-check", cause);
    }
    if (!found) {
      throw new SocialAnalyticsSnapshotNotFoundError(identifier);
    }

    let raw;
    try {
      raw = adapter.read(identifier);
    } catch (cause) {
      throw new SocialAnalyticsPersistenceError(identifier, "read", cause);
    }

    const record = parseStoredContent(identifier, raw);
    validateStoredSnapshot(identifier, record, validator);

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
      throw new SocialAnalyticsPersistenceError(identifier, "exists-check", cause);
    }
  }

  /**
   * Returns a safe summary for every stored record, ordered
   * deterministically by analytics_snapshot_id ascending. Fails on the
   * first corrupted entry found, naming which identifier — never silently
   * skips one.
   */
  function list() {
    const records = readAllRecords();
    const summaries = records.map(summarize);
    summaries.sort((a, b) => (a.analytics_snapshot_id < b.analytics_snapshot_id ? -1 : a.analytics_snapshot_id > b.analytics_snapshot_id ? 1 : 0));
    return deepFreezeClone(summaries);
  }

  /**
   * Returns every stored, full Social Analytics Snapshot whose
   * publisher_result_id matches, ordered chronologically (collected_at
   * ascending). Returns [] for "no collections yet" — a legitimate state,
   * never an error. Full scan, mirroring findByExecutionId()'s (I023) own
   * "a directory this size stays proportional to a full scan" precedent.
   */
  function findByPublisherResult(publisherResultId) {
    const matches = readAllRecords().filter((record) => record.publisher_result_id === publisherResultId);
    return deepFreezeClone(sortByCollectedAtAscending(matches));
  }

  /**
   * Returns every stored, full Social Analytics Snapshot whose carousel_id
   * matches (across every provider/publisher_result for that carousel),
   * ordered chronologically. Returns [] for "no collections yet".
   */
  function findByCarousel(carouselId) {
    const matches = readAllRecords().filter((record) => record.carousel_id === carouselId);
    return deepFreezeClone(sortByCollectedAtAscending(matches));
  }

  /**
   * Returns the most recent stored snapshot for `publisherResultId` — the
   * maximum collected_at, tie-broken deterministically by
   * analytics_snapshot_id descending — or null if none exist yet.
   */
  function latestByPublisherResult(publisherResultId) {
    const matches = sortByCollectedAtAscending(readAllRecords().filter((record) => record.publisher_result_id === publisherResultId));
    if (matches.length === 0) return null;
    return deepFreezeClone(matches[matches.length - 1]);
  }

  return { name: adapter.name, save, get, list, findByPublisherResult, findByCarousel, latestByPublisherResult, exists };
}

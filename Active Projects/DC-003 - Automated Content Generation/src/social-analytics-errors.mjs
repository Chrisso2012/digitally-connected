// DC-003-I028 — structured errors for the Social Analytics Snapshot domain
// object, its Storage Adapter contract, and the Local JSON Storage Adapter.
// Combines domain-object and store errors in one file, mirroring
// production-metrics-errors.mjs's own precedent (I023) — the closest
// analog to this milestone's own domain-object-plus-dedicated-store shape.
// Every message here is written on the assumption it may be shown to an
// external caller: never a raw filesystem path, a raw Node error message,
// a stack trace, an access token, or a raw provider response body.

/**
 * A field passed to createSocialAnalyticsSnapshot() is structurally
 * invalid (negative metric value, unrecognized availability state, a
 * missing sub-object, an unsupported provider) — a caller/adapter bug, not
 * a real analytics-collection problem.
 */
export class InvalidSocialAnalyticsSnapshotInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidSocialAnalyticsSnapshotInputError";
  }
}

/**
 * The assembled Social Analytics Snapshot failed schema validation against
 * social-analytics-snapshot.schema.json despite passing every composition
 * check the factory applies itself.
 */
export class SocialAnalyticsSnapshotValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Social Analytics Snapshot failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "SocialAnalyticsSnapshotValidationError";
    this.errors = errors;
  }
}

/**
 * A caller handed createSocialAnalyticsStore() something that doesn't
 * implement the Storage Adapter shape: { name: string, write(identifier,
 * content), read(identifier), list(), exists(identifier) }.
 */
export class InvalidSocialAnalyticsStoreAdapterError extends Error {
  constructor() {
    super(
      "A Social Analytics Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidSocialAnalyticsStoreAdapterError";
  }
}

/**
 * The identifier is not shaped like a real analytics_snapshot_id (this
 * schema's own `^sas_[A-Za-z0-9]+$` pattern) — the one check standing
 * between a caller-supplied string and a real filesystem path, blocking
 * path traversal by construction rather than by denylist.
 */
export class InvalidSocialAnalyticsSnapshotIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid analytics snapshot identifier — expected the form sas_<alphanumeric>`);
    this.name = "InvalidSocialAnalyticsSnapshotIdentifierError";
  }
}

/**
 * save() was called for an analytics_snapshot_id that already has a
 * stored record. save() never overwrites — this store has no
 * replace()/update() at all (each collection is a new, independent
 * historical observation — see README "Snapshot and time-series
 * behaviour").
 */
export class SocialAnalyticsSnapshotAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Social Analytics Snapshot "${identifier}" already exists in the store — snapshots are never overwritten`);
    this.name = "SocialAnalyticsSnapshotAlreadyExistsError";
    this.identifier = identifier;
  }
}

/** get() referenced an analytics_snapshot_id with no stored record. */
export class SocialAnalyticsSnapshotNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored Social Analytics Snapshot found for identifier "${identifier}"`);
    this.name = "SocialAnalyticsSnapshotNotFoundError";
    this.identifier = identifier;
  }
}

/**
 * A stored record could not be parsed as JSON, or parsed but failed
 * schema validation against social-analytics-snapshot.schema.json — the
 * store never returns a corrupted or malformed object silently.
 */
export class CorruptedSocialAnalyticsSnapshotError extends Error {
  constructor(identifier, reason) {
    super(`Stored Social Analytics Snapshot "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedSocialAnalyticsSnapshotError";
    this.identifier = identifier;
  }
}

/**
 * The storage adapter itself failed on a read or write — a genuine I/O
 * failure, not a validation problem. The underlying cause (which may
 * contain a raw host path) is attached as `.cause` for local debugging
 * only, never included in `.message`.
 */
export class SocialAnalyticsPersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for Social Analytics Snapshot "${identifier}"`, { cause });
    this.name = "SocialAnalyticsPersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

/**
 * A caller handed the Social Analytics Collection Service something that
 * doesn't implement the Social Analytics Adapter shape: { name: string,
 * provider: string, collectAnalytics({ publisherResult, collectedAt }) }.
 */
export class InvalidSocialAnalyticsAdapterError extends Error {
  constructor() {
    super("A Social Analytics Adapter must be shaped { name: string, provider: string, collectAnalytics({ publisherResult, collectedAt }) }");
    this.name = "InvalidSocialAnalyticsAdapterError";
  }
}

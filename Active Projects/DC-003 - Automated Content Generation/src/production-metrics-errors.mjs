// DC-003-I023 — structured errors for the Production Metrics domain
// object, its cost calculator, its storage-adapter contract, and the
// Local JSON Storage Adapter. Mirrors finished-carousel-store-errors.mjs's
// own discipline exactly: every message here is written on the assumption
// it may be shown to an external caller — none of them ever interpolate a
// raw filesystem path, a raw Node error message, a stack trace, an API
// key, or a provider response body. Only already-public identifiers
// (metrics_id, execution_id) are ever named.

/**
 * A field passed to createProductionMetrics() is structurally invalid
 * (negative count/duration/cost, a missing sub-object, an unrecognized
 * calculation_type) — a caller bug, not a real accounting problem.
 */
export class InvalidProductionMetricsInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidProductionMetricsInputError";
  }
}

/**
 * The assembled Production Metrics Record failed schema validation
 * against production-metrics.schema.json despite passing every
 * composition check createProductionMetrics() applies itself — e.g. a
 * "completed" record missing carousel_content_id/carousel_id.
 */
export class ProductionMetricsValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Production Metrics Record failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "ProductionMetricsValidationError";
    this.errors = errors;
  }
}

/**
 * A caller handed createProductionMetricsStore() something that doesn't
 * implement the Metrics Store Adapter shape: { name: string,
 * write(identifier, content), read(identifier), list(), exists(identifier) }.
 */
export class InvalidMetricsStoreAdapterError extends Error {
  constructor() {
    super(
      "A Production Metrics Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidMetricsStoreAdapterError";
  }
}

/**
 * The identifier is not shaped like a real metrics_id
 * (production-metrics.schema.json's own `^met_[A-Za-z0-9]+$` pattern) —
 * the one check that stands between an arbitrary caller-supplied string
 * and a filesystem path, blocking path traversal by construction rather
 * than by denylist.
 */
export class InvalidMetricsIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid metrics identifier — expected the form met_<alphanumeric>`);
    this.name = "InvalidMetricsIdentifierError";
  }
}

/**
 * save() was called for a metrics_id that already has a stored record.
 * save() never overwrites — this store has no replace()/update() at all
 * (a Production Metrics Record is a point-in-time snapshot, never
 * intentionally revised in place, unlike a Finished Carousel's approval
 * transitions).
 */
export class MetricsRecordAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Metrics record "${identifier}" already exists in the store — records are never overwritten`);
    this.name = "MetricsRecordAlreadyExistsError";
    this.identifier = identifier;
  }
}

/**
 * get() referenced a metrics_id with no stored record.
 */
export class MetricsRecordNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored metrics record found for identifier "${identifier}"`);
    this.name = "MetricsRecordNotFoundError";
    this.identifier = identifier;
  }
}

/**
 * A stored record (found by get() or during list()/findByExecutionId())
 * could not be parsed as JSON, or parsed but failed schema validation
 * against production-metrics.schema.json — the store never returns a
 * corrupted or malformed object silently.
 */
export class CorruptedMetricsRecordError extends Error {
  constructor(identifier, reason) {
    super(`Stored metrics record "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedMetricsRecordError";
    this.identifier = identifier;
  }
}

/**
 * The storage adapter itself failed on a read or write — a genuine I/O
 * failure, not a validation problem. The identifier is named; the
 * underlying cause (which may contain a raw host path) is attached as
 * `.cause` for local debugging only, never included in `.message`.
 */
export class MetricsPersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for metrics record "${identifier}"`, { cause });
    this.name = "MetricsPersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

// DC-003-I025 — structured errors for the Publisher Result domain object,
// its Storage Adapter contract, and the Local JSON Storage Adapter.
// Mirrors production-metrics-errors.mjs's own discipline exactly: every
// message here is written on the assumption it may be shown to an
// external caller — none of them ever interpolate a raw filesystem path,
// a raw Node error message, a stack trace, an access token, or a provider
// response body. Only already-public identifiers (publisher_result_id,
// carousel_id, execution_id) are ever named.

/**
 * A field passed to createPublisherResult() is structurally invalid (a
 * missing/blank required string, a malformed metadata value) — a caller
 * bug, not a real publishing problem.
 */
export class InvalidPublisherResultInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidPublisherResultInputError";
  }
}

/**
 * The assembled Publisher Result failed schema validation against
 * publisher-result.schema.json despite passing every composition check
 * createPublisherResult() applies itself.
 */
export class PublisherResultValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Publisher Result failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "PublisherResultValidationError";
    this.errors = errors;
  }
}

/**
 * A caller handed createPublisherResultStore() something that doesn't
 * implement the Publisher Result Storage Adapter shape: { name: string,
 * write(identifier, content), read(identifier), list(), exists(identifier) }.
 */
export class InvalidPublisherResultStoreAdapterError extends Error {
  constructor() {
    super(
      "A Publisher Result Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidPublisherResultStoreAdapterError";
  }
}

/**
 * The identifier is not shaped like a real publisher_result_id
 * (publisher-result.schema.json's own `^pub_[A-Za-z0-9]+$` pattern) — the
 * one check that stands between an arbitrary caller-supplied string and a
 * filesystem path, blocking path traversal by construction, not denylist.
 */
export class InvalidPublisherResultIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid publisher result identifier — expected the form pub_<alphanumeric>`);
    this.name = "InvalidPublisherResultIdentifierError";
  }
}

/**
 * save() was called for a publisher_result_id that already has a stored
 * record. save() never overwrites — a Publisher Result is a point-in-time
 * record of one successful publish event; a re-publish of the same
 * carousel legitimately produces a SECOND, separate record with its own
 * fresh ID, not an overwrite of this one.
 */
export class PublisherResultAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Publisher result "${identifier}" already exists in the store — records are never overwritten`);
    this.name = "PublisherResultAlreadyExistsError";
    this.identifier = identifier;
  }
}

/**
 * get() referenced a publisher_result_id with no stored record.
 */
export class PublisherResultNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored publisher result found for identifier "${identifier}"`);
    this.name = "PublisherResultNotFoundError";
    this.identifier = identifier;
  }
}

/**
 * A stored record (found by get() or during list()/findByCarousel()/
 * findByExecution()) could not be parsed as JSON, or parsed but failed
 * schema validation against publisher-result.schema.json.
 */
export class CorruptedPublisherResultError extends Error {
  constructor(identifier, reason) {
    super(`Stored publisher result "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedPublisherResultError";
    this.identifier = identifier;
  }
}

/**
 * The storage adapter itself failed on a read or write — a genuine I/O
 * failure, not a validation problem. The identifier is named; the
 * underlying cause (which may contain a raw host path) is attached as
 * `.cause` for local debugging only, never included in `.message`.
 */
export class PublisherResultPersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for publisher result "${identifier}"`, { cause });
    this.name = "PublisherResultPersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

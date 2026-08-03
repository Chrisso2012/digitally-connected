// DC-003-I015 — structured errors for the Finished Carousel Store, its
// storage-adapter contract, and the Local JSON Storage Adapter.
//
// Every message here is written on the assumption it may be shown to an
// external caller (a CLI user, a future API response) — none of them ever
// interpolate a raw filesystem path, a raw Node error message (which can
// itself contain a path, e.g. ENOENT's own text), or a stack trace. Only
// the canonical carousel identifier (already public, already part of the
// domain object itself) is ever named.

/**
 * A caller handed createFinishedCarouselStore() something that doesn't
 * implement the storage-adapter shape: { name: string, write(identifier,
 * content), read(identifier), list(), exists(identifier) }. Mirrors
 * DC-003-I008's InvalidLedgerStoreError exactly.
 */
export class InvalidCarouselStoreAdapterError extends Error {
  constructor() {
    super(
      "A Finished Carousel Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidCarouselStoreAdapterError";
  }
}

/**
 * The object passed to save()/replace() failed schema validation against
 * finished-carousel.schema.json — a caller-input problem, not a storage
 * problem. `errors` is the same { path, keyword, message, params }[]
 * shape createValidator().validate() returns.
 */
export class InvalidFinishedCarouselError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Finished Carousel failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "InvalidFinishedCarouselError";
    this.errors = errors;
  }
}

/**
 * The identifier is not shaped like a real carousel_id
 * (finished-carousel.schema.json's own `^car_[A-Za-z0-9]+$` pattern) —
 * the one check that stands between an arbitrary caller-supplied string
 * and a filesystem path, blocking path traversal (`../`, absolute paths,
 * separators, null bytes) by construction rather than by denylist.
 */
export class InvalidCarouselIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid carousel identifier — expected the form car_<alphanumeric>`);
    this.name = "InvalidCarouselIdentifierError";
  }
}

/**
 * save() was called for a carousel_id that already has a stored record.
 * save() never overwrites — use replace() for an intentional update.
 */
export class CarouselAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Carousel "${identifier}" already exists in the store — use replace() for an intentional update`);
    this.name = "CarouselAlreadyExistsError";
    this.identifier = identifier;
  }
}

/**
 * get()/replace() referenced a carousel_id with no stored record.
 */
export class CarouselNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored carousel found for identifier "${identifier}"`);
    this.name = "CarouselNotFoundError";
    this.identifier = identifier;
  }
}

/**
 * replace() was called with an explicit target identifier that does not
 * match the supplied Finished Carousel Object's own carousel_id — the
 * defensive check that stops a caller from silently overwriting the
 * wrong stored record.
 */
export class CarouselIdentifierMismatchError extends Error {
  constructor(targetIdentifier, suppliedIdentifier) {
    super(
      `replace() was asked to replace "${targetIdentifier}" but the supplied object's own carousel_id is "${suppliedIdentifier}" — refusing to replace a different record than the one named`
    );
    this.name = "CarouselIdentifierMismatchError";
    this.targetIdentifier = targetIdentifier;
    this.suppliedIdentifier = suppliedIdentifier;
  }
}

/**
 * A stored record (found by get() or during list()) could not be parsed
 * as JSON, or parsed but failed schema validation against
 * finished-carousel.schema.json — the store never returns a corrupted or
 * malformed object silently. Distinct from InvalidFinishedCarouselError,
 * which covers a caller's own input at write time; this covers what was
 * already on disk at read time.
 */
export class CorruptedCarouselError extends Error {
  constructor(identifier, reason) {
    super(`Stored carousel "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedCarouselError";
    this.identifier = identifier;
  }
}

/**
 * The storage adapter itself failed on a read or write — a genuine I/O
 * failure (permissions, disk full, an interrupted atomic-write
 * verification), not a validation problem. The identifier is named; the
 * underlying cause (which may contain a raw host path) is attached as
 * `.cause` for local debugging only, never included in `.message`.
 */
export class CarouselPersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for carousel "${identifier}"`, { cause });
    this.name = "CarouselPersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

// DC-003-I016 — structured errors for the Content Request command: its
// parser, domain object, source resolver, and service.
//
// Two failure tiers, matching every prior milestone's convention:
//   - Request-shape problems (ambiguous command, unsupported design
//     count, schema validation) are the caller's to fix — thrown
//     immediately by content-request-service.mjs, before anything
//     downstream ever runs.
//   - Everything from source resolution onward (unknown source,
//     production failure, persistence failure, duplicate) is caught by
//     the service and folded into a safe Content Request Result instead
//     of thrown — matching DC-003-I012's own Production Workflow "never
//     throws" contract. These classes exist to give that folded-in
//     `result.error` a stable `{ code, message }` shape, not to be
//     thrown past the service boundary in normal operation.

/**
 * A command string didn't match the one supported shape ("Create 6
 * designs based on article GS01") — or wasn't a string/structured request
 * at all. DC-003-I016 does no general-purpose natural-language
 * understanding: an unrecognized phrasing is rejected, never guessed at.
 */
export class AmbiguousContentRequestError extends Error {
  constructor(command, reason) {
    super(`Could not understand content request${typeof command === "string" ? ` "${command}"` : ""} — ${reason}`);
    this.name = "AmbiguousContentRequestError";
  }
}

/**
 * The requested design count is not 6 — the only production contract
 * this platform currently supports. Never silently truncated, duplicated,
 * or reshaped.
 */
export class UnsupportedDesignCountError extends Error {
  constructor(designCount) {
    super(
      `Unsupported design count ${JSON.stringify(designCount)} — the current production contract only supports designCount = 6`
    );
    this.name = "UnsupportedDesignCountError";
    this.designCount = designCount;
  }
}

/**
 * A structured request object failed schema validation against
 * content-request.schema.json — the backstop behind the more specific
 * checks above (e.g. UnsupportedDesignCountError), for any other
 * malformed field. `errors` is the same { path, keyword, message,
 * params }[] shape createValidator().validate() returns.
 */
export class ContentRequestValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Content Request failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "ContentRequestValidationError";
    this.errors = errors;
  }
}

/**
 * No approved source (Topic Package) was found whose existing
 * `backlog_reference_id` matches the requested `sourceReference` — the
 * source simply doesn't exist in the repository yet.
 */
export class UnknownSourceReferenceError extends Error {
  constructor(sourceType, sourceReference) {
    super(`No approved ${sourceType} found for reference "${sourceReference}"`);
    this.name = "UnknownSourceReferenceError";
    this.sourceType = sourceType;
    this.sourceReference = sourceReference;
  }
}

/**
 * Source resolution itself failed mechanically — an unsupported
 * sourceType, an unreadable source directory, or more than one approved
 * source sharing the same reference (ambiguous — the resolver refuses to
 * guess which one was meant). Distinct from UnknownSourceReferenceError,
 * which means "resolution worked, nothing matched."
 */
export class SourceResolutionError extends Error {
  constructor(sourceType, sourceReference, reason) {
    super(`Failed to resolve ${sourceType} reference "${sourceReference}" — ${reason}`);
    this.name = "SourceResolutionError";
    this.sourceType = sourceType;
    this.sourceReference = sourceReference;
  }
}

/**
 * DC-003-I012's Production Workflow ran but did not report a completed,
 * successful result. The underlying safe error (if any) came from the
 * Production Workflow's own already-sanitized `invocationResponse.error`
 * — this class exists for the one case where no such error was even
 * provided.
 */
export class ContentRequestProductionFailedError extends Error {
  constructor(reason) {
    super(`Production workflow did not complete successfully — ${reason}`);
    this.name = "ContentRequestProductionFailedError";
  }
}

/**
 * The Finished Carousel Store (DC-003-I015) rejected the save for a
 * reason other than a duplicate — a genuine storage-adapter failure.
 * Never includes the underlying cause's own message, which could contain
 * a host filesystem path.
 */
export class ContentRequestPersistenceFailedError extends Error {
  constructor(carouselId, reason) {
    super(`Failed to persist Finished Carousel "${carouselId}" — ${reason}`);
    this.name = "ContentRequestPersistenceFailedError";
    this.carouselId = carouselId;
  }
}

/**
 * The Finished Carousel Store (DC-003-I015) already had a record for
 * this carousel_id — save() never overwrites. Maps I015's own
 * CarouselAlreadyExistsError into a Content-Request-level error so
 * nothing I015-specific leaks into this command's result shape.
 */
export class DuplicateStoredCarouselError extends Error {
  constructor(carouselId) {
    super(`Finished Carousel "${carouselId}" was already stored — refusing to overwrite`);
    this.name = "DuplicateStoredCarouselError";
    this.carouselId = carouselId;
  }
}

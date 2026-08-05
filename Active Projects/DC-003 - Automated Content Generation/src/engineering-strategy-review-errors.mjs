// DC-003-I029.3 — structured errors for the Engineering Strategy Review
// domain object, its Storage Adapter contract, and its Local JSON Storage
// Adapter. Mirrors engineering-work-order-errors.mjs's own precedent.
// Every message here is written on the assumption it may be shown to an
// external caller — never a raw filesystem path or a raw Node error
// message.

export class InvalidEngineeringStrategyReviewInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidEngineeringStrategyReviewInputError";
  }
}

export class EngineeringStrategyReviewValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Engineering Strategy Review failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "EngineeringStrategyReviewValidationError";
    this.errors = errors;
  }
}

export class InvalidEngineeringStrategyReviewStoreAdapterError extends Error {
  constructor() {
    super(
      "An Engineering Strategy Review Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidEngineeringStrategyReviewStoreAdapterError";
  }
}

export class InvalidEngineeringStrategyReviewIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid strategy review identifier — expected the form esr_<alphanumeric>`);
    this.name = "InvalidEngineeringStrategyReviewIdentifierError";
  }
}

export class EngineeringStrategyReviewAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Engineering Strategy Review "${identifier}" already exists in the store — reviews are never overwritten`);
    this.name = "EngineeringStrategyReviewAlreadyExistsError";
    this.identifier = identifier;
  }
}

export class EngineeringStrategyReviewNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored Engineering Strategy Review found for identifier "${identifier}"`);
    this.name = "EngineeringStrategyReviewNotFoundError";
    this.identifier = identifier;
  }
}

export class CorruptedEngineeringStrategyReviewError extends Error {
  constructor(identifier, reason) {
    super(`Stored Engineering Strategy Review "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedEngineeringStrategyReviewError";
    this.identifier = identifier;
  }
}

export class EngineeringStrategyReviewPersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for Engineering Strategy Review "${identifier}"`, { cause });
    this.name = "EngineeringStrategyReviewPersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

/**
 * A Delivery Report already has a stored Strategy Review — this store
 * never allows a second one for the same Delivery Report (no versioning
 * exists yet; see this milestone's own brief).
 */
export class DuplicateDeliveryReportReviewError extends Error {
  constructor(deliveryReportId, existingReviewId) {
    super(`Delivery Report "${deliveryReportId}" already has a Strategy Review ("${existingReviewId}") — it is not reviewed again`);
    this.name = "DuplicateDeliveryReportReviewError";
    this.deliveryReportId = deliveryReportId;
    this.existingReviewId = existingReviewId;
  }
}

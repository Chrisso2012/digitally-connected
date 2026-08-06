// DC-003-I030 — structured errors for the Ingested Content domain object,
// its Storage Adapter contract, and its Local JSON Storage Adapter.
// Mirrors engineering-work-order-errors.mjs's own precedent of combining
// domain-object and store errors in one file. Every message here is
// written on the assumption it may be shown to an external caller — never
// a raw filesystem path or a raw Node error message.

export class InvalidIngestedContentInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidIngestedContentInputError";
  }
}

export class IngestedContentValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Ingested Content failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "IngestedContentValidationError";
    this.errors = errors;
  }
}

export class InvalidIngestedContentStoreAdapterError extends Error {
  constructor() {
    super(
      "An Ingested Content Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidIngestedContentStoreAdapterError";
  }
}

export class InvalidIngestedContentIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid ingested content identifier — expected the form ic_<alphanumeric>`);
    this.name = "InvalidIngestedContentIdentifierError";
  }
}

export class IngestedContentAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Ingested Content "${identifier}" already exists in the store — records are never overwritten`);
    this.name = "IngestedContentAlreadyExistsError";
    this.identifier = identifier;
  }
}

export class IngestedContentNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored Ingested Content found for identifier "${identifier}"`);
    this.name = "IngestedContentNotFoundError";
    this.identifier = identifier;
  }
}

export class CorruptedIngestedContentError extends Error {
  constructor(identifier, reason) {
    super(`Stored Ingested Content "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedIngestedContentError";
    this.identifier = identifier;
  }
}

export class IngestedContentPersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for Ingested Content "${identifier}"`, { cause });
    this.name = "IngestedContentPersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

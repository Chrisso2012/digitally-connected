// DC-003-I031 — structured errors for the Editorial Package domain
// object, its Storage Adapter contract, and its Local JSON Storage
// Adapter. Mirrors ingested-content-errors.mjs's own precedent of
// combining domain-object and store errors in one file. Every message
// here is written on the assumption it may be shown to an external
// caller — never a raw filesystem path or a raw Node error message.

export class InvalidEditorialPackageInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidEditorialPackageInputError";
  }
}

export class EditorialPackageValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Editorial Package failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "EditorialPackageValidationError";
    this.errors = errors;
  }
}

export class InvalidEditorialPackageStoreAdapterError extends Error {
  constructor() {
    super(
      "An Editorial Package Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidEditorialPackageStoreAdapterError";
  }
}

export class InvalidEditorialPackageIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid editorial package identifier — expected the form ep_<alphanumeric>`);
    this.name = "InvalidEditorialPackageIdentifierError";
  }
}

export class EditorialPackageAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Editorial Package "${identifier}" already exists in the store — records are never overwritten`);
    this.name = "EditorialPackageAlreadyExistsError";
    this.identifier = identifier;
  }
}

export class EditorialPackageNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored Editorial Package found for identifier "${identifier}"`);
    this.name = "EditorialPackageNotFoundError";
    this.identifier = identifier;
  }
}

export class CorruptedEditorialPackageError extends Error {
  constructor(identifier, reason) {
    super(`Stored Editorial Package "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedEditorialPackageError";
    this.identifier = identifier;
  }
}

export class EditorialPackagePersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for Editorial Package "${identifier}"`, { cause });
    this.name = "EditorialPackagePersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

// --- Service-layer errors (editorial-package-generator.mjs) ---------

export class DuplicateEditorialPackageError extends Error {
  constructor(ingestedContentId, existingEditorialPackageId) {
    super(`Ingested Content "${ingestedContentId}" already has an Editorial Package (see "${existingEditorialPackageId}") — not generated again`);
    this.name = "DuplicateEditorialPackageError";
    this.ingestedContentId = ingestedContentId;
    this.existingEditorialPackageId = existingEditorialPackageId;
  }
}

export class EditorialPackageGenerationFailedError extends Error {
  constructor(attempts, maxAttempts) {
    const summary = attempts.map((attempt, index) => `  attempt ${index + 1}: [${attempt.stage}] ${attempt.message}`).join("\n");
    super(`Editorial Package generation failed after ${attempts.length}/${maxAttempts} attempt(s) — required editorial fields could not be generated:\n${summary}`);
    this.name = "EditorialPackageGenerationFailedError";
    this.attempts = attempts;
    this.maxAttempts = maxAttempts;
  }
}

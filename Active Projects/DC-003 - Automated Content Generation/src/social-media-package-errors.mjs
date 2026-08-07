// DC-003-I032 — structured errors for the Social Media Package domain
// object, its Storage Adapter contract, and its Local JSON Storage
// Adapter. Mirrors editorial-package-errors.mjs's own precedent of
// combining domain-object, store, and service errors in one file. Every
// message here is written on the assumption it may be shown to an
// external caller — never a raw filesystem path or a raw Node error
// message.

export class InvalidSocialMediaPackageInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidSocialMediaPackageInputError";
  }
}

export class SocialMediaPackageValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Social Media Package failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "SocialMediaPackageValidationError";
    this.errors = errors;
  }
}

export class InvalidSocialMediaPackageStoreAdapterError extends Error {
  constructor() {
    super(
      "A Social Media Package Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidSocialMediaPackageStoreAdapterError";
  }
}

export class InvalidSocialMediaPackageIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid social media package identifier — expected the form sm_<alphanumeric>`);
    this.name = "InvalidSocialMediaPackageIdentifierError";
  }
}

export class SocialMediaPackageAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Social Media Package "${identifier}" already exists in the store — records are never overwritten`);
    this.name = "SocialMediaPackageAlreadyExistsError";
    this.identifier = identifier;
  }
}

export class SocialMediaPackageNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored Social Media Package found for identifier "${identifier}"`);
    this.name = "SocialMediaPackageNotFoundError";
    this.identifier = identifier;
  }
}

export class CorruptedSocialMediaPackageError extends Error {
  constructor(identifier, reason) {
    super(`Stored Social Media Package "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedSocialMediaPackageError";
    this.identifier = identifier;
  }
}

export class SocialMediaPackagePersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for Social Media Package "${identifier}"`, { cause });
    this.name = "SocialMediaPackagePersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

// --- Service-layer errors (social-media-package-generator.mjs) ------

export class DuplicateSocialMediaPackageError extends Error {
  constructor(editorialPackageId, existingSocialMediaPackageId) {
    super(`Editorial Package "${editorialPackageId}" already has a Social Media Package (see "${existingSocialMediaPackageId}") — not generated again`);
    this.name = "DuplicateSocialMediaPackageError";
    this.editorialPackageId = editorialPackageId;
    this.existingSocialMediaPackageId = existingSocialMediaPackageId;
  }
}

export class SocialMediaPackageGenerationFailedError extends Error {
  constructor(attempts, maxAttempts) {
    const summary = attempts.map((attempt, index) => `  attempt ${index + 1}: [${attempt.stage}] ${attempt.message}`).join("\n");
    super(`Social Media Package generation failed after ${attempts.length}/${maxAttempts} attempt(s) — required platform content could not be generated:\n${summary}`);
    this.name = "SocialMediaPackageGenerationFailedError";
    this.attempts = attempts;
    this.maxAttempts = maxAttempts;
  }
}

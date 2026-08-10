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

// DC-003-I032.7 — a record's own declared schema_version names a
// version this store has neither an archived historical schema for nor
// matches the current live schema. Deliberately distinct from
// CorruptedSocialMediaPackageError: this is "we don't recognise the
// contract this record claims to have been written under," not "this
// record fails the contract it claims" — the same distinction
// validator.mjs's own UnknownSchemaError already draws for an
// unregistered schema identifier, applied here to an unrecognised
// schema VERSION of one already-known schema.
export class UnsupportedSchemaVersionError extends Error {
  constructor(identifier, version, knownVersions) {
    super(`Stored Social Media Package "${identifier}" declares schema_version "${version}", which is not among the known versions (${knownVersions.join(", ")})`);
    this.name = "UnsupportedSchemaVersionError";
    this.identifier = identifier;
    this.version = version;
    this.knownVersions = knownVersions;
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

// --- DC-003-I032.8 — Revision/Supersession Lineage errors -------------
// Thrown by reviseSocialMediaPackage() (social-media-package-generator.mjs)
// and social-media-package-lineage.mjs's own deriveLineage(). Every one
// of these is a distinct, explicit safety-rule failure — none of them is
// ever bypassable by a flag; the only recovery path is a fresh, correct
// revise call naming the actual current latest revision.

export class CrossEditorialPackageSupersessionError extends Error {
  constructor(editorialPackageId, supersededSocialMediaPackageId, actualEditorialPackageId) {
    super(
      `Cannot revise for Editorial Package "${editorialPackageId}": the Social Media Package being superseded ("${supersededSocialMediaPackageId}") belongs to a different Editorial Package ("${actualEditorialPackageId}")`
    );
    this.name = "CrossEditorialPackageSupersessionError";
    this.editorialPackageId = editorialPackageId;
    this.supersededSocialMediaPackageId = supersededSocialMediaPackageId;
    this.actualEditorialPackageId = actualEditorialPackageId;
  }
}

export class NotLatestRevisionError extends Error {
  constructor(supersededSocialMediaPackageId, actualLatestSocialMediaPackageId) {
    super(
      `Cannot revise "${supersededSocialMediaPackageId}": it is not the latest revision in its lineage (the current latest is ${
        actualLatestSocialMediaPackageId ? `"${actualLatestSocialMediaPackageId}"` : "unknown — the lineage could not be resolved"
      }) — only the latest revision may be superseded, so a second revision can never fork from an earlier one`
    );
    this.name = "NotLatestRevisionError";
    this.supersededSocialMediaPackageId = supersededSocialMediaPackageId;
    this.actualLatestSocialMediaPackageId = actualLatestSocialMediaPackageId;
  }
}

export class MalformedSocialMediaPackageLineageError extends Error {
  constructor(editorialPackageId, reason) {
    super(`Social Media Package revision lineage for Editorial Package "${editorialPackageId}" is malformed — ${reason}`);
    this.name = "MalformedSocialMediaPackageLineageError";
    this.editorialPackageId = editorialPackageId;
    this.reason = reason;
  }
}

// --- DC-003-I032.9 — Slide-Field Correction errors ---------------------
// Thrown by correctSocialMediaPackageSlideField() (social-media-package-correction.mjs)
// and social-media-package-store.mjs's own replace(). Mirrors carousel-approval-errors.mjs's
// own two-tier split: "the requested correction is not legal/well-formed"
// (thrown before any mutation is attempted) vs. "the assembled object
// still fails schema validation." None of these has a bypass — a
// capacity violation can only be resolved with genuinely shorter
// replacement text, never a flag that skips the check.

export class InvalidSocialMediaPackageCorrectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidSocialMediaPackageCorrectionError";
  }
}

export class SocialMediaPackageCorrectionCapacityExceededError extends Error {
  constructor({ socialMediaPackageId, slideNumber, slideRole, field, length, maxChars }) {
    super(
      `Correction rejected for "${socialMediaPackageId}" slide ${slideNumber} (${slideRole}) field "${field}": replacement text is ${length} character(s), exceeding the Template Capacity Contract's canonical limit of ${maxChars} — the limit itself is never modified, only shorter replacement text is accepted`
    );
    this.name = "SocialMediaPackageCorrectionCapacityExceededError";
    this.socialMediaPackageId = socialMediaPackageId;
    this.slideNumber = slideNumber;
    this.slideRole = slideRole;
    this.field = field;
    this.length = length;
    this.maxChars = maxChars;
  }
}

export class SocialMediaPackageIdentifierMismatchError extends Error {
  constructor(targetIdentifier, suppliedIdentifier) {
    super(
      `replace() was asked to replace "${targetIdentifier}" but the supplied object's own social_media_package_id is "${suppliedIdentifier}" — refusing to replace a different record than the one named`
    );
    this.name = "SocialMediaPackageIdentifierMismatchError";
    this.targetIdentifier = targetIdentifier;
    this.suppliedIdentifier = suppliedIdentifier;
  }
}

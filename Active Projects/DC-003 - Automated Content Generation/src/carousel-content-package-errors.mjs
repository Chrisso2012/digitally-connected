// DC-003-I032.10.1 — structured errors for the Carousel Content Package
// domain object, its Storage Adapter contract, and its Local JSON
// Storage Adapter. Mirrors editorial-package-errors.mjs's own precedent
// of combining domain-object and store errors in one file. Every
// message here is written on the assumption it may be shown to an
// external caller — never a raw filesystem path or a raw Node error
// message.

export class InvalidCarouselContentPackageInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidCarouselContentPackageInputError";
  }
}

export class CarouselContentPackageValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Carousel Content Package failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "CarouselContentPackageValidationError";
    this.errors = errors;
  }
}

// DC-003-I032.10.1 — the mechanical emphasis-phrase check
// (carousel-content-package-emphasis.mjs) failed: either the phrase does
// not appear (normalised) in its own slide's text, or two instructions
// on the same slide have overlapping matched ranges. Thrown before any
// record is assembled — never silently resolved.
export class EmphasisPhraseNotFoundError extends Error {
  constructor(slideNumber, phrase) {
    super(`Slide ${slideNumber}: emphasis phrase ${JSON.stringify(phrase)} was not found (after normalisation) in that slide's own headline/body — Claude Code never substitutes or guesses an alternative phrase`);
    this.name = "EmphasisPhraseNotFoundError";
    this.slideNumber = slideNumber;
    this.phrase = phrase;
  }
}

export class ConflictingEmphasisInstructionsError extends Error {
  constructor(slideNumber, phraseA, phraseB) {
    super(`Slide ${slideNumber}: emphasis phrases ${JSON.stringify(phraseA)} and ${JSON.stringify(phraseB)} overlap in that slide's own text — conflicting emphasis instructions are rejected, never resolved creatively`);
    this.name = "ConflictingEmphasisInstructionsError";
    this.slideNumber = slideNumber;
    this.phraseA = phraseA;
    this.phraseB = phraseB;
  }
}

export class InvalidCarouselContentPackageStoreAdapterError extends Error {
  constructor() {
    super(
      "A Carousel Content Package Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidCarouselContentPackageStoreAdapterError";
  }
}

export class InvalidCarouselContentPackageIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid carousel content package identifier — expected the form ccp_<alphanumeric>`);
    this.name = "InvalidCarouselContentPackageIdentifierError";
  }
}

export class CarouselContentPackageAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Carousel Content Package "${identifier}" already exists in the store — records are never overwritten`);
    this.name = "CarouselContentPackageAlreadyExistsError";
    this.identifier = identifier;
  }
}

export class CarouselContentPackageNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored Carousel Content Package found for identifier "${identifier}"`);
    this.name = "CarouselContentPackageNotFoundError";
    this.identifier = identifier;
  }
}

export class CorruptedCarouselContentPackageError extends Error {
  constructor(identifier, reason) {
    super(`Stored Carousel Content Package "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedCarouselContentPackageError";
    this.identifier = identifier;
  }
}

export class CarouselContentPackagePersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for Carousel Content Package "${identifier}"`, { cause });
    this.name = "CarouselContentPackagePersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

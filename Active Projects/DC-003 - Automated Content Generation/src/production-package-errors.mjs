// DC-003-I033 — structured errors for the Production Package domain
// object, its Storage Adapter contract, its Local JSON Storage Adapter,
// and the Production Package Generator service. Mirrors
// social-media-package-errors.mjs's own precedent of combining
// domain-object, store, and service errors in one file. Every message
// here is written on the assumption it may be shown to an external
// caller — never a raw filesystem path or a raw Node error message.

export class InvalidProductionPackageInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidProductionPackageInputError";
  }
}

export class ProductionPackageValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Production Package failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "ProductionPackageValidationError";
    this.errors = errors;
  }
}

export class InvalidProductionPackageStoreAdapterError extends Error {
  constructor() {
    super(
      "A Production Package Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidProductionPackageStoreAdapterError";
  }
}

export class InvalidProductionPackageIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid production package identifier — expected the form pp_<alphanumeric>`);
    this.name = "InvalidProductionPackageIdentifierError";
  }
}

export class ProductionPackageAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Production Package "${identifier}" already exists in the store — records are never overwritten`);
    this.name = "ProductionPackageAlreadyExistsError";
    this.identifier = identifier;
  }
}

export class ProductionPackageNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored Production Package found for identifier "${identifier}"`);
    this.name = "ProductionPackageNotFoundError";
    this.identifier = identifier;
  }
}

export class CorruptedProductionPackageError extends Error {
  constructor(identifier, reason) {
    super(`Stored Production Package "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedProductionPackageError";
    this.identifier = identifier;
  }
}

export class ProductionPackagePersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for Production Package "${identifier}"`, { cause });
    this.name = "ProductionPackagePersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

// --- Renderer Adapter errors (production-package-renderer-adapter.mjs,
// templated-renderer-adapter.mjs) ------------------------------------

export class InvalidRendererAdapterError extends Error {
  constructor() {
    super(
      "A Renderer Adapter must be shaped { name: string, renderer: string, buildSlideSequence(socialMediaPackage): object, mapToRendererPayload(productionPackage): array }"
    );
    this.name = "InvalidRendererAdapterError";
  }
}

export class RequiredRendererMappingMissingError extends Error {
  constructor(renderer, slideNumber, field) {
    super(`Renderer "${renderer}" could not populate required mapping "${field}" for slide ${slideNumber}`);
    this.name = "RequiredRendererMappingMissingError";
    this.renderer = renderer;
    this.slideNumber = slideNumber;
    this.field = field;
  }
}

export class InvalidTemplateMappingError extends Error {
  constructor(renderer, templateKey) {
    super(`Renderer "${renderer}" has no known template mapping for "${templateKey}"`);
    this.name = "InvalidTemplateMappingError";
    this.renderer = renderer;
    this.templateKey = templateKey;
  }
}

// DC-003-I033.1 — thrown by createProductionPackage() when any slide's
// text exceeds its real, geometry-derived Template Capacity Contract
// limit (template-capacity-contract.mjs). Deterministic, pre-render,
// never silently truncated/rewritten/shrunk — the whole point of this
// milestone. `violations` names every offending field with its actual
// length and real limit (never the offending string content itself —
// this error must be safe to log).
export class TemplateCapacityExceededError extends Error {
  constructor(violations) {
    const summary = violations
      .map((v) => `  - slide ${v.slideIndex + 1} (${v.slideRole}) ${v.field}: ${v.maxItems != null ? `${v.length} items (max ${v.maxItems})` : `${v.length} chars (max ${v.maxChars})`}`)
      .join("\n");
    super(`Content exceeds the Template Capacity Contract for ${violations.length} field(s):\n${summary}`);
    this.name = "TemplateCapacityExceededError";
    this.violations = violations;
  }
}

// --- Service-layer errors (production-package-generator.mjs) --------

export class DuplicateProductionPackageError extends Error {
  constructor(socialMediaPackageId, existingProductionPackageId) {
    super(
      `Social Media Package "${socialMediaPackageId}" already has a Production Package (see "${existingProductionPackageId}") — not generated again`
    );
    this.name = "DuplicateProductionPackageError";
    this.socialMediaPackageId = socialMediaPackageId;
    this.existingProductionPackageId = existingProductionPackageId;
  }
}

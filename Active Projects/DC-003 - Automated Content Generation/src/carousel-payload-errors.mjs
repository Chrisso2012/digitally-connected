// DC-003-I005 — structured errors for the Carousel Payload Mapper.
// Five distinct failure modes, each its own class so callers can
// `instanceof`-check rather than parse message strings.

export class UnknownTemplateError extends Error {
  constructor(slideType) {
    super(`No template is registered for slide_type "${slideType}"`);
    this.name = "UnknownTemplateError";
    this.slideType = slideType;
  }
}

export class MissingLayerError extends Error {
  constructor(slideType, layerName, contentField) {
    super(
      `slide_type "${slideType}": required layer "${layerName}" could not be populated` +
        (contentField ? ` (source content field "${contentField}" is missing or blank)` : "")
    );
    this.name = "MissingLayerError";
    this.slideType = slideType;
    this.layerName = layerName;
    this.contentField = contentField ?? null;
  }
}

export class DuplicateLayerMappingError extends Error {
  constructor(slideType, layerName, message) {
    super(message ?? `slide_type "${slideType}": layer "${layerName}" was assigned more than once`);
    this.name = "DuplicateLayerMappingError";
    this.slideType = slideType;
    this.layerName = layerName ?? null;
  }
}

export class UnsupportedContentError extends Error {
  constructor(slideType, field, reason) {
    super(`slide_type "${slideType}": content field "${field}" is unsupported — ${reason}`);
    this.name = "UnsupportedContentError";
    this.slideType = slideType;
    this.field = field;
  }
}

/**
 * The assembled Templated Payload Object failed schema validation via the
 * I002 runtime. `errors` is the same { path, keyword, message, params }[]
 * shape createValidator().validate() returns.
 */
export class TemplatedPayloadValidationError extends Error {
  constructor(slideType, errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(
      `slide_type "${slideType}": assembled Templated Payload failed schema validation with ${errors.length} error(s):\n${summary}`
    );
    this.name = "TemplatedPayloadValidationError";
    this.slideType = slideType;
    this.errors = errors;
  }
}

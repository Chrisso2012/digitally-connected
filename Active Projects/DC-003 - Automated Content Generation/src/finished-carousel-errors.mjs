// DC-003-I007 — structured errors for the Finished Carousel Builder.
// Two distinct failure modes, consistent with how DC-003-I005's Payload
// Mapper separates "the inputs I was given don't compose" from "the object
// I assembled still fails schema validation."

/**
 * A required input was missing, malformed, or mutually inconsistent with
 * another input (wrong slide order, a render whose templateId doesn't
 * match its own payload's template_id, etc.) — thrown before schema
 * validation is even attempted. This is the builder's "fail fast if any
 * dependency is invalid" guarantee.
 */
export class FinishedCarouselCompositionError extends Error {
  constructor(message) {
    super(message);
    this.name = "FinishedCarouselCompositionError";
  }
}

/**
 * Every composition check passed, but the assembled object still failed
 * schema validation via the I002 runtime. `errors` is the same
 * { path, keyword, message, params }[] shape createValidator().validate()
 * returns.
 */
export class FinishedCarouselValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Assembled Finished Carousel failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "FinishedCarouselValidationError";
    this.errors = errors;
  }
}

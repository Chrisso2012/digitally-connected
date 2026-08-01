// DC-003-I010 — Invocation Request: validates and prepares an inbound
// external request before any pipeline work begins. Has its own JSON
// Schema (invocation-request.schema.json), so — like TopicPackage,
// CarouselContent, TemplatedPayload, FinishedCarousel, and ExecutionRecord
// before it — its field names are snake_case, matching the schema
// directly, rather than a camelCase JS convenience shape translated at
// some other boundary.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvocationRequestValidationError } from "./invocation-errors.mjs";

/**
 * Validates `rawRequest` against invocation-request.schema.json and
 * returns an immutable copy. Throws InvocationRequestValidationError
 * immediately for any missing or malformed field, including a
 * topic_package_reference that supplies both file_path and data, or
 * neither — request validation always completes, one way or the other,
 * before any pipeline work begins.
 *
 * options.validator — inject a pre-built validator instead of constructing
 *   a new one.
 */
export function prepareInvocationRequest(rawRequest, options = {}) {
  const validator = options.validator ?? createValidator(options);
  const validation = validator.validate("invocationRequest", rawRequest);
  if (!validation.valid) {
    throw new InvocationRequestValidationError(validation.errors);
  }
  return deepFreezeClone(rawRequest);
}

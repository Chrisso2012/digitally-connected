// DC-003-I010 — Invocation Response: the External Invocation Adapter's
// one public outbound contract. Has its own JSON Schema
// (invocation-response.schema.json), so its field names are snake_case,
// matching the schema directly — the same convention every other
// schema-backed domain object in this codebase already follows.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvocationResponseValidationError } from "./invocation-errors.mjs";

/**
 * Builds and schema-validates an immutable InvocationResponse.
 *
 * fields.accepted, fields.status — required; every other field defaults
 * to null/empty when omitted, since not every outcome populates every
 * field (a rejected request has no execution_id or finished_carousel).
 *
 * options.validator — inject a pre-built validator instead of constructing
 *   a new one.
 *
 * Throws InvocationResponseValidationError if the assembled response is
 * still schema-invalid — this is invocation-adapter.mjs's own safety net
 * against assembling a malformed response, not a caller-facing failure
 * mode.
 */
export function createInvocationResponse(fields, options = {}) {
  const validator = options.validator ?? createValidator(options);

  const response = {
    accepted: fields.accepted,
    request_id: fields.request_id ?? null,
    execution_id: fields.execution_id ?? null,
    status: fields.status,
    finished_carousel: fields.finished_carousel ?? null,
    warnings: fields.warnings ?? [],
    error: fields.error ?? null,
    correlation_metadata: fields.correlation_metadata ?? null,
  };

  const validation = validator.validate("invocationResponse", response);
  if (!validation.valid) {
    throw new InvocationResponseValidationError(validation.errors);
  }

  return deepFreezeClone(response);
}

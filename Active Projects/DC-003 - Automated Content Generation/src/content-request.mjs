// DC-003-I016 — Content Request domain object factory.
//
// Builds and validates the immutable Content Request object
// (content-request.schema.json) — the same "assemble, then validate,
// then deep-freeze" discipline every other domain-object factory in this
// codebase already applies to itself (execution-metadata.mjs,
// execution-record.mjs, finished-carousel-builder.mjs).
//
// request_id is generated here, independently of executionId/carouselId/
// sourceReference — the I016 brief explicitly requires a distinct
// request identifier that reuses none of those. Time and ID generation
// are both injectable, for deterministic tests.

import { randomUUID } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { ContentRequestValidationError } from "./content-request-errors.mjs";

function generateRequestId() {
  return "req_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Builds an immutable Content Request from already-parsed fields (the
 * output of parseContentRequestCommand(), or an equivalent structured
 * object supplied directly).
 *
 * fields.action — "create" (the only supported action for I016).
 * fields.designCount — must be 6 (the only supported production
 *   contract) — enforced both by the schema's own enum and, with a more
 *   specific error, by content-request-service.mjs before this factory
 *   is even called.
 * fields.sourceType — "article" (the only supported source type).
 * fields.sourceReference — the external reference to resolve (e.g.
 *   "GS01").
 * fields.rawCommand — the original command string, if any, for
 *   traceability. Null for a directly-constructed structured request.
 *
 * options.now — override the clock (used by tests).
 * options.idGenerator — override request_id generation (used by tests).
 * options.validator — inject a pre-built validator.
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws ContentRequestValidationError if the assembled object fails
 * schema validation.
 */
export function createContentRequest(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateRequestId;
  const validator = options.validator ?? createValidator(options);

  const contentRequest = {
    request_id: idGenerator(),
    action: fields.action,
    design_count: fields.designCount,
    source_type: fields.sourceType,
    source_reference: fields.sourceReference,
    requested_at: now(),
    raw_command: fields.rawCommand ?? null,
  };

  const validation = validator.validate("contentRequest", contentRequest);
  if (!validation.valid) {
    throw new ContentRequestValidationError(validation.errors);
  }

  return deepFreezeClone(contentRequest);
}

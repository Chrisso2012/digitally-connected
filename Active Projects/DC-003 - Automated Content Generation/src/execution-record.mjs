// DC-003-I008 — ExecutionRecord: one immutable event in the Execution
// Ledger, the platform's operational audit layer. Records HOW the system
// executed (this event), independent of WHAT it produced — see
// finished-carousel-builder.mjs for the latter.
//
// Unlike RenderResult/ExecutionMetadata (DC-003-I006/I007's own invented,
// schema-less domain objects), ExecutionRecord has its own JSON Schema
// (execution-record.schema.json), the same way TopicPackage/CarouselContent/
// TemplatedPayload/FinishedCarousel do — so its field names are snake_case,
// matching the schema exactly, rather than a camelCase JS convenience shape
// translated later at some other boundary.
//
// Determinism: per the DC-003-I008 brief's own example signature,
// createExecutionRecord(input, { clock, idGenerator }) — note the option
// names (`clock`, `idGenerator`) deliberately differ from the `now`
// convention every earlier DC-003 factory uses, since the brief specified
// this exact shape.

import { randomUUID } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { ExecutionRecordValidationError } from "./execution-ledger-errors.mjs";

export function generateRecordId() {
  return "rec_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Builds an immutable, schema-validated ExecutionRecord.
 *
 * fields — snake_case, matching execution-record.schema.json directly:
 *   execution_id, sequence, event_type, status (all required), plus
 *   optional stage/source/data/diagnostics (default null when omitted).
 *   record_id/occurred_at are generated automatically when omitted.
 *
 * options.clock — () => ISO date-time string, used for occurred_at when
 *   fields.occurred_at is omitted. Defaults to the real clock.
 * options.idGenerator — () => string, used for record_id when
 *   fields.record_id is omitted. Defaults to generateRecordId().
 * options.validator — inject a pre-built validator instead of constructing
 *   a new one.
 *
 * This factory validates only ONE record's own shape — including that
 * `sequence` is a positive integer — but cannot detect a duplicate or
 * out-of-order sequence relative to other records for the same execution,
 * since it has no visibility into siblings. That check belongs to
 * execution-ledger.mjs's appendRecord(), the only place with access to a
 * store's existing records.
 *
 * Throws ExecutionRecordValidationError immediately for any missing or
 * malformed field — including a diagnostics field outside the schema's
 * allowlist (error_category, error_code, retryable, attempt, field_path,
 * safe_message) — no silent coercion.
 */
export function createExecutionRecord(fields = {}, options = {}) {
  const clock = options.clock ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateRecordId;
  const validator = options.validator ?? createValidator(options);

  const record = {
    record_id: fields.record_id ?? idGenerator(),
    execution_id: fields.execution_id,
    sequence: fields.sequence,
    event_type: fields.event_type,
    status: fields.status,
    stage: fields.stage ?? null,
    occurred_at: fields.occurred_at ?? clock(),
    source: fields.source ?? null,
    data: fields.data ?? null,
    diagnostics: fields.diagnostics ?? null,
  };

  const validation = validator.validate("executionRecord", record);
  if (!validation.valid) {
    throw new ExecutionRecordValidationError(validation.errors);
  }

  return deepFreezeClone(record);
}

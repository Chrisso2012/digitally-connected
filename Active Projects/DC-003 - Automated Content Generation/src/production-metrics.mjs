// DC-003-I023 — Production Metrics domain object factory. Mirrors the
// "assemble, then validate, then deep-freeze" discipline every other
// domain-object factory in this codebase already applies to itself
// (execution-metadata.mjs, execution-record.mjs, finished-carousel-builder.mjs,
// content-request.mjs) — composition only, no filesystem APIs, no
// provider-specific SDKs, no HTTP.
//
// This module never invents evidence: every field it accepts is exactly
// what the caller (production-metrics-collector.mjs) already computed
// from a Production Run Result / Export Result / Publish Result / cost
// calculation — this factory's own job is narrower: apply the shared
// validation/immutability/ID-generation discipline, and nothing else.

import { randomUUID } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { ProductionMetricsValidationError, InvalidProductionMetricsInputError } from "./production-metrics-errors.mjs";

function generateMetricsId() {
  return "met_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonNegativeNumberOrNull(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function checkRequests(requests) {
  if (
    !requests ||
    !isNonNegativeInteger(requests.anthropic) ||
    !isNonNegativeInteger(requests.templated) ||
    !isNonNegativeInteger(requests.googleDrive)
  ) {
    throw new InvalidProductionMetricsInputError(
      "fields.requests must be { anthropic, templated, googleDrive }, each a non-negative integer"
    );
  }
}

function checkDurations(durationsMs) {
  if (
    !durationsMs ||
    !isNonNegativeNumberOrNull(durationsMs.generation) ||
    !isNonNegativeNumberOrNull(durationsMs.render) ||
    !isNonNegativeNumberOrNull(durationsMs.export) ||
    !isNonNegativeNumberOrNull(durationsMs.publish) ||
    !isNonNegativeNumberOrNull(durationsMs.total)
  ) {
    throw new InvalidProductionMetricsInputError(
      "fields.durationsMs must be { generation, render, export, publish, total }, each a non-negative number or null — never negative, never invented"
    );
  }
}

function checkOutputs(outputs) {
  if (
    !outputs ||
    !isNonNegativeInteger(outputs.slidesGenerated) ||
    !isNonNegativeInteger(outputs.slidesRendered) ||
    !isNonNegativeInteger(outputs.filesExported) ||
    !isNonNegativeInteger(outputs.filesPublished)
  ) {
    throw new InvalidProductionMetricsInputError(
      "fields.outputs must be { slidesGenerated, slidesRendered, filesExported, filesPublished }, each a non-negative integer"
    );
  }
}

function checkProviderCost(cost, label) {
  if (
    !cost ||
    typeof cost.amount !== "number" ||
    !Number.isFinite(cost.amount) ||
    cost.amount < 0 ||
    !["estimated", "unavailable", "actual"].includes(cost.calculationType)
  ) {
    throw new InvalidProductionMetricsInputError(
      `fields.costs.${label} must be { amount: a non-negative number, calculationType: "estimated" | "unavailable" | "actual" }`
    );
  }
}

function checkCosts(costs) {
  if (!costs || typeof costs.currency !== "string" || costs.currency.trim().length !== 3) {
    throw new InvalidProductionMetricsInputError('fields.costs.currency must be a 3-letter currency code (e.g. "USD")');
  }
  checkProviderCost(costs.anthropic, "anthropic");
  checkProviderCost(costs.templated, "templated");
  checkProviderCost(costs.googleDrive, "googleDrive");
  if (typeof costs.total !== "number" || !Number.isFinite(costs.total) || costs.total < 0) {
    throw new InvalidProductionMetricsInputError("fields.costs.total must be a non-negative number");
  }
}

/**
 * Builds an immutable Production Metrics Record from already-collected
 * evidence — composition only, never invents a field.
 *
 * fields.requestId — required, non-empty string.
 * fields.executionId — required (may be null for a very early failure).
 * fields.carouselContentId / carouselId — required for a "completed"
 *   status, must be null (not merely omitted) for "failed" if the run
 *   never reached that point — matches production-metrics.schema.json's
 *   own oneOf split.
 * fields.status — required, "completed" | "failed".
 * fields.requests — required, { anthropic, templated, googleDrive } —
 *   each a non-negative integer count.
 * fields.durationsMs — required, { generation, render, export, publish,
 *   total } — each a non-negative number or `null` when genuinely not
 *   tracked (never a guessed value).
 * fields.outputs — required, { slidesGenerated, slidesRendered,
 *   filesExported, filesPublished } — each a non-negative integer.
 * fields.costs — required, { currency, anthropic, templated, googleDrive,
 *   total } — each provider cost is { amount, calculationType }.
 *
 * options.now — override the clock (used by tests); defaults to
 *   () => new Date().toISOString().
 * options.idGenerator — override metrics_id generation (used by tests).
 * options.validator — inject a pre-built validator.
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidProductionMetricsInputError immediately for a
 * structurally malformed input (negative counts/durations/costs, a
 * missing sub-object) — a caller bug, not a real production-accounting
 * problem. Throws ProductionMetricsValidationError if the assembled
 * object still fails schema validation despite passing every composition
 * check above.
 */
export function createProductionMetrics(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateMetricsId;
  const validator = options.validator ?? createValidator(options);

  if (typeof fields.requestId !== "string" || fields.requestId.trim() === "") {
    throw new InvalidProductionMetricsInputError("fields.requestId is required and must be a non-empty string");
  }
  if (!["completed", "failed"].includes(fields.status)) {
    throw new InvalidProductionMetricsInputError('fields.status must be "completed" or "failed"');
  }
  checkRequests(fields.requests);
  checkDurations(fields.durationsMs);
  checkOutputs(fields.outputs);
  checkCosts(fields.costs);

  const record = {
    metrics_id: idGenerator(),
    request_id: fields.requestId,
    execution_id: fields.executionId ?? null,
    carousel_content_id: fields.carouselContentId ?? null,
    carousel_id: fields.carouselId ?? null,
    recorded_at: now(),
    status: fields.status,
    requests: {
      anthropic: fields.requests.anthropic,
      templated: fields.requests.templated,
      google_drive: fields.requests.googleDrive,
    },
    durations_ms: {
      generation: fields.durationsMs.generation,
      render: fields.durationsMs.render,
      export: fields.durationsMs.export,
      publish: fields.durationsMs.publish,
      total: fields.durationsMs.total,
    },
    outputs: {
      slides_generated: fields.outputs.slidesGenerated,
      slides_rendered: fields.outputs.slidesRendered,
      files_exported: fields.outputs.filesExported,
      files_published: fields.outputs.filesPublished,
    },
    costs: {
      currency: fields.costs.currency,
      anthropic: { amount: fields.costs.anthropic.amount, calculation_type: fields.costs.anthropic.calculationType },
      templated: { amount: fields.costs.templated.amount, calculation_type: fields.costs.templated.calculationType },
      google_drive: { amount: fields.costs.googleDrive.amount, calculation_type: fields.costs.googleDrive.calculationType },
      total: fields.costs.total,
    },
  };

  const validation = validator.validate("productionMetrics", record);
  if (!validation.valid) {
    throw new ProductionMetricsValidationError(validation.errors);
  }

  return deepFreezeClone(record);
}

// DC-003-I029 — Engineering Work Order domain object factory. Mirrors the
// "assemble, then validate, then deep-freeze" discipline every other
// domain-object factory in this codebase already applies to itself
// (production-metrics.mjs, publisher-result.mjs, social-analytics-snapshot.mjs)
// — composition only, no filesystem APIs, no HTTP.
//
// This factory itself accepts any of the schema's six status values —
// engineering-work-order.schema.json's own header comment explains why:
// the schema must support a future milestone (the Bridge Layer) creating
// a Work Order directly with a status beyond draft/ready. The RESTRICTION
// to "the CLI may create Draft or Ready" (this milestone's own brief) is
// enforced one layer up, in tests/validation/engineering.mjs's own `work
// create` subcommand — not here, and not by inventing a transition
// function (approve()/start()/complete()) this milestone's brief
// explicitly says not to build.

import { randomUUID } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidEngineeringWorkOrderInputError, EngineeringWorkOrderValidationError } from "./engineering-work-order-errors.mjs";

const STATUSES = ["draft", "ready", "in_progress", "completed", "approved", "archived"];
const PRIORITIES = ["low", "medium", "high"];
const MILESTONE_PATTERN = /^DC-003-I[0-9]+(\.[0-9]+)?$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const WORK_ORDER_ID_PATTERN = /^wo_[A-Za-z0-9]+$/;

function generateWorkOrderId() {
  return "wo_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkStringArray(value, label, { minItems = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minItems || !value.every(isNonEmptyString)) {
    throw new InvalidEngineeringWorkOrderInputError(
      `fields.${label} must be an array of non-empty strings${minItems > 0 ? ` with at least ${minItems} entry` : ""}`
    );
  }
}

/**
 * Builds an immutable Engineering Work Order.
 *
 * fields.milestone — required, e.g. "DC-003-I029" or "DC-003-I019.1".
 * fields.title / objective — required, non-empty strings.
 * fields.repositoryCommit — optional, a full/short git hash or null.
 * fields.constraints — optional array of strings (default []).
 * fields.reviewCriteria — required, non-empty array of strings.
 * fields.status — optional, defaults to "draft"; one of the six schema
 *   values (see this file's own header comment for why no CLI-level
 *   restriction lives here).
 * fields.approvedAt — required unless status is "draft" (schema-enforced
 *   pairing); must be omitted/null for "draft".
 * fields.priority — optional, defaults to "medium".
 * fields.dependencies — optional array of wo_... identifiers (default []).
 * fields.notes — optional, string or null.
 *
 * options.now / idGenerator / validator / rootDir — injectable for tests.
 *
 * Throws InvalidEngineeringWorkOrderInputError for structurally invalid
 * input. Throws EngineeringWorkOrderValidationError if the assembled
 * object still fails schema validation.
 */
export function createEngineeringWorkOrder(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateWorkOrderId;
  const validator = options.validator ?? createValidator(options);

  if (!MILESTONE_PATTERN.test(fields.milestone ?? "")) {
    throw new InvalidEngineeringWorkOrderInputError('fields.milestone must match "DC-003-I<n>" or "DC-003-I<n>.<n>"');
  }
  if (!isNonEmptyString(fields.title)) {
    throw new InvalidEngineeringWorkOrderInputError("fields.title is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.objective)) {
    throw new InvalidEngineeringWorkOrderInputError("fields.objective is required and must be a non-empty string");
  }
  if (fields.repositoryCommit !== null && fields.repositoryCommit !== undefined && !COMMIT_PATTERN.test(fields.repositoryCommit)) {
    throw new InvalidEngineeringWorkOrderInputError("fields.repositoryCommit must be a 7-40 character lowercase hex git hash, or null");
  }
  checkStringArray(fields.constraints ?? [], "constraints");
  checkStringArray(fields.reviewCriteria, "reviewCriteria", { minItems: 1 });

  const status = fields.status ?? "draft";
  if (!STATUSES.includes(status)) {
    throw new InvalidEngineeringWorkOrderInputError(`fields.status must be one of ${STATUSES.join(", ")}`);
  }
  if (status === "draft") {
    if (fields.approvedAt !== null && fields.approvedAt !== undefined) {
      throw new InvalidEngineeringWorkOrderInputError('fields.approvedAt must be null (or omitted) when status is "draft"');
    }
  } else if (!isNonEmptyString(fields.approvedAt)) {
    throw new InvalidEngineeringWorkOrderInputError('fields.approvedAt is required (an ISO date-time) when status is not "draft"');
  }

  const priority = fields.priority ?? "medium";
  if (!PRIORITIES.includes(priority)) {
    throw new InvalidEngineeringWorkOrderInputError(`fields.priority must be one of ${PRIORITIES.join(", ")}`);
  }

  const dependencies = fields.dependencies ?? [];
  if (!Array.isArray(dependencies) || !dependencies.every((id) => typeof id === "string" && WORK_ORDER_ID_PATTERN.test(id))) {
    throw new InvalidEngineeringWorkOrderInputError("fields.dependencies must be an array of wo_... identifiers");
  }

  if (fields.notes !== null && fields.notes !== undefined && typeof fields.notes !== "string") {
    throw new InvalidEngineeringWorkOrderInputError("fields.notes must be a string or null");
  }

  const workOrder = {
    work_order_id: idGenerator(),
    milestone: fields.milestone,
    title: fields.title,
    objective: fields.objective,
    repository_commit: fields.repositoryCommit ?? null,
    constraints: fields.constraints ?? [],
    review_criteria: fields.reviewCriteria,
    created_at: now(),
    approved_at: status === "draft" ? null : fields.approvedAt,
    status,
    priority,
    dependencies,
    notes: fields.notes ?? null,
  };

  const validation = validator.validate("engineeringWorkOrder", workOrder);
  if (!validation.valid) {
    throw new EngineeringWorkOrderValidationError(validation.errors);
  }

  return deepFreezeClone(workOrder);
}

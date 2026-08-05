// DC-003-I029 — Engineering Delivery Report domain object factory. Mirrors
// engineering-work-order.mjs's own "assemble, then validate, then
// deep-freeze" discipline exactly. Captures engineering EVIDENCE only —
// this factory has no field for conversational text, a transcript, or a
// prompt (see the schema's own header comment); `notes` is a short,
// optional annotation, not a narrative.

import { randomUUID } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidEngineeringDeliveryReportInputError, EngineeringDeliveryReportValidationError } from "./engineering-delivery-report-errors.mjs";

const STATUSES = ["completed", "partial", "failed"];
const PUSH_STATUSES = ["pushed", "not_pushed", "not_applicable"];
const WORKING_TREE_STATES = ["clean", "dirty"];
const MILESTONE_PATTERN = /^DC-003-I[0-9]+(\.[0-9]+)?$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const WORK_ORDER_ID_PATTERN = /^wo_[A-Za-z0-9]+$/;

function generateDeliveryReportId() {
  return "dr_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkStringArray(value, label) {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new InvalidEngineeringDeliveryReportInputError(`fields.${label} must be an array of non-empty strings`);
  }
}

function checkCountSummary(value, label) {
  if (
    !value ||
    !Number.isInteger(value.passed) ||
    value.passed < 0 ||
    !Number.isInteger(value.failed) ||
    value.failed < 0 ||
    !Number.isInteger(value.total) ||
    value.total < 0
  ) {
    throw new InvalidEngineeringDeliveryReportInputError(`fields.${label} must be { passed, failed, total }, each a non-negative integer`);
  }
}

/**
 * Builds an immutable Engineering Delivery Report.
 *
 * fields.workOrderId — required, the wo_... this delivery answers
 *   (referential integrity to a real stored Work Order is a service/store
 *   concern, not checked here).
 * fields.milestone — required, e.g. "DC-003-I029".
 * fields.status — required, "completed" | "partial" | "failed".
 * fields.commit — required (non-null) when status is "completed"; null
 *   permitted otherwise.
 * fields.pushStatus — required, "pushed" | "not_pushed" | "not_applicable"
 *   — must be "pushed" or "not_applicable" when status is "completed".
 * fields.workingTree — required, "clean" | "dirty".
 * fields.tests / fixtures — required, { passed, failed, total }.
 * fields.filesCreated / filesModified — optional arrays of repo-relative
 *   paths (default []).
 * fields.repositoryFindings / compatibility / followUpRequired — optional
 *   arrays of strings (default []).
 * fields.liveRequests — required, { occurred: boolean, details: string|null }.
 * fields.notes — optional, string or null.
 *
 * options.now / idGenerator / validator / rootDir — injectable for tests.
 *
 * Throws InvalidEngineeringDeliveryReportInputError for structurally
 * invalid input. Throws EngineeringDeliveryReportValidationError if the
 * assembled object still fails schema validation.
 */
export function createEngineeringDeliveryReport(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateDeliveryReportId;
  const validator = options.validator ?? createValidator(options);

  if (typeof fields.workOrderId !== "string" || !WORK_ORDER_ID_PATTERN.test(fields.workOrderId)) {
    throw new InvalidEngineeringDeliveryReportInputError("fields.workOrderId must be a valid wo_... identifier");
  }
  if (!MILESTONE_PATTERN.test(fields.milestone ?? "")) {
    throw new InvalidEngineeringDeliveryReportInputError('fields.milestone must match "DC-003-I<n>" or "DC-003-I<n>.<n>"');
  }
  if (!STATUSES.includes(fields.status)) {
    throw new InvalidEngineeringDeliveryReportInputError(`fields.status must be one of ${STATUSES.join(", ")}`);
  }
  if (fields.status === "completed") {
    if (typeof fields.commit !== "string" || !COMMIT_PATTERN.test(fields.commit)) {
      throw new InvalidEngineeringDeliveryReportInputError('fields.commit is required (a real git hash) when status is "completed"');
    }
    if (!["pushed", "not_applicable"].includes(fields.pushStatus)) {
      throw new InvalidEngineeringDeliveryReportInputError('fields.pushStatus must be "pushed" or "not_applicable" when status is "completed"');
    }
  } else {
    if (fields.commit !== null && fields.commit !== undefined && !COMMIT_PATTERN.test(fields.commit)) {
      throw new InvalidEngineeringDeliveryReportInputError("fields.commit must be a real git hash or null");
    }
    if (!PUSH_STATUSES.includes(fields.pushStatus)) {
      throw new InvalidEngineeringDeliveryReportInputError(`fields.pushStatus must be one of ${PUSH_STATUSES.join(", ")}`);
    }
  }
  if (!WORKING_TREE_STATES.includes(fields.workingTree)) {
    throw new InvalidEngineeringDeliveryReportInputError(`fields.workingTree must be one of ${WORKING_TREE_STATES.join(", ")}`);
  }
  checkCountSummary(fields.tests, "tests");
  checkCountSummary(fields.fixtures, "fixtures");
  checkStringArray(fields.filesCreated ?? [], "filesCreated");
  checkStringArray(fields.filesModified ?? [], "filesModified");
  checkStringArray(fields.repositoryFindings ?? [], "repositoryFindings");
  checkStringArray(fields.compatibility ?? [], "compatibility");
  checkStringArray(fields.followUpRequired ?? [], "followUpRequired");
  if (!fields.liveRequests || typeof fields.liveRequests.occurred !== "boolean") {
    throw new InvalidEngineeringDeliveryReportInputError("fields.liveRequests must be { occurred: boolean, details: string|null }");
  }
  if (fields.liveRequests.details !== null && fields.liveRequests.details !== undefined && typeof fields.liveRequests.details !== "string") {
    throw new InvalidEngineeringDeliveryReportInputError("fields.liveRequests.details must be a string or null");
  }
  if (fields.notes !== null && fields.notes !== undefined && typeof fields.notes !== "string") {
    throw new InvalidEngineeringDeliveryReportInputError("fields.notes must be a string or null");
  }

  const report = {
    delivery_report_id: idGenerator(),
    work_order_id: fields.workOrderId,
    milestone: fields.milestone,
    status: fields.status,
    commit: fields.commit ?? null,
    push_status: fields.pushStatus,
    working_tree: fields.workingTree,
    tests: { passed: fields.tests.passed, failed: fields.tests.failed, total: fields.tests.total },
    fixtures: { passed: fields.fixtures.passed, failed: fields.fixtures.failed, total: fields.fixtures.total },
    files_created: fields.filesCreated ?? [],
    files_modified: fields.filesModified ?? [],
    repository_findings: fields.repositoryFindings ?? [],
    compatibility: fields.compatibility ?? [],
    live_requests: { occurred: fields.liveRequests.occurred, details: fields.liveRequests.details ?? null },
    follow_up_required: fields.followUpRequired ?? [],
    delivery_timestamp: fields.deliveryTimestamp ?? now(),
    notes: fields.notes ?? null,
  };

  const validation = validator.validate("engineeringDeliveryReport", report);
  if (!validation.valid) {
    throw new EngineeringDeliveryReportValidationError(validation.errors);
  }

  return deepFreezeClone(report);
}

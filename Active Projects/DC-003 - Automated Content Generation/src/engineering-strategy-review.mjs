// DC-003-I029.3 — Engineering Strategy Review domain object factory.
// Mirrors engineering-delivery-report.mjs's own "assemble, then validate,
// then deep-freeze" discipline. Composition only — no filesystem, no
// networking, no repository commands.
//
// Criterion completeness/ordering is enforced against the Work Order's
// OWN review_criteria array, supplied by the caller (fields
// .workOrderReviewCriteria) — never re-derived or guessed. This is what
// makes "every Work Order review criterion must appear exactly once,
// ordering must match the Work Order" a real, structural guarantee rather
// than a convention the caller might violate.
//
// Decision/criterion consistency (beyond what the schema's own oneOf
// already enforces structurally):
//   - "approved" requires every criterion result to be pass/not_applicable.
//   - "correction_required" requires at least one fail/insufficient_evidence
//     criterion, and the correction specification's own failed_criteria
//     must reference only such criteria.
//   - "ceo_decision_required"/"rejected" carry no additional criterion
//     constraint here — WHY escalation or rejection is warranted is a
//     judgement the deterministic authority gates and/or the reviewer
//     make one layer up (see strategy-review-authority-gates.mjs); this
//     factory only guarantees internal structural self-consistency.

import { randomUUID } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidEngineeringStrategyReviewInputError, EngineeringStrategyReviewValidationError } from "./engineering-strategy-review-errors.mjs";

const DECISIONS = ["approved", "correction_required", "ceo_decision_required", "rejected"];
const CRITERION_RESULTS = ["pass", "fail", "insufficient_evidence", "not_applicable"];
const EVIDENCE_SOURCES = ["independent-verification", "delivery-report", "work-order", "bridge-transport"];
const MILESTONE_PATTERN = /^DC-003-I[0-9]+(\.[0-9]+)?$/;
const WORK_ORDER_ID_PATTERN = /^wo_[A-Za-z0-9]+$/;
const DELIVERY_REPORT_ID_PATTERN = /^dr_[A-Za-z0-9]+$/;

function generateStrategyReviewId() {
  return "esr_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function fail(message) {
  throw new InvalidEngineeringStrategyReviewInputError(message);
}

function checkEvidenceEntry(entry, label) {
  if (!entry || typeof entry !== "object") fail(`${label} must be an object`);
  if (!EVIDENCE_SOURCES.includes(entry.source)) fail(`${label}.source must be one of ${EVIDENCE_SOURCES.join(", ")}`);
  if (!isNonEmptyString(entry.summary)) fail(`${label}.summary must be a non-empty string`);
}

function checkCriteria(criteria, workOrderReviewCriteria) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    fail("fields.criteria must be a non-empty array");
  }
  if (criteria.length !== workOrderReviewCriteria.length) {
    fail(`fields.criteria must have exactly ${workOrderReviewCriteria.length} entries, one per Work Order review criterion (got ${criteria.length})`);
  }
  criteria.forEach((entry, index) => {
    const label = `fields.criteria[${index}]`;
    if (!entry || typeof entry !== "object") fail(`${label} must be an object`);
    if (entry.criterionIndex !== index + 1) fail(`${label}.criterionIndex must be ${index + 1} (criteria must be ordered exactly as in the Work Order)`);
    if (entry.criterion !== workOrderReviewCriteria[index]) {
      fail(`${label}.criterion must match the Work Order's own review_criteria[${index}] verbatim — no criterion may be invented, reworded, or reordered`);
    }
    if (!CRITERION_RESULTS.includes(entry.result)) fail(`${label}.result must be one of ${CRITERION_RESULTS.join(", ")}`);
    if (!Array.isArray(entry.evidence)) fail(`${label}.evidence must be an array`);
    entry.evidence.forEach((e, i) => checkEvidenceEntry(e, `${label}.evidence[${i}]`));
    if (entry.result === "pass") {
      if (entry.reason !== null && entry.reason !== undefined) fail(`${label}.reason must be null when result is "pass"`);
    } else if (!isNonEmptyString(entry.reason)) {
      fail(`${label}.reason is required (a non-empty string) when result is "${entry.result}"`);
    }
  });
}

function checkRepositoryEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") fail("fields.repositoryEvidence must be an object");
  if (typeof evidence.verifiable !== "boolean") fail("fields.repositoryEvidence.verifiable must be a boolean");
  if (!["clean", "dirty", "unknown"].includes(evidence.workingTree)) fail('fields.repositoryEvidence.workingTree must be "clean", "dirty", or "unknown"');
  if (!["pushed", "not_pushed", "not_applicable", "unknown"].includes(evidence.pushStatus)) {
    fail('fields.repositoryEvidence.pushStatus must be "pushed", "not_pushed", "not_applicable", or "unknown"');
  }
}

function checkCountSummary(summary, label) {
  if (!summary || typeof summary !== "object") fail(`${label} must be an object`);
  if (!["passed", "failed", "unknown"].includes(summary.status)) fail(`${label}.status must be "passed", "failed", or "unknown"`);
  if (!["independent-verification", "delivery-report"].includes(summary.source)) fail(`${label}.source must be "independent-verification" or "delivery-report"`);
  for (const key of ["passed", "failed", "total"]) {
    if (!Number.isInteger(summary[key]) || summary[key] < 0) fail(`${label}.${key} must be a non-negative integer`);
  }
}

/**
 * Builds an immutable Engineering Strategy Review.
 *
 * fields.workOrderId / deliveryReportId — required, real identifiers.
 * fields.workOrderReviewCriteria — required, the Work Order's OWN
 *   review_criteria array (verbatim) — used to enforce completeness and
 *   ordering; never re-derived here.
 * fields.milestone — required, e.g. "DC-003-I029.3".
 * fields.reviewerProvider — required, non-empty string ("mock"/"openai").
 * fields.decision — required, one of DECISIONS.
 * fields.criteria — required, one entry per Work Order criterion, in
 *   order: { criterionIndex, criterion, result, evidence, reason }.
 * fields.repositoryEvidence — required: { startingCommit, endingCommit,
 *   branch, workingTree, pushStatus, verifiable }.
 * fields.verification — required: { tests, fixtures }, each a count
 *   summary { status, passed, failed, total, source }.
 * fields.risks — optional array of strings (default []).
 * fields.correction — required when decision is "correction_required",
 *   else must be null: { failedCriteria, requiredOutcome,
 *   prohibitedScopeExpansion, verificationRequired }.
 * fields.ceoEscalation — required when decision is "ceo_decision_required",
 *   else must be null: { decisionRequired, reason, safeOptions,
 *   defaultSafeAction }.
 * fields.summary — required, non-empty, bounded string.
 * fields.notes — optional, string or null.
 *
 * options.now / idGenerator / validator / rootDir — injectable for tests.
 *
 * Throws InvalidEngineeringStrategyReviewInputError for structurally
 * invalid input. Throws EngineeringStrategyReviewValidationError if the
 * assembled object still fails schema validation.
 */
export function createEngineeringStrategyReview(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateStrategyReviewId;
  const validator = options.validator ?? createValidator(options);

  if (typeof fields.workOrderId !== "string" || !WORK_ORDER_ID_PATTERN.test(fields.workOrderId)) {
    fail("fields.workOrderId must be a valid wo_... identifier");
  }
  if (typeof fields.deliveryReportId !== "string" || !DELIVERY_REPORT_ID_PATTERN.test(fields.deliveryReportId)) {
    fail("fields.deliveryReportId must be a valid dr_... identifier");
  }
  if (!Array.isArray(fields.workOrderReviewCriteria) || fields.workOrderReviewCriteria.length === 0) {
    fail("fields.workOrderReviewCriteria is required and must be a non-empty array of strings (the Work Order's own review_criteria)");
  }
  if (!MILESTONE_PATTERN.test(fields.milestone ?? "")) {
    fail('fields.milestone must match "DC-003-I<n>" or "DC-003-I<n>.<n>"');
  }
  if (!isNonEmptyString(fields.reviewerProvider)) {
    fail("fields.reviewerProvider is required and must be a non-empty string");
  }
  if (!DECISIONS.includes(fields.decision)) {
    fail(`fields.decision must be one of ${DECISIONS.join(", ")}`);
  }
  checkCriteria(fields.criteria, fields.workOrderReviewCriteria);
  checkRepositoryEvidence(fields.repositoryEvidence ?? {});
  if (!fields.verification || typeof fields.verification !== "object") fail("fields.verification must be an object");
  checkCountSummary(fields.verification.tests, "fields.verification.tests");
  checkCountSummary(fields.verification.fixtures, "fields.verification.fixtures");

  const risks = fields.risks ?? [];
  if (!Array.isArray(risks) || !risks.every(isNonEmptyString)) fail("fields.risks must be an array of non-empty strings");

  // Decision/criterion consistency — beyond the schema's own structural oneOf.
  const failingIndices = fields.criteria.filter((c) => ["fail", "insufficient_evidence"].includes(c.result)).map((c) => c.criterionIndex ?? c.criterion_index);
  if (fields.decision === "approved") {
    const allPassOrNa = fields.criteria.every((c) => ["pass", "not_applicable"].includes(c.result));
    if (!allPassOrNa) fail('fields.decision cannot be "approved" while any criterion result is "fail" or "insufficient_evidence"');
  }

  let correction = null;
  if (fields.decision === "correction_required") {
    if (failingIndices.length === 0) {
      fail('fields.decision is "correction_required" but no criterion result is "fail" or "insufficient_evidence"');
    }
    const c = fields.correction;
    if (!c || typeof c !== "object") fail("fields.correction is required when fields.decision is \"correction_required\"");
    if (!Array.isArray(c.failedCriteria) || c.failedCriteria.length === 0) fail("fields.correction.failedCriteria must be a non-empty array");
    if (!c.failedCriteria.every((i) => failingIndices.includes(i))) {
      fail("fields.correction.failedCriteria may only reference criteria whose own result is \"fail\" or \"insufficient_evidence\"");
    }
    if (!isNonEmptyString(c.requiredOutcome)) fail("fields.correction.requiredOutcome must be a non-empty string");
    if (!isNonEmptyString(c.prohibitedScopeExpansion)) fail("fields.correction.prohibitedScopeExpansion must be a non-empty string");
    if (!isNonEmptyString(c.verificationRequired)) fail("fields.correction.verificationRequired must be a non-empty string");
    correction = {
      failed_criteria: c.failedCriteria,
      required_outcome: c.requiredOutcome,
      prohibited_scope_expansion: c.prohibitedScopeExpansion,
      verification_required: c.verificationRequired,
    };
  } else if (fields.correction !== null && fields.correction !== undefined) {
    fail('fields.correction must be null unless fields.decision is "correction_required"');
  }

  let ceoEscalation = null;
  if (fields.decision === "ceo_decision_required") {
    const e = fields.ceoEscalation;
    if (!e || typeof e !== "object") fail("fields.ceoEscalation is required when fields.decision is \"ceo_decision_required\"");
    if (!isNonEmptyString(e.decisionRequired)) fail("fields.ceoEscalation.decisionRequired must be a non-empty string");
    if (!isNonEmptyString(e.reason)) fail("fields.ceoEscalation.reason must be a non-empty string");
    if (!Array.isArray(e.safeOptions) || !e.safeOptions.every(isNonEmptyString)) fail("fields.ceoEscalation.safeOptions must be an array of non-empty strings");
    ceoEscalation = { decision_required: e.decisionRequired, reason: e.reason, safe_options: e.safeOptions, default_safe_action: "stop" };
  } else if (fields.ceoEscalation !== null && fields.ceoEscalation !== undefined) {
    fail('fields.ceoEscalation must be null unless fields.decision is "ceo_decision_required"');
  }

  if (!isNonEmptyString(fields.summary)) fail("fields.summary is required and must be a non-empty string");
  if (fields.notes !== null && fields.notes !== undefined && typeof fields.notes !== "string") fail("fields.notes must be a string or null");

  const review = {
    strategy_review_id: idGenerator(),
    work_order_id: fields.workOrderId,
    delivery_report_id: fields.deliveryReportId,
    milestone: fields.milestone,
    reviewed_at: fields.reviewedAt ?? now(),
    reviewer: { type: "strategy-review-agent", provider: fields.reviewerProvider },
    decision: fields.decision,
    criteria: fields.criteria.map((c) => ({
      criterion_index: c.criterionIndex ?? c.criterion_index,
      criterion: c.criterion,
      result: c.result,
      evidence: c.evidence,
      reason: c.result === "pass" ? null : c.reason,
    })),
    repository_evidence: {
      starting_commit: fields.repositoryEvidence.startingCommit ?? null,
      ending_commit: fields.repositoryEvidence.endingCommit ?? null,
      branch: fields.repositoryEvidence.branch ?? null,
      working_tree: fields.repositoryEvidence.workingTree,
      push_status: fields.repositoryEvidence.pushStatus,
      verifiable: fields.repositoryEvidence.verifiable,
    },
    verification: { tests: fields.verification.tests, fixtures: fields.verification.fixtures },
    risks,
    correction,
    ceo_escalation: ceoEscalation,
    summary: fields.summary,
    notes: fields.notes ?? null,
  };

  const validation = validator.validate("engineeringStrategyReview", review);
  if (!validation.valid) {
    throw new EngineeringStrategyReviewValidationError(validation.errors);
  }

  return deepFreezeClone(review);
}

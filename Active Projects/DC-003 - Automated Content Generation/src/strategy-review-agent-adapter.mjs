// DC-003-I029.3 — Strategy Review Agent Adapter: the provider-neutral
// contract every reviewer implementation (the mock in
// strategy-review-mock-adapter.mjs, the real one in
// openai-strategy-review-adapter.mjs) must satisfy. Mirrors
// delivery-office-runner-adapter.mjs's own precedent (I029.2) exactly.
//
//   { name: string,
//     reviewDelivery({ workOrder, deliveryReport, evidence, policy }): Promise<ReviewProposal> }
//
// No OpenAI-specific response shape may cross this boundary — every
// adapter must already return the normalised Review Proposal shape
// below. The PROPOSAL deliberately omits identity/bookkeeping fields
// (strategy_review_id, work_order_id, delivery_report_id, milestone,
// reviewed_at, reviewer, repository_evidence, verification) — those are
// filled in by automated-strategy-review-service.mjs from evidence it
// already independently collected, never from the adapter's own say-so.
// A criterion's own TEXT is likewise never proposed by the adapter — only
// its index/result/evidence/reason — the service re-attaches the real
// text from the Work Order itself when building the final review, making
// it structurally impossible for an adapter to invent or reword a
// criterion.

import { InvalidStrategyReviewAgentAdapterError, MalformedReviewProposalError } from "./strategy-review-errors.mjs";

export const REVIEW_DECISIONS = ["approved", "correction_required", "ceo_decision_required", "rejected"];
export const CRITERION_RESULTS = ["pass", "fail", "insufficient_evidence", "not_applicable"];
const EVIDENCE_SOURCES = ["independent-verification", "delivery-report", "work-order", "bridge-transport"];

export function assertValidStrategyReviewAgentAdapter(adapter) {
  if (!adapter || typeof adapter.name !== "string" || typeof adapter.reviewDelivery !== "function") {
    throw new InvalidStrategyReviewAgentAdapterError();
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function failWith(reason) {
  throw new MalformedReviewProposalError(reason);
}

/**
 * Validates a Review Proposal returned by any adapter, mock or real, and
 * that it addresses exactly `expectedCriterionCount` criteria in order
 * 1..N — called by automated-strategy-review-service.mjs immediately
 * after every adapter invocation, before any of it is trusted.
 */
export function assertValidReviewProposal(proposal, expectedCriterionCount) {
  if (!proposal || typeof proposal !== "object") failWith("proposal is not an object");
  if (!REVIEW_DECISIONS.includes(proposal.decision)) failWith(`decision must be one of ${REVIEW_DECISIONS.join(", ")}`);

  if (!Array.isArray(proposal.criteria) || proposal.criteria.length !== expectedCriterionCount) {
    failWith(`criteria must be an array of exactly ${expectedCriterionCount} entries (one per Work Order review criterion)`);
  }
  const seenIndices = new Set();
  proposal.criteria.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") failWith(`criteria[${i}] is not an object`);
    if (!Number.isInteger(entry.criterionIndex) || entry.criterionIndex < 1 || entry.criterionIndex > expectedCriterionCount) {
      failWith(`criteria[${i}].criterionIndex must be an integer between 1 and ${expectedCriterionCount}`);
    }
    if (seenIndices.has(entry.criterionIndex)) failWith(`criteria[${i}].criterionIndex ${entry.criterionIndex} is duplicated`);
    seenIndices.add(entry.criterionIndex);
    if (!CRITERION_RESULTS.includes(entry.result)) failWith(`criteria[${i}].result must be one of ${CRITERION_RESULTS.join(", ")}`);
    if (!Array.isArray(entry.evidence)) failWith(`criteria[${i}].evidence must be an array`);
    entry.evidence.forEach((e, j) => {
      if (!e || typeof e !== "object" || !EVIDENCE_SOURCES.includes(e.source) || !isNonEmptyString(e.summary)) {
        failWith(`criteria[${i}].evidence[${j}] must be { source: one of ${EVIDENCE_SOURCES.join("/")}, summary: non-empty string }`);
      }
    });
    if (entry.result === "pass") {
      if (entry.reason !== null && entry.reason !== undefined) failWith(`criteria[${i}].reason must be null when result is "pass"`);
    } else if (!isNonEmptyString(entry.reason)) {
      failWith(`criteria[${i}].reason is required when result is "${entry.result}"`);
    }
  });
  if (seenIndices.size !== expectedCriterionCount) failWith(`criteria must cover every index 1..${expectedCriterionCount} exactly once`);

  if (!Array.isArray(proposal.risks) || !proposal.risks.every(isNonEmptyString)) failWith("risks must be an array of non-empty strings");

  if (proposal.decision === "correction_required") {
    const c = proposal.correction;
    if (!c || typeof c !== "object") failWith('correction is required when decision is "correction_required"');
    if (!Array.isArray(c.failedCriteria) || c.failedCriteria.length === 0) failWith("correction.failedCriteria must be a non-empty array");
    if (!isNonEmptyString(c.requiredOutcome) || !isNonEmptyString(c.prohibitedScopeExpansion) || !isNonEmptyString(c.verificationRequired)) {
      failWith("correction must include non-empty requiredOutcome, prohibitedScopeExpansion, and verificationRequired");
    }
  } else if (proposal.correction !== null && proposal.correction !== undefined) {
    failWith('correction must be null unless decision is "correction_required"');
  }

  if (proposal.decision === "ceo_decision_required") {
    const e = proposal.ceoEscalation;
    if (!e || typeof e !== "object") failWith('ceoEscalation is required when decision is "ceo_decision_required"');
    if (!isNonEmptyString(e.decisionRequired) || !isNonEmptyString(e.reason)) failWith("ceoEscalation must include non-empty decisionRequired and reason");
    if (!Array.isArray(e.safeOptions) || !e.safeOptions.every(isNonEmptyString)) failWith("ceoEscalation.safeOptions must be an array of non-empty strings");
  } else if (proposal.ceoEscalation !== null && proposal.ceoEscalation !== undefined) {
    failWith('ceoEscalation must be null unless decision is "ceo_decision_required"');
  }

  if (!isNonEmptyString(proposal.summary)) failWith("summary must be a non-empty string");

  return proposal;
}

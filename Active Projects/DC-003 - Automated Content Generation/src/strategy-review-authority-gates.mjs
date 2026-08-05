// DC-003-I029.3 — Deterministic Strategy Review Authority Gates: the
// mandatory CEO-escalation conditions from this milestone's own brief
// (§6), enforced in code the OpenAI model can never see, influence, or
// override. Two entry points:
//
//   evaluateMandatoryEscalationReasons() — the single source of truth for
//   "does this evidence trip a mandatory gate," used BOTH before the
//   adapter is ever invoked (pre-review — an unambiguous escalation case
//   never spends an OpenAI request) AND after the adapter returns
//   (post-review — defense in depth, and the only place a "tests failed
//   but the model proposed approval anyway" mismatch is caught).
//
//   applyGates() — combines the mandatory reasons with the proposed (or,
//   pre-review, absent) decision and returns the FINAL decision. Gates
//   can only make the outcome MORE cautious, never less: a model
//   proposing "rejected" is never downgraded to "ceo_decision_required"
//   just because a gate also tripped, and a model respecting
//   policy.allowRoutineApproval=false by already proposing
//   "ceo_decision_required" is left alone.

const DECISION_RANK = { approved: 0, correction_required: 1, ceo_decision_required: 2, rejected: 3 };

/**
 * Returns an array of human-readable reasons (empty when nothing
 * mandatory tripped) — never a boolean, so the caller always has
 * something concrete to record in ceo_escalation.reason /
 * repository_evidence / risks.
 */
export function evaluateMandatoryEscalationReasons(evidence, policy) {
  const reasons = [];

  if (!evidence.repository.verifiable) {
    reasons.push("Repository state could not be independently verified.");
  }
  if (evidence.hasUnresolvedConflict) {
    reasons.push("Unresolved merge conflict markers were detected in the repository.");
  }
  if (evidence.possibleHistoryRewrite) {
    reasons.push("The Work Order's own starting commit is no longer an ancestor of the current commit — a possible non-fast-forward history rewrite.");
  }
  if (evidence.credentialFilesDetected.length > 0) {
    reasons.push(`Credential-shaped file(s) detected: ${evidence.credentialFilesDetected.slice(0, 5).join(", ")}.`);
  }
  if (evidence.infrastructureFilesChanged.length > 0) {
    reasons.push(`Infrastructure file(s) changed: ${evidence.infrastructureFilesChanged.slice(0, 5).join(", ")}.`);
  }
  if (evidence.architectureSensitiveFilesChanged.length > 0) {
    reasons.push(`Architecture-sensitive file(s) changed: ${evidence.architectureSensitiveFilesChanged.slice(0, 5).join(", ")}.`);
  }
  if (evidence.deliveryReportLiveRequestsOccurred) {
    reasons.push("The Delivery Report records a live external-provider request during delivery.");
  }
  if (!policy.allowDeliveryBranchDifferFromMain && evidence.repository.branch !== policy.permittedBranch) {
    reasons.push(`Repository is on branch "${evidence.repository.branch}", expected "${policy.permittedBranch}".`);
  }
  if (policy.maxChangedFileCount !== null && evidence.filesCreated.length + evidence.filesModified.length > policy.maxChangedFileCount) {
    reasons.push(`Changed-file count (${evidence.filesCreated.length + evidence.filesModified.length}) exceeds the configured maximum (${policy.maxChangedFileCount}).`);
  }

  return reasons;
}

/**
 * Post-review-only: a proposal that contradicts evidence the service
 * already independently knows (currently just "approved despite failing
 * verification"). Treated as a FLOOR at ceo_decision_required, same as a
 * mandatory evidence-based reason — never downgrades an already-more-
 * cautious "rejected" proposal.
 */
function evaluateEvidenceMismatchReasons(proposedDecision, evidence) {
  const reasons = [];
  if (proposedDecision === "approved" && (evidence.tests.status === "failed" || evidence.fixtures.status === "failed")) {
    reasons.push("The reviewer proposed approval despite failing test or fixture evidence — a failure may never be waived.");
  }
  return reasons;
}

/**
 * Post-review-only: the policy explicitly forbids the PROPOSED decision
 * TYPE outright (e.g. allowAutomaticRejection=false). Unlike a mandatory
 * evidence reason or an evidence mismatch, this is an ABSOLUTE
 * restriction, not merely a floor — a policy saying "no automatic
 * rejection" must force ceo_decision_required even though "rejected"
 * itself outranks it, so this is applied unconditionally in
 * applyPostReviewGates(), never rank-compared.
 */
function evaluatePolicyRestrictionReasons(proposedDecision, policy) {
  const reasons = [];
  if (proposedDecision === "approved" && !policy.allowRoutineApproval) {
    reasons.push("Policy does not permit routine automated approval for this review.");
  }
  if (proposedDecision === "rejected" && !policy.allowAutomaticRejection) {
    reasons.push("Policy does not permit automatic rejection for this review.");
  }
  if (proposedDecision === "correction_required" && !policy.allowCorrectionSpecifications) {
    reasons.push("Policy does not permit generating correction specifications for this review.");
  }
  return reasons;
}

/**
 * Pre-review gate check — call BEFORE invoking the adapter. Returns
 * `{ forced: true, decision: "ceo_decision_required", reasons }` when at
 * least one mandatory condition already trips on the evidence alone (the
 * adapter is never invoked in this case — see
 * automated-strategy-review-service.mjs), or `{ forced: false, reasons: [] }`
 * otherwise.
 */
export function evaluatePreReviewGates(evidence, policy) {
  const reasons = evaluateMandatoryEscalationReasons(evidence, policy);
  return reasons.length > 0 ? { forced: true, decision: "ceo_decision_required", reasons } : { forced: false, reasons: [] };
}

/**
 * Post-review gate check — call AFTER the adapter returns a validated
 * proposal. Combines three reason categories and returns the FINAL
 * decision the service must use:
 *
 *   - a policy restriction on the proposed decision TYPE itself (e.g.
 *     allowAutomaticRejection=false) is absolute — always forces
 *     ceo_decision_required, regardless of how "severe" the proposed
 *     decision already was;
 *   - mandatory evidence-based reasons and an evidence/approval mismatch
 *     are a FLOOR at ceo_decision_required — never downgrades an
 *     already-more-cautious "rejected" proposal;
 *   - no reasons at all leaves the model's own proposal untouched.
 */
export function applyPostReviewGates(proposedDecision, evidence, policy) {
  const mandatoryReasons = evaluateMandatoryEscalationReasons(evidence, policy);
  const evidenceMismatchReasons = evaluateEvidenceMismatchReasons(proposedDecision, evidence);
  const policyRestrictionReasons = evaluatePolicyRestrictionReasons(proposedDecision, policy);
  const allReasons = [...mandatoryReasons, ...evidenceMismatchReasons, ...policyRestrictionReasons];

  if (allReasons.length === 0) {
    return { decision: proposedDecision, overridden: false, reasons: [] };
  }

  if (policyRestrictionReasons.length > 0) {
    return { decision: "ceo_decision_required", overridden: proposedDecision !== "ceo_decision_required", reasons: allReasons };
  }

  const floorDecision = "ceo_decision_required";
  const finalDecision = DECISION_RANK[proposedDecision] >= DECISION_RANK[floorDecision] ? proposedDecision : floorDecision;
  return { decision: finalDecision, overridden: finalDecision !== proposedDecision, reasons: allReasons };
}

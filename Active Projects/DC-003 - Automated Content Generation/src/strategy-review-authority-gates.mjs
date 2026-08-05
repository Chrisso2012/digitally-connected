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
//
// DC-003-I029.3.1 — Delivery Status Authority Gate, added after the
// DC-003-I029.4 end-to-end smoke test proved this gap real: a Delivery
// Report whose own overall `status` is "failed" or "partial" was NOT, by
// itself, a mandatory-escalation condition here — only test/fixture
// failure was checked (evaluateEvidenceMismatchReasons), so a Delivery
// Report independently verified as "failed" (no real commit landed) but
// carrying self-reported "tests passed" counters could still receive a
// routine "approved" review. evaluateDeliveryStatusReasons() is a SECOND,
// separate, lower-ranked floor (correction_required, not
// ceo_decision_required) — a non-"completed" Delivery Report status can
// never resolve to "approved," but by itself it is not automatically a
// CEO-escalation matter either: the brief's own default is
// "correction_required," with escalation to "ceo_decision_required"
// reserved for cases where an EXISTING mandatory reason (unverifiable
// repo, conflicts, history rewrite, credential/infrastructure/
// architecture files, live requests, wrong branch, changed-file count) is
// ALSO present, or policy.allowCorrectionSpecifications forbids issuing a
// correction at all. See README "Delivery Status Authority Gate
// (DC-003-I029.3.1)".

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
 * DC-003-I029.3.1 — the Delivery Status Authority Gate's own reasons.
 * Returns a non-empty array whenever the Delivery Report's own overall
 * status is not "completed" — the single fact this gate exists to enforce
 * cannot be waived by passing test/fixture counters (checked separately,
 * see evaluateEvidenceMismatchReasons), by the model's own summary, or by
 * anything the caller supplies. Used both pre- and post-review.
 */
function evaluateDeliveryStatusReasons(evidence) {
  const reasons = [];
  if (evidence.deliveryReportStatus !== "completed") {
    reasons.push(
      `Delivery Report status is "${evidence.deliveryReportStatus}", not "completed" — only a completed delivery is eligible for routine approval.`
    );
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
 * `{ forced: true, decision, reasons }` when the evidence alone already
 * determines the outcome (the adapter is never invoked in this case —
 * see automated-strategy-review-service.mjs), or
 * `{ forced: false, reasons: [] }` otherwise.
 *
 * Two independent forcing conditions, checked in order:
 *
 *   1. A mandatory escalation reason (repo unverifiable, conflicts,
 *      history rewrite, credential/infrastructure/architecture files,
 *      live requests, wrong branch, changed-file count) forces
 *      "ceo_decision_required" — unchanged since I029.3.
 *   2. DC-003-I029.3.1 — a Delivery Report whose own status is "failed"
 *      is, by itself, already deterministically sufficient to require at
 *      least a correction (the brief's own default) — the adapter is
 *      skipped entirely rather than spending a request on a decision that
 *      could never legitimately be "approved." Downgraded further to
 *      "ceo_decision_required" only if policy forbids issuing a
 *      correction at all (policy.allowCorrectionSpecifications=false).
 *
 * A "partial" Delivery Report is deliberately NOT forced here: whether
 * the remaining work is safely correctable within the Work Order or
 * requires CEO-level scope/roadmap judgment is exactly the kind of call
 * this deterministic layer cannot make on its own — the adapter is still
 * invoked, and applyPostReviewGates() guarantees the final decision can
 * never be "approved" regardless of what it proposes.
 */
export function evaluatePreReviewGates(evidence, policy) {
  const mandatoryReasons = evaluateMandatoryEscalationReasons(evidence, policy);
  if (mandatoryReasons.length > 0) {
    return { forced: true, decision: "ceo_decision_required", reasons: mandatoryReasons };
  }

  if (evidence.deliveryReportStatus === "failed") {
    const reasons = evaluateDeliveryStatusReasons(evidence);
    if (!policy.allowCorrectionSpecifications) {
      return {
        forced: true,
        decision: "ceo_decision_required",
        reasons: [...reasons, "Policy does not permit generating correction specifications for this review."],
      };
    }
    return { forced: true, decision: "correction_required", reasons };
  }

  return { forced: false, reasons: [] };
}

/**
 * Post-review gate check — call AFTER the adapter returns a validated
 * proposal. Combines reason categories and returns the FINAL decision the
 * service must use:
 *
 *   - a policy restriction on the proposed decision TYPE itself (e.g.
 *     allowAutomaticRejection=false) is absolute — always forces
 *     ceo_decision_required, regardless of how "severe" the proposed
 *     decision already was;
 *   - mandatory evidence-based reasons and an evidence/approval mismatch
 *     (including DC-003-I029.3.1's own test/fixture-vs-status check) are a
 *     FLOOR at ceo_decision_required;
 *   - DC-003-I029.3.1 — a non-"completed" Delivery Report status, with no
 *     ceo-tier reason otherwise present, is a SEPARATE, lower FLOOR at
 *     correction_required (or ceo_decision_required when policy forbids a
 *     correction) — this is what prevents an "approved" proposal for a
 *     failed/partial delivery from ever surviving, while still defaulting
 *     to the brief's own "correction_required," not immediate escalation;
 *   - whichever floor is higher-ranked wins; a floor never downgrades an
 *     already-more-cautious proposal (e.g. the model's own "rejected");
 *   - no reasons at all leaves the model's own proposal untouched.
 */
export function applyPostReviewGates(proposedDecision, evidence, policy) {
  const mandatoryReasons = evaluateMandatoryEscalationReasons(evidence, policy);
  const evidenceMismatchReasons = evaluateEvidenceMismatchReasons(proposedDecision, evidence);
  const policyRestrictionReasons = evaluatePolicyRestrictionReasons(proposedDecision, policy);
  const deliveryStatusReasons = evaluateDeliveryStatusReasons(evidence);

  const ceoTierReasons = [...mandatoryReasons, ...evidenceMismatchReasons];
  const allReasons = [...ceoTierReasons, ...policyRestrictionReasons, ...deliveryStatusReasons];

  if (allReasons.length === 0) {
    return { decision: proposedDecision, overridden: false, reasons: [] };
  }

  if (policyRestrictionReasons.length > 0) {
    return { decision: "ceo_decision_required", overridden: proposedDecision !== "ceo_decision_required", reasons: allReasons };
  }

  const floorDecision =
    ceoTierReasons.length > 0 ? "ceo_decision_required" : policy.allowCorrectionSpecifications ? "correction_required" : "ceo_decision_required";
  const finalDecision = DECISION_RANK[proposedDecision] >= DECISION_RANK[floorDecision] ? proposedDecision : floorDecision;
  return { decision: finalDecision, overridden: finalDecision !== proposedDecision, reasons: allReasons };
}

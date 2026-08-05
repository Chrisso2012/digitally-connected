import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMandatoryEscalationReasons, evaluatePreReviewGates, applyPostReviewGates } from "../../src/strategy-review-authority-gates.mjs";
import { createStrategyReviewPolicy } from "../../src/strategy-review-policy.mjs";

const POLICY = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main" });

function cleanEvidence(overrides = {}) {
  return {
    repository: { branch: "main", verifiable: true, ...overrides.repository },
    hasUnresolvedConflict: false,
    possibleHistoryRewrite: false,
    credentialFilesDetected: [],
    infrastructureFilesChanged: [],
    architectureSensitiveFilesChanged: [],
    deliveryReportLiveRequestsOccurred: false,
    filesCreated: [],
    filesModified: [],
    tests: { status: "passed" },
    fixtures: { status: "passed" },
    // DC-003-I029.3.1 — "completed" so every pre-existing test in this
    // file keeps exercising exactly what it exercised before the Delivery
    // Status Authority Gate existed; tests for the new gate itself pass
    // deliveryReportStatus: "failed"/"partial" explicitly.
    deliveryReportStatus: "completed",
    ...overrides,
  };
}

// --- evaluateMandatoryEscalationReasons ------------------------------

test("evaluateMandatoryEscalationReasons(): clean evidence produces no reasons", () => {
  assert.deepEqual(evaluateMandatoryEscalationReasons(cleanEvidence(), POLICY), []);
});

test("evaluateMandatoryEscalationReasons(): unverifiable repository is a mandatory reason", () => {
  const reasons = evaluateMandatoryEscalationReasons(cleanEvidence({ repository: { branch: "main", verifiable: false } }), POLICY);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /could not be independently verified/);
});

test("evaluateMandatoryEscalationReasons(): unresolved merge conflict is mandatory", () => {
  assert.equal(evaluateMandatoryEscalationReasons(cleanEvidence({ hasUnresolvedConflict: true }), POLICY).length, 1);
});

test("evaluateMandatoryEscalationReasons(): possible history rewrite is mandatory", () => {
  assert.equal(evaluateMandatoryEscalationReasons(cleanEvidence({ possibleHistoryRewrite: true }), POLICY).length, 1);
});

test("evaluateMandatoryEscalationReasons(): credential-shaped files are mandatory", () => {
  const reasons = evaluateMandatoryEscalationReasons(cleanEvidence({ credentialFilesDetected: [".env"] }), POLICY);
  assert.match(reasons[0], /Credential-shaped/);
});

test("evaluateMandatoryEscalationReasons(): infrastructure files are mandatory", () => {
  assert.equal(evaluateMandatoryEscalationReasons(cleanEvidence({ infrastructureFilesChanged: ["Dockerfile"] }), POLICY).length, 1);
});

test("evaluateMandatoryEscalationReasons(): architecture-sensitive files are mandatory", () => {
  assert.equal(evaluateMandatoryEscalationReasons(cleanEvidence({ architectureSensitiveFilesChanged: ["schemas/foo.json"] }), POLICY).length, 1);
});

test("evaluateMandatoryEscalationReasons(): a recorded live external request is mandatory", () => {
  assert.equal(evaluateMandatoryEscalationReasons(cleanEvidence({ deliveryReportLiveRequestsOccurred: true }), POLICY).length, 1);
});

test("evaluateMandatoryEscalationReasons(): wrong branch is mandatory unless the policy allows it", () => {
  const wrongBranch = cleanEvidence({ repository: { branch: "some-other-branch", verifiable: true } });
  assert.equal(evaluateMandatoryEscalationReasons(wrongBranch, POLICY).length, 1);
  const permissive = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", allowDeliveryBranchDifferFromMain: true });
  assert.equal(evaluateMandatoryEscalationReasons(wrongBranch, permissive).length, 0);
});

test("evaluateMandatoryEscalationReasons(): exceeding maxChangedFileCount is mandatory", () => {
  const capped = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxChangedFileCount: 2 });
  const evidence = cleanEvidence({ filesCreated: ["a", "b"], filesModified: ["c"] });
  assert.equal(evaluateMandatoryEscalationReasons(evidence, capped).length, 1);
});

test("evaluateMandatoryEscalationReasons(): multiple simultaneous conditions all appear", () => {
  const reasons = evaluateMandatoryEscalationReasons(cleanEvidence({ hasUnresolvedConflict: true, credentialFilesDetected: [".env"] }), POLICY);
  assert.equal(reasons.length, 2);
});

// --- evaluatePreReviewGates -----------------------------------------

test("evaluatePreReviewGates(): forced=false for clean evidence", () => {
  assert.deepEqual(evaluatePreReviewGates(cleanEvidence(), POLICY), { forced: false, reasons: [] });
});

test("evaluatePreReviewGates(): forced=true, decision ceo_decision_required, for unsafe evidence", () => {
  const result = evaluatePreReviewGates(cleanEvidence({ hasUnresolvedConflict: true }), POLICY);
  assert.equal(result.forced, true);
  assert.equal(result.decision, "ceo_decision_required");
  assert.equal(result.reasons.length, 1);
});

// --- applyPostReviewGates ----------------------------------------------

test("applyPostReviewGates(): a clean proposal passes through unchanged", () => {
  const result = applyPostReviewGates("approved", cleanEvidence(), POLICY);
  assert.deepEqual(result, { decision: "approved", overridden: false, reasons: [] });
});

test("applyPostReviewGates(): approval is overridden to ceo_decision_required when tests failed", () => {
  const result = applyPostReviewGates("approved", cleanEvidence({ tests: { status: "failed" } }), POLICY);
  assert.equal(result.decision, "ceo_decision_required");
  assert.equal(result.overridden, true);
});

test("applyPostReviewGates(): approval is overridden when fixtures failed", () => {
  const result = applyPostReviewGates("approved", cleanEvidence({ fixtures: { status: "failed" } }), POLICY);
  assert.equal(result.decision, "ceo_decision_required");
});

test("applyPostReviewGates(): approval is overridden when policy.allowRoutineApproval is false", () => {
  const strict = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", allowRoutineApproval: false });
  const result = applyPostReviewGates("approved", cleanEvidence(), strict);
  assert.equal(result.decision, "ceo_decision_required");
  assert.equal(result.overridden, true);
});

test("applyPostReviewGates(): rejected is never downgraded to ceo_decision_required by a mandatory gate", () => {
  const result = applyPostReviewGates("rejected", cleanEvidence({ hasUnresolvedConflict: true }), POLICY);
  assert.equal(result.decision, "rejected");
});

test("applyPostReviewGates(): rejected is overridden to ceo_decision_required when policy forbids automatic rejection", () => {
  const strict = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", allowAutomaticRejection: false });
  const result = applyPostReviewGates("rejected", cleanEvidence(), strict);
  assert.equal(result.decision, "ceo_decision_required");
});

test("applyPostReviewGates(): correction_required is overridden when policy forbids correction specifications", () => {
  const strict = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", allowCorrectionSpecifications: false });
  const result = applyPostReviewGates("correction_required", cleanEvidence(), strict);
  assert.equal(result.decision, "ceo_decision_required");
});

test("applyPostReviewGates(): ceo_decision_required proposal with no mandatory reasons still stands unchanged", () => {
  const result = applyPostReviewGates("ceo_decision_required", cleanEvidence(), POLICY);
  assert.deepEqual(result, { decision: "ceo_decision_required", overridden: false, reasons: [] });
});

// --- DC-003-I029.3.1: Delivery Status Authority Gate ---------------------
//
// Discovered via the DC-003-I029.4 end-to-end smoke test: a Delivery
// Report independently verified as "failed" (or "partial") could still
// receive a routine "approved" review as long as its own self-reported
// test/fixture counters showed passing — nothing here checked the
// Delivery Report's own overall status. These tests exercise the fix
// directly at the gate layer (the smallest, purest place to prove the
// rule); tests/unit/automated-strategy-review-service.test.mjs exercises
// the same rule through the real service.

test("evaluatePreReviewGates(): a 'completed' status is never forced by the delivery-status gate", () => {
  const result = evaluatePreReviewGates(cleanEvidence({ deliveryReportStatus: "completed" }), POLICY);
  assert.deepEqual(result, { forced: false, reasons: [] });
});

test("evaluatePreReviewGates(): a 'failed' status alone (no other mandatory reason) is forced to correction_required, skipping the adapter", () => {
  const result = evaluatePreReviewGates(cleanEvidence({ deliveryReportStatus: "failed" }), POLICY);
  assert.equal(result.forced, true);
  assert.equal(result.decision, "correction_required");
  assert.equal(result.reasons.length, 1);
  assert.match(result.reasons[0], /Delivery Report status is "failed"/);
});

test("evaluatePreReviewGates(): a 'failed' status is forced to ceo_decision_required when policy forbids correction specifications", () => {
  const strict = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", allowCorrectionSpecifications: false });
  const result = evaluatePreReviewGates(cleanEvidence({ deliveryReportStatus: "failed" }), strict);
  assert.equal(result.forced, true);
  assert.equal(result.decision, "ceo_decision_required");
});

test("evaluatePreReviewGates(): a 'failed' status alongside an existing mandatory reason still forces ceo_decision_required, not correction_required", () => {
  const result = evaluatePreReviewGates(cleanEvidence({ deliveryReportStatus: "failed", hasUnresolvedConflict: true }), POLICY);
  assert.equal(result.forced, true);
  assert.equal(result.decision, "ceo_decision_required");
  assert.equal(result.reasons.length, 1, "the mandatory-reason check short-circuits before the delivery-status check even runs");
});

test("evaluatePreReviewGates(): a 'partial' status is NOT forced — the adapter is still invoked, since correctable-vs-CEO-judgment cannot be determined from status alone", () => {
  const result = evaluatePreReviewGates(cleanEvidence({ deliveryReportStatus: "partial" }), POLICY);
  assert.deepEqual(result, { forced: false, reasons: [] });
});

test("applyPostReviewGates(): an 'approved' proposal for a 'partial' delivery is overridden to correction_required, even with fully passing test/fixture evidence", () => {
  const evidence = cleanEvidence({ deliveryReportStatus: "partial", tests: { status: "passed" }, fixtures: { status: "passed" } });
  const result = applyPostReviewGates("approved", evidence, POLICY);
  assert.equal(result.decision, "correction_required");
  assert.equal(result.overridden, true);
});

test("applyPostReviewGates(): an 'approved' proposal for a 'failed' delivery is overridden to correction_required — proves passing counters cannot override overall status (gate-level; a full review flow pre-gates 'failed' before ever reaching an adapter, see automated-strategy-review-service.test.mjs)", () => {
  const evidence = cleanEvidence({ deliveryReportStatus: "failed", tests: { status: "passed" }, fixtures: { status: "passed" } });
  const result = applyPostReviewGates("approved", evidence, POLICY);
  assert.equal(result.decision, "correction_required");
  assert.equal(result.overridden, true);
});

test("applyPostReviewGates(): an 'approved' proposal for a 'partial' delivery escalates to ceo_decision_required when policy forbids correction specifications", () => {
  const strict = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", allowCorrectionSpecifications: false });
  const result = applyPostReviewGates("approved", cleanEvidence({ deliveryReportStatus: "partial" }), strict);
  assert.equal(result.decision, "ceo_decision_required");
});

test("applyPostReviewGates(): a 'rejected' proposal is never downgraded by the delivery-status gate — for 'failed' evidence", () => {
  const result = applyPostReviewGates("rejected", cleanEvidence({ deliveryReportStatus: "failed" }), POLICY);
  assert.equal(result.decision, "rejected");
  assert.equal(result.overridden, false, "a proposal already at/above the highest rank produces no override, matching the pre-existing floor-comparison contract");
  assert.equal(result.reasons.length, 1, "the delivery-status reason is still recorded as evidence even though it didn't need to override anything");
});

test("applyPostReviewGates(): a 'rejected' proposal is never downgraded by the delivery-status gate — for 'partial' evidence", () => {
  const result = applyPostReviewGates("rejected", cleanEvidence({ deliveryReportStatus: "partial" }), POLICY);
  assert.equal(result.decision, "rejected");
  assert.equal(result.overridden, false);
});

test("applyPostReviewGates(): a 'ceo_decision_required' proposal for a 'partial' delivery is left alone — the model's own CEO-level judgment is respected, not replaced by the lower correction floor", () => {
  const result = applyPostReviewGates("ceo_decision_required", cleanEvidence({ deliveryReportStatus: "partial" }), POLICY);
  assert.equal(result.decision, "ceo_decision_required");
  assert.equal(result.overridden, false);
});

test("applyPostReviewGates(): a 'correction_required' proposal for a 'partial' delivery that already meets the floor is left alone", () => {
  const result = applyPostReviewGates("correction_required", cleanEvidence({ deliveryReportStatus: "partial" }), POLICY);
  assert.equal(result.decision, "correction_required");
  assert.equal(result.overridden, false);
});

test("applyPostReviewGates(): an existing mandatory reason (credential file) outranks the delivery-status floor for a 'partial' delivery", () => {
  const evidence = cleanEvidence({ deliveryReportStatus: "partial", credentialFilesDetected: [".env"] });
  const result = applyPostReviewGates("approved", evidence, POLICY);
  assert.equal(result.decision, "ceo_decision_required");
  assert.equal(result.reasons.length, 2, "both the mandatory reason and the delivery-status reason are recorded");
});

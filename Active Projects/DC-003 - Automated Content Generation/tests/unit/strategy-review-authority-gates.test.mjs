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

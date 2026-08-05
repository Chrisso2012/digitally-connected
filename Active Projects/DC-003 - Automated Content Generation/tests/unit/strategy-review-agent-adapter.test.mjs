import test from "node:test";
import assert from "node:assert/strict";
import { assertValidStrategyReviewAgentAdapter, assertValidReviewProposal } from "../../src/strategy-review-agent-adapter.mjs";
import { InvalidStrategyReviewAgentAdapterError, MalformedReviewProposalError } from "../../src/strategy-review-errors.mjs";

function validProposal(overrides = {}) {
  return {
    decision: "approved",
    criteria: [
      { criterionIndex: 1, result: "pass", evidence: [{ source: "independent-verification", summary: "ok" }], reason: null },
      { criterionIndex: 2, result: "pass", evidence: [], reason: null },
    ],
    risks: [],
    correction: null,
    ceoEscalation: null,
    summary: "All good",
    ...overrides,
  };
}

test("assertValidStrategyReviewAgentAdapter(): accepts a correctly-shaped adapter", () => {
  assert.doesNotThrow(() => assertValidStrategyReviewAgentAdapter({ name: "x", reviewDelivery: async () => {} }));
});

test("assertValidStrategyReviewAgentAdapter(): rejects a missing name/reviewDelivery", () => {
  assert.throws(() => assertValidStrategyReviewAgentAdapter({}), InvalidStrategyReviewAgentAdapterError);
  assert.throws(() => assertValidStrategyReviewAgentAdapter(null), InvalidStrategyReviewAgentAdapterError);
});

test("assertValidReviewProposal(): accepts a fully-shaped proposal", () => {
  const proposal = validProposal();
  assert.equal(assertValidReviewProposal(proposal, 2), proposal);
});

test("assertValidReviewProposal(): rejects an unknown decision", () => {
  assert.throws(() => assertValidReviewProposal(validProposal({ decision: "auto_merge" }), 2), MalformedReviewProposalError);
});

test("assertValidReviewProposal(): rejects a criteria array with the wrong length", () => {
  assert.throws(() => assertValidReviewProposal(validProposal({ criteria: [validProposal().criteria[0]] }), 2), MalformedReviewProposalError);
});

test("assertValidReviewProposal(): rejects a missing criterion index (1..N not fully covered)", () => {
  const proposal = validProposal();
  proposal.criteria = [proposal.criteria[0], { ...proposal.criteria[0], criterionIndex: 1 }]; // index 2 never appears
  assert.throws(() => assertValidReviewProposal(proposal, 2), MalformedReviewProposalError);
});

test("assertValidReviewProposal(): rejects a duplicate criterion index", () => {
  const proposal = validProposal();
  proposal.criteria[1] = { ...proposal.criteria[0] }; // both index 1
  assert.throws(() => assertValidReviewProposal(proposal, 2), MalformedReviewProposalError);
});

test("assertValidReviewProposal(): accepts criteria out of array order as long as every index 1..N is covered once", () => {
  const proposal = validProposal();
  proposal.criteria = [proposal.criteria[1], proposal.criteria[0]];
  assert.doesNotThrow(() => assertValidReviewProposal(proposal, 2));
});

test("assertValidReviewProposal(): rejects a non-pass criterion with a null reason", () => {
  const proposal = validProposal();
  proposal.criteria[0] = { ...proposal.criteria[0], result: "fail", reason: null };
  assert.throws(() => assertValidReviewProposal(proposal, 2), MalformedReviewProposalError);
});

test("assertValidReviewProposal(): rejects a malformed evidence entry", () => {
  const proposal = validProposal();
  proposal.criteria[0] = { ...proposal.criteria[0], evidence: [{ source: "guesswork", summary: "x" }] };
  assert.throws(() => assertValidReviewProposal(proposal, 2), MalformedReviewProposalError);
});

test("assertValidReviewProposal(): requires a correction object when decision is correction_required", () => {
  assert.throws(() => assertValidReviewProposal(validProposal({ decision: "correction_required" }), 2), MalformedReviewProposalError);
  const withCorrection = validProposal({
    decision: "correction_required",
    correction: { failedCriteria: [1], requiredOutcome: "x", prohibitedScopeExpansion: "y", verificationRequired: "z" },
  });
  assert.doesNotThrow(() => assertValidReviewProposal(withCorrection, 2));
});

test("assertValidReviewProposal(): requires a ceoEscalation object when decision is ceo_decision_required", () => {
  assert.throws(() => assertValidReviewProposal(validProposal({ decision: "ceo_decision_required" }), 2), MalformedReviewProposalError);
  const withEscalation = validProposal({
    decision: "ceo_decision_required",
    ceoEscalation: { decisionRequired: "x", reason: "y", safeOptions: [] },
  });
  assert.doesNotThrow(() => assertValidReviewProposal(withEscalation, 2));
});

test("assertValidReviewProposal(): rejects a missing summary", () => {
  assert.throws(() => assertValidReviewProposal(validProposal({ summary: "" }), 2), MalformedReviewProposalError);
});

test("assertValidReviewProposal(): rejects a non-object proposal entirely", () => {
  assert.throws(() => assertValidReviewProposal(null, 2), MalformedReviewProposalError);
  assert.throws(() => assertValidReviewProposal({ decision: "approved" }, 2), MalformedReviewProposalError);
});

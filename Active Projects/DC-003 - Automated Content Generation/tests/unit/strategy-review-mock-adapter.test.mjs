import test from "node:test";
import assert from "node:assert/strict";
import { createStrategyReviewMockAdapter } from "../../src/strategy-review-mock-adapter.mjs";
import { assertValidReviewProposal } from "../../src/strategy-review-agent-adapter.mjs";
import { ReviewAdapterExecutionFailedError } from "../../src/strategy-review-errors.mjs";

const WORK_ORDER = { milestone: "DC-003-I029.3", review_criteria: ["Criterion A", "Criterion B"] };
const DELIVERY_REPORT = {};
const EVIDENCE = {};

async function run(mode) {
  const adapter = createStrategyReviewMockAdapter({ mode });
  return adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: {} });
}

test("mock adapter: name is stable", () => {
  assert.equal(createStrategyReviewMockAdapter().name, "mock-strategy-review-adapter");
});

test("mock adapter: default mode ('approved') is a valid proposal, every criterion passes", async () => {
  const proposal = await run(undefined);
  assertValidReviewProposal(proposal, 2);
  assert.equal(proposal.decision, "approved");
  assert.ok(proposal.criteria.every((c) => c.result === "pass"));
});

test("mock adapter: 'correction-required' mode is valid, one criterion fails with a correction spec", async () => {
  const proposal = await run("correction-required");
  assertValidReviewProposal(proposal, 2);
  assert.equal(proposal.decision, "correction_required");
  assert.equal(proposal.correction.failedCriteria[0], 1);
});

test("mock adapter: 'ceo-escalation' mode is valid, includes a non-empty escalation reason", async () => {
  const proposal = await run("ceo-escalation");
  assertValidReviewProposal(proposal, 2);
  assert.equal(proposal.decision, "ceo_decision_required");
  assert.ok(proposal.ceoEscalation.reason.length > 0);
});

test("mock adapter: 'rejected' mode is valid, every criterion fails", async () => {
  const proposal = await run("rejected");
  assertValidReviewProposal(proposal, 2);
  assert.equal(proposal.decision, "rejected");
  assert.ok(proposal.criteria.every((c) => c.result === "fail"));
});

test("mock adapter: 'malformed' mode returns a shape assertValidReviewProposal() rejects", async () => {
  const proposal = await run("malformed");
  assert.throws(() => assertValidReviewProposal(proposal, 2));
});

test("mock adapter: 'missing-criterion' mode returns too few criteria", async () => {
  const proposal = await run("missing-criterion");
  assert.throws(() => assertValidReviewProposal(proposal, 2));
});

test("mock adapter: 'duplicate-criterion' mode returns a duplicated criterion index", async () => {
  const proposal = await run("duplicate-criterion");
  assert.throws(() => assertValidReviewProposal(proposal, 2));
});

test("mock adapter: 'unsupported-decision' mode returns a decision outside the known enum", async () => {
  const proposal = await run("unsupported-decision");
  assert.throws(() => assertValidReviewProposal(proposal, 2));
});

test("mock adapter: 'unsafe-approval' mode passes shape validation but proposes approval unconditionally — the service's own gates, not this adapter, must catch it", async () => {
  const proposal = await run("unsafe-approval");
  assertValidReviewProposal(proposal, 2); // structurally valid
  assert.equal(proposal.decision, "approved");
});

test("mock adapter: 'timeout' mode throws ReviewAdapterExecutionFailedError", async () => {
  await assert.rejects(() => run("timeout"), ReviewAdapterExecutionFailedError);
});

test("mock adapter: 'provider-failure' mode throws ReviewAdapterExecutionFailedError", async () => {
  await assert.rejects(() => run("provider-failure"), ReviewAdapterExecutionFailedError);
});

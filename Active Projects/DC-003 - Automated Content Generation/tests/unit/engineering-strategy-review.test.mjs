import test from "node:test";
import assert from "node:assert/strict";
import { createEngineeringStrategyReview } from "../../src/engineering-strategy-review.mjs";
import { InvalidEngineeringStrategyReviewInputError, EngineeringStrategyReviewValidationError } from "../../src/engineering-strategy-review-errors.mjs";

const CRITERIA_TEXT = ["Existing tests remain green.", "No scope creep."];

function baseFields(overrides = {}) {
  return {
    workOrderId: "wo_reviewtest0000001",
    deliveryReportId: "dr_reviewtest0000001",
    workOrderReviewCriteria: CRITERIA_TEXT,
    milestone: "DC-003-I029.3",
    reviewerProvider: "mock",
    decision: "approved",
    criteria: CRITERIA_TEXT.map((criterion, i) => ({
      criterionIndex: i + 1,
      criterion,
      result: "pass",
      evidence: [{ source: "independent-verification", summary: "ok" }],
      reason: null,
    })),
    repositoryEvidence: { startingCommit: "aaa1111", endingCommit: "bbb2222", branch: "main", workingTree: "clean", pushStatus: "not_applicable", verifiable: true },
    verification: {
      tests: { status: "passed", passed: 10, failed: 0, total: 10, source: "independent-verification" },
      fixtures: { status: "passed", passed: 5, failed: 0, total: 5, source: "independent-verification" },
    },
    summary: "All good.",
    ...overrides,
  };
}

const OPTIONS = { now: () => "2026-08-05T12:00:00.000Z", idGenerator: () => "esr_test0000000001" };

test("createEngineeringStrategyReview(): builds a valid, immutable, deep-frozen review", () => {
  const review = createEngineeringStrategyReview(baseFields(), OPTIONS);
  assert.equal(review.strategy_review_id, "esr_test0000000001");
  assert.equal(review.decision, "approved");
  assert.equal(review.criteria.length, 2);
  assert.throws(() => {
    "use strict";
    review.decision = "rejected";
  });
});

test("createEngineeringStrategyReview(): rejects a criteria array whose length doesn't match the Work Order's own criteria", () => {
  assert.throws(() => createEngineeringStrategyReview(baseFields({ criteria: baseFields().criteria.slice(0, 1) }), OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

test("createEngineeringStrategyReview(): rejects a criterion whose text does not match the Work Order verbatim", () => {
  const fields = baseFields();
  fields.criteria = [...fields.criteria];
  fields.criteria[0] = { ...fields.criteria[0], criterion: "Invented criterion text." };
  assert.throws(() => createEngineeringStrategyReview(fields, OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

test("createEngineeringStrategyReview(): rejects criteria out of order (criterion_index must match array position)", () => {
  const fields = baseFields();
  fields.criteria = [fields.criteria[1], fields.criteria[0]]; // reversed
  assert.throws(() => createEngineeringStrategyReview(fields, OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

test("createEngineeringStrategyReview(): rejects a non-pass criterion with a null reason", () => {
  const fields = baseFields();
  fields.criteria = [...fields.criteria];
  fields.criteria[0] = { ...fields.criteria[0], result: "fail", reason: null };
  assert.throws(() => createEngineeringStrategyReview(fields, OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

test("createEngineeringStrategyReview(): rejects decision 'approved' when any criterion result is 'fail'", () => {
  const fields = baseFields();
  fields.criteria = [...fields.criteria];
  fields.criteria[0] = { ...fields.criteria[0], result: "fail", reason: "failed" };
  assert.throws(() => createEngineeringStrategyReview(fields, OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

test("createEngineeringStrategyReview(): 'correction_required' requires a correction specification referencing only failing criteria", () => {
  const fields = baseFields({ decision: "correction_required" });
  fields.criteria = [...fields.criteria];
  fields.criteria[0] = { ...fields.criteria[0], result: "fail", reason: "failed" };
  assert.throws(() => createEngineeringStrategyReview(fields, OPTIONS), InvalidEngineeringStrategyReviewInputError, "missing correction");

  const withCorrection = createEngineeringStrategyReview(
    {
      ...fields,
      correction: { failedCriteria: [1], requiredOutcome: "fix it", prohibitedScopeExpansion: "nothing else", verificationRequired: "rerun tests" },
    },
    OPTIONS
  );
  assert.equal(withCorrection.decision, "correction_required");
  assert.equal(withCorrection.correction.failed_criteria[0], 1);
});

test("createEngineeringStrategyReview(): correction.failedCriteria may not reference a passing criterion", () => {
  const fields = baseFields({ decision: "correction_required" });
  fields.criteria = [...fields.criteria];
  fields.criteria[0] = { ...fields.criteria[0], result: "fail", reason: "failed" };
  fields.correction = { failedCriteria: [2], requiredOutcome: "x", prohibitedScopeExpansion: "y", verificationRequired: "z" }; // 2 still passes
  assert.throws(() => createEngineeringStrategyReview(fields, OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

test("createEngineeringStrategyReview(): 'ceo_decision_required' requires a non-empty escalation reason", () => {
  const fields = baseFields({ decision: "ceo_decision_required" });
  assert.throws(() => createEngineeringStrategyReview(fields, OPTIONS), InvalidEngineeringStrategyReviewInputError);

  const withEscalation = createEngineeringStrategyReview(
    { ...fields, ceoEscalation: { decisionRequired: "x", reason: "needs CEO", safeOptions: ["stop"] } },
    OPTIONS
  );
  assert.equal(withEscalation.decision, "ceo_decision_required");
  assert.equal(withEscalation.ceo_escalation.default_safe_action, "stop");
});

test("createEngineeringStrategyReview(): correction must be null unless decision is correction_required", () => {
  const fields = baseFields({ correction: { failedCriteria: [1], requiredOutcome: "x", prohibitedScopeExpansion: "y", verificationRequired: "z" } });
  assert.throws(() => createEngineeringStrategyReview(fields, OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

test("createEngineeringStrategyReview(): ceoEscalation must be null unless decision is ceo_decision_required", () => {
  const fields = baseFields({ ceoEscalation: { decisionRequired: "x", reason: "y", safeOptions: [] } });
  assert.throws(() => createEngineeringStrategyReview(fields, OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

test("createEngineeringStrategyReview(): rejects an unsupported decision value", () => {
  assert.throws(() => createEngineeringStrategyReview(baseFields({ decision: "auto_merge" }), OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

test("createEngineeringStrategyReview(): 'rejected' decision works with every criterion failing", () => {
  const fields = baseFields({ decision: "rejected" });
  fields.criteria = fields.criteria.map((c) => ({ ...c, result: "fail", reason: "unsafe" }));
  const review = createEngineeringStrategyReview(fields, OPTIONS);
  assert.equal(review.decision, "rejected");
  assert.equal(review.correction, null);
});

test("createEngineeringStrategyReview(): rejects an evidence entry with an invalid source", () => {
  const fields = baseFields();
  fields.criteria = [...fields.criteria];
  fields.criteria[0] = { ...fields.criteria[0], evidence: [{ source: "guesswork", summary: "x" }] };
  assert.throws(() => createEngineeringStrategyReview(fields, OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

test("createEngineeringStrategyReview(): schema validation catches what hand-written checks don't (e.g. an over-long summary)", () => {
  assert.throws(() => createEngineeringStrategyReview(baseFields({ summary: "x".repeat(3000) }), OPTIONS), EngineeringStrategyReviewValidationError);
});

test("createEngineeringStrategyReview(): rejects an invalid workOrderId/deliveryReportId shape", () => {
  assert.throws(() => createEngineeringStrategyReview(baseFields({ workOrderId: "not-a-real-id" }), OPTIONS), InvalidEngineeringStrategyReviewInputError);
  assert.throws(() => createEngineeringStrategyReview(baseFields({ deliveryReportId: "not-a-real-id" }), OPTIONS), InvalidEngineeringStrategyReviewInputError);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createStrategyReviewPolicy, MAX_OPENAI_REQUESTS } from "../../src/strategy-review-policy.mjs";
import { InvalidStrategyReviewPolicyError } from "../../src/strategy-review-errors.mjs";

test("createStrategyReviewPolicy(): conservative defaults", () => {
  const policy = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main" });
  assert.equal(policy.allowDeliveryBranchDifferFromMain, false);
  assert.equal(policy.rerunTests, false);
  assert.equal(policy.rerunFixtures, false);
  assert.equal(policy.maxChangedFileCount, null);
  assert.equal(policy.allowRoutineApproval, true);
  assert.equal(policy.allowCorrectionSpecifications, true);
  assert.equal(policy.allowAutomaticRejection, true);
  assert.equal(policy.maxOpenAiRequests, 1);
});

test("createStrategyReviewPolicy(): maxOpenAiRequests is always MAX_OPENAI_REQUESTS regardless of any caller input", () => {
  const policy = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxOpenAiRequests: 99 });
  assert.equal(policy.maxOpenAiRequests, MAX_OPENAI_REQUESTS);
  assert.equal(policy.maxOpenAiRequests, 1);
});

test("createStrategyReviewPolicy(): requires repositoryPath and permittedBranch", () => {
  assert.throws(() => createStrategyReviewPolicy({ permittedBranch: "main" }), InvalidStrategyReviewPolicyError);
  assert.throws(() => createStrategyReviewPolicy({ repositoryPath: "/repo" }), InvalidStrategyReviewPolicyError);
});

test("createStrategyReviewPolicy(): rejects invalid field types", () => {
  assert.throws(() => createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", rerunTests: "yes" }), InvalidStrategyReviewPolicyError);
  assert.throws(() => createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxChangedFileCount: -1 }), InvalidStrategyReviewPolicyError);
  assert.throws(() => createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxReviewDurationMs: 0 }), InvalidStrategyReviewPolicyError);
});

test("createStrategyReviewPolicy(): the returned policy is deep-frozen", () => {
  const policy = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main" });
  assert.throws(() => {
    "use strict";
    policy.rerunTests = true;
  });
});

test("createStrategyReviewPolicy(): accepts explicit overrides for all optional fields", () => {
  const policy = createStrategyReviewPolicy({
    repositoryPath: "/repo",
    permittedBranch: "main",
    allowDeliveryBranchDifferFromMain: true,
    rerunTests: true,
    rerunFixtures: true,
    maxChangedFileCount: 50,
    allowRoutineApproval: false,
    allowCorrectionSpecifications: false,
    allowAutomaticRejection: false,
  });
  assert.equal(policy.allowDeliveryBranchDifferFromMain, true);
  assert.equal(policy.rerunTests, true);
  assert.equal(policy.maxChangedFileCount, 50);
  assert.equal(policy.allowRoutineApproval, false);
});

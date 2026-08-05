// DC-003-I029.3 — Strategy Review Policy: the explicit description of how
// much authority one automated review may exercise. Mirrors
// execution-policy.mjs's own discipline (I029.2) exactly — conservative
// defaults, explicit required fields, deep-frozen result.
//
// maxOpenAiRequests is deliberately NOT configurable upward from this
// module — it is a hardcoded constant (1), mirroring I029.2's own
// resolveLiveMaxAttempts()/"the one-shot ceiling a policy can never
// override" discipline. A caller who wants more requests must change the
// code, not the config — exactly the property that made I006's own live
// Templated incident (see README) impossible to repeat.

import { InvalidStrategyReviewPolicyError } from "./strategy-review-errors.mjs";
import { deepFreezeClone } from "./immutable.mjs";

export const MAX_OPENAI_REQUESTS = 1;

const DEFAULT_MAX_EVIDENCE_SUMMARY_LENGTH = 500;
const DEFAULT_MAX_REVIEW_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2000;
const DEFAULT_MAX_INPUT_CHARS = 20000;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * Builds an immutable Strategy Review Policy.
 *
 * fields.repositoryPath — required, non-empty string.
 * fields.permittedBranch — required, non-empty string.
 * fields.allowDeliveryBranchDifferFromMain — optional boolean, default
 *   false (conservative: the delivery must have landed on the permitted
 *   branch).
 * fields.rerunTests / rerunFixtures — optional booleans, default false
 *   (conservative: re-running the full suite on every review is
 *   expensive; when false, the collector uses the Delivery Report's own
 *   declared counts, clearly labelled `source: "delivery-report"`).
 * fields.maxChangedFileCount — optional positive integer or null
 *   (unbounded), default null.
 * fields.maxEvidenceSummaryLength — optional positive integer, default 500.
 * fields.maxReviewDurationMs — optional positive integer, default 5 minutes.
 * fields.maxOutputTokens — optional positive integer, default 2000.
 * fields.maxInputChars — optional positive integer, default 20000 — the
 *   bound on the constructed OpenAI instruction's own length.
 * fields.allowRoutineApproval — optional boolean, default true. When
 *   false, every review that would otherwise be "approved" is instead
 *   downgraded to "ceo_decision_required" — an extra-conservative mode,
 *   never the reverse.
 * fields.allowCorrectionSpecifications — optional boolean, default true.
 * fields.allowAutomaticRejection — optional boolean, default true.
 *
 * Throws InvalidStrategyReviewPolicyError for any structurally invalid
 * field.
 */
export function createStrategyReviewPolicy(fields = {}) {
  if (!isNonEmptyString(fields.repositoryPath)) {
    throw new InvalidStrategyReviewPolicyError("fields.repositoryPath is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.permittedBranch)) {
    throw new InvalidStrategyReviewPolicyError("fields.permittedBranch is required and must be a non-empty string");
  }

  const allowDeliveryBranchDifferFromMain = fields.allowDeliveryBranchDifferFromMain ?? false;
  if (typeof allowDeliveryBranchDifferFromMain !== "boolean") {
    throw new InvalidStrategyReviewPolicyError("fields.allowDeliveryBranchDifferFromMain must be a boolean");
  }
  const rerunTests = fields.rerunTests ?? false;
  if (typeof rerunTests !== "boolean") throw new InvalidStrategyReviewPolicyError("fields.rerunTests must be a boolean");
  const rerunFixtures = fields.rerunFixtures ?? false;
  if (typeof rerunFixtures !== "boolean") throw new InvalidStrategyReviewPolicyError("fields.rerunFixtures must be a boolean");

  const maxChangedFileCount = fields.maxChangedFileCount ?? null;
  if (maxChangedFileCount !== null && !isPositiveInteger(maxChangedFileCount)) {
    throw new InvalidStrategyReviewPolicyError("fields.maxChangedFileCount must be a positive integer or null");
  }
  const maxEvidenceSummaryLength = fields.maxEvidenceSummaryLength ?? DEFAULT_MAX_EVIDENCE_SUMMARY_LENGTH;
  if (!isPositiveInteger(maxEvidenceSummaryLength)) throw new InvalidStrategyReviewPolicyError("fields.maxEvidenceSummaryLength must be a positive integer");
  const maxReviewDurationMs = fields.maxReviewDurationMs ?? DEFAULT_MAX_REVIEW_DURATION_MS;
  if (!isPositiveInteger(maxReviewDurationMs)) throw new InvalidStrategyReviewPolicyError("fields.maxReviewDurationMs must be a positive integer");
  const maxOutputTokens = fields.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  if (!isPositiveInteger(maxOutputTokens)) throw new InvalidStrategyReviewPolicyError("fields.maxOutputTokens must be a positive integer");
  const maxInputChars = fields.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  if (!isPositiveInteger(maxInputChars)) throw new InvalidStrategyReviewPolicyError("fields.maxInputChars must be a positive integer");

  const allowRoutineApproval = fields.allowRoutineApproval ?? true;
  if (typeof allowRoutineApproval !== "boolean") throw new InvalidStrategyReviewPolicyError("fields.allowRoutineApproval must be a boolean");
  const allowCorrectionSpecifications = fields.allowCorrectionSpecifications ?? true;
  if (typeof allowCorrectionSpecifications !== "boolean") throw new InvalidStrategyReviewPolicyError("fields.allowCorrectionSpecifications must be a boolean");
  const allowAutomaticRejection = fields.allowAutomaticRejection ?? true;
  if (typeof allowAutomaticRejection !== "boolean") throw new InvalidStrategyReviewPolicyError("fields.allowAutomaticRejection must be a boolean");

  const policy = {
    repositoryPath: fields.repositoryPath,
    permittedBranch: fields.permittedBranch,
    allowDeliveryBranchDifferFromMain,
    rerunTests,
    rerunFixtures,
    maxChangedFileCount,
    maxEvidenceSummaryLength,
    maxReviewDurationMs,
    maxOpenAiRequests: MAX_OPENAI_REQUESTS,
    maxOutputTokens,
    maxInputChars,
    allowRoutineApproval,
    allowCorrectionSpecifications,
    allowAutomaticRejection,
  };

  return deepFreezeClone(policy);
}

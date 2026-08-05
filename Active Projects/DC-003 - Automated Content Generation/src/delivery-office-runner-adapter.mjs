// DC-003-I029.2 — Delivery Office Runner Adapter: the provider-neutral
// contract every Automated Delivery Office Runner implementation (the
// mock in delivery-office-mock-runner-adapter.mjs, the real one in
// claude-code-delivery-runner-adapter.mjs) must satisfy. Mirrors every
// other Adapter contract-checker file in this codebase
// (finished-carousel-store-adapter.mjs, production-asset-export-adapter.mjs,
// social-publisher-adapter.mjs) — a shape check, not a base class.
//
//   { name: string,
//     executeWorkOrder({ workOrder, repository, executionPolicy }): Promise<RunnerResult> }
//
// No Claude-specific response shape may cross this boundary — every
// adapter (mock or real) must already return the normalised Structured
// Runner Result shape below; assertValidRunnerResult() is the one place
// that shape is enforced, so a caller (automated-delivery-office-service.mjs)
// never has to trust an adapter blindly.

import { InvalidDeliveryOfficeRunnerAdapterError, MalformedRunnerResultError } from "./delivery-office-errors.mjs";

export const RUNNER_RESULT_STATUSES = ["completed", "failed", "timeout", "interrupted"];
export const PUSH_STATUSES = ["pushed", "not_pushed", "not_applicable"];
export const WORKING_TREE_STATES = ["clean", "dirty"];

export function assertValidDeliveryOfficeRunnerAdapter(adapter) {
  if (!adapter || typeof adapter.name !== "string" || typeof adapter.executeWorkOrder !== "function") {
    throw new InvalidDeliveryOfficeRunnerAdapterError();
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function fail(workOrderId, reason) {
  throw new MalformedRunnerResultError(workOrderId, reason);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function assertValidCountSummary(value, workOrderId, label) {
  if (!value || typeof value !== "object") fail(workOrderId, `${label} is required`);
  if (!isNonNegativeInteger(value.passed) || !isNonNegativeInteger(value.failed) || !isNonNegativeInteger(value.total)) {
    fail(workOrderId, `${label} must be { passed, failed, total }, each a non-negative integer`);
  }
}

/**
 * Validates that a runner adapter's returned result matches the
 * Structured Runner Result contract (§7 of the DC-003-I029.2 brief) —
 * called by automated-delivery-office-service.mjs immediately after every
 * adapter invocation, real or mock, before any of it is trusted.
 * `expectedWorkOrderId` guards against an adapter silently returning
 * evidence for the wrong Work Order.
 */
export function assertValidRunnerResult(result, expectedWorkOrderId) {
  if (!result || typeof result !== "object") fail(expectedWorkOrderId, "result is not an object");
  if (!RUNNER_RESULT_STATUSES.includes(result.status)) fail(expectedWorkOrderId, `status must be one of ${RUNNER_RESULT_STATUSES.join(", ")}`);
  if (result.workOrderId !== expectedWorkOrderId) fail(expectedWorkOrderId, "workOrderId does not match the Work Order that was executed");
  if (!isNonEmptyString(result.startedAt)) fail(expectedWorkOrderId, "startedAt is required");
  if (!isNonEmptyString(result.completedAt)) fail(expectedWorkOrderId, "completedAt is required");
  if (result.exitCode !== null && !Number.isInteger(result.exitCode)) fail(expectedWorkOrderId, "exitCode must be an integer or null");
  if (result.sessionReference !== null && !isNonEmptyString(result.sessionReference)) fail(expectedWorkOrderId, "sessionReference must be a non-empty string or null");

  const repo = result.repository;
  if (!repo || typeof repo !== "object") fail(expectedWorkOrderId, "repository is required");
  if (repo.startingCommit !== null && !isNonEmptyString(repo.startingCommit)) fail(expectedWorkOrderId, "repository.startingCommit must be a non-empty string or null");
  if (repo.endingCommit !== null && !isNonEmptyString(repo.endingCommit)) fail(expectedWorkOrderId, "repository.endingCommit must be a non-empty string or null");
  if (!isNonEmptyString(repo.branch)) fail(expectedWorkOrderId, "repository.branch is required");
  if (!WORKING_TREE_STATES.includes(repo.workingTree)) fail(expectedWorkOrderId, `repository.workingTree must be one of ${WORKING_TREE_STATES.join(", ")}`);

  const verification = result.verification;
  if (!verification || typeof verification !== "object") fail(expectedWorkOrderId, "verification is required");
  if (typeof verification.testsPassed !== "boolean") fail(expectedWorkOrderId, "verification.testsPassed must be a boolean");
  if (typeof verification.fixturesPassed !== "boolean") fail(expectedWorkOrderId, "verification.fixturesPassed must be a boolean");
  assertValidCountSummary(verification.testsSummary, expectedWorkOrderId, "verification.testsSummary");
  assertValidCountSummary(verification.fixturesSummary, expectedWorkOrderId, "verification.fixturesSummary");
  if (verification.testsPassed !== (verification.testsSummary.failed === 0 && verification.testsSummary.total > 0)) {
    fail(expectedWorkOrderId, "verification.testsPassed is inconsistent with verification.testsSummary");
  }
  if (verification.fixturesPassed !== (verification.fixturesSummary.failed === 0 && verification.fixturesSummary.total > 0)) {
    fail(expectedWorkOrderId, "verification.fixturesPassed is inconsistent with verification.fixturesSummary");
  }

  const evidence = result.deliveryEvidence;
  if (!evidence || typeof evidence !== "object") fail(expectedWorkOrderId, "deliveryEvidence is required");
  if (evidence.commit !== null && !isNonEmptyString(evidence.commit)) fail(expectedWorkOrderId, "deliveryEvidence.commit must be a non-empty string or null");
  if (!PUSH_STATUSES.includes(evidence.pushStatus)) fail(expectedWorkOrderId, `deliveryEvidence.pushStatus must be one of ${PUSH_STATUSES.join(", ")}`);
  if (!isNonEmptyString(evidence.summary)) fail(expectedWorkOrderId, "deliveryEvidence.summary is required");

  return result;
}

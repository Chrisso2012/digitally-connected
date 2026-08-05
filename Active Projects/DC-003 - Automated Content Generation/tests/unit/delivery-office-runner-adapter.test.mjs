import test from "node:test";
import assert from "node:assert/strict";
import { assertValidDeliveryOfficeRunnerAdapter, assertValidRunnerResult } from "../../src/delivery-office-runner-adapter.mjs";
import { InvalidDeliveryOfficeRunnerAdapterError, MalformedRunnerResultError } from "../../src/delivery-office-errors.mjs";

function validResult(overrides = {}) {
  return {
    status: "completed",
    workOrderId: "wo_adaptertest000001",
    startedAt: "2026-08-05T00:00:00.000Z",
    completedAt: "2026-08-05T00:05:00.000Z",
    exitCode: 0,
    sessionReference: "session-1",
    repository: { startingCommit: "aaa1111", endingCommit: "bbb2222", branch: "main", workingTree: "clean" },
    verification: {
      testsPassed: true,
      fixturesPassed: true,
      testsSummary: { passed: 10, failed: 0, total: 10 },
      fixturesSummary: { passed: 5, failed: 0, total: 5 },
    },
    deliveryEvidence: { commit: "bbb2222", pushStatus: "not_applicable", summary: "did the thing" },
    ...overrides,
  };
}

// --- assertValidDeliveryOfficeRunnerAdapter --------------------------------

test("assertValidDeliveryOfficeRunnerAdapter(): accepts a correctly-shaped adapter", () => {
  assert.doesNotThrow(() => assertValidDeliveryOfficeRunnerAdapter({ name: "x", executeWorkOrder: async () => {} }));
});

test("assertValidDeliveryOfficeRunnerAdapter(): rejects missing name/executeWorkOrder", () => {
  assert.throws(() => assertValidDeliveryOfficeRunnerAdapter({}), InvalidDeliveryOfficeRunnerAdapterError);
  assert.throws(() => assertValidDeliveryOfficeRunnerAdapter({ name: "x" }), InvalidDeliveryOfficeRunnerAdapterError);
  assert.throws(() => assertValidDeliveryOfficeRunnerAdapter(null), InvalidDeliveryOfficeRunnerAdapterError);
});

// --- assertValidRunnerResult ------------------------------------------------

test("assertValidRunnerResult(): accepts a fully-shaped result", () => {
  const result = validResult();
  assert.equal(assertValidRunnerResult(result, result.workOrderId), result);
});

test("assertValidRunnerResult(): rejects an unknown status", () => {
  assert.throws(() => assertValidRunnerResult(validResult({ status: "bogus" }), "wo_adaptertest000001"), MalformedRunnerResultError);
});

test("assertValidRunnerResult(): rejects a mismatched workOrderId", () => {
  assert.throws(() => assertValidRunnerResult(validResult(), "wo_someoneelse00001"), MalformedRunnerResultError);
});

test("assertValidRunnerResult(): rejects missing repository/verification/deliveryEvidence blocks", () => {
  assert.throws(() => assertValidRunnerResult({ status: "completed", workOrderId: "wo_adaptertest000001" }, "wo_adaptertest000001"), MalformedRunnerResultError);
  const missingRepo = validResult();
  delete missingRepo.repository;
  assert.throws(() => assertValidRunnerResult(missingRepo, "wo_adaptertest000001"), MalformedRunnerResultError);
});

test("assertValidRunnerResult(): rejects an invalid working tree / push status enum value", () => {
  assert.throws(
    () => assertValidRunnerResult(validResult({ repository: { ...validResult().repository, workingTree: "muddy" } }), "wo_adaptertest000001"),
    MalformedRunnerResultError
  );
  assert.throws(
    () => assertValidRunnerResult(validResult({ deliveryEvidence: { ...validResult().deliveryEvidence, pushStatus: "maybe" } }), "wo_adaptertest000001"),
    MalformedRunnerResultError
  );
});

test("assertValidRunnerResult(): rejects a testsSummary/testsPassed inconsistency", () => {
  const inconsistent = validResult();
  inconsistent.verification.testsPassed = true;
  inconsistent.verification.testsSummary = { passed: 1, failed: 1, total: 2 };
  assert.throws(() => assertValidRunnerResult(inconsistent, "wo_adaptertest000001"), MalformedRunnerResultError);
});

test("assertValidRunnerResult(): rejects a non-object countSummary", () => {
  const bad = validResult();
  bad.verification.fixturesSummary = null;
  assert.throws(() => assertValidRunnerResult(bad, "wo_adaptertest000001"), MalformedRunnerResultError);
});

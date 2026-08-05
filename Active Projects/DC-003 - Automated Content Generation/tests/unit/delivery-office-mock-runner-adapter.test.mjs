import test from "node:test";
import assert from "node:assert/strict";
import { createMockDeliveryOfficeRunnerAdapter } from "../../src/delivery-office-mock-runner-adapter.mjs";
import { assertValidRunnerResult } from "../../src/delivery-office-runner-adapter.mjs";
import { RunnerExecutionFailedError } from "../../src/delivery-office-errors.mjs";

const WORK_ORDER = {
  work_order_id: "wo_mocktest000000001",
  milestone: "DC-003-I029.2",
  status: "ready",
};
const REPOSITORY = { startingCommit: "aaa1111" };
const CONSERVATIVE_POLICY = { permittedBranch: "main", allowPush: false };
const PUSH_ALLOWED_POLICY = { permittedBranch: "main", allowPush: true };

async function run(mode, policy = CONSERVATIVE_POLICY) {
  const adapter = createMockDeliveryOfficeRunnerAdapter({ mode });
  const result = await adapter.executeWorkOrder({ workOrder: WORK_ORDER, repository: REPOSITORY, executionPolicy: policy });
  return assertValidRunnerResult(result, WORK_ORDER.work_order_id);
}

test("mock runner: name is stable and never changes across modes", () => {
  assert.equal(createMockDeliveryOfficeRunnerAdapter().name, "mock-delivery-office-runner");
});

test("mock runner: default mode ('success') reports completed, a real-shaped commit, and clean working tree", async () => {
  const result = await run(undefined);
  assert.equal(result.status, "completed");
  assert.equal(result.repository.workingTree, "clean");
  assert.ok(result.deliveryEvidence.commit);
  assert.equal(result.verification.testsPassed, true);
  assert.equal(result.verification.fixturesPassed, true);
});

test("mock runner: success mode reports pushStatus 'pushed' only when the policy allows push", async () => {
  const withoutPush = await run("success", CONSERVATIVE_POLICY);
  assert.equal(withoutPush.deliveryEvidence.pushStatus, "not_applicable");
  const withPush = await run("success", PUSH_ALLOWED_POLICY);
  assert.equal(withPush.deliveryEvidence.pushStatus, "pushed");
});

test("mock runner: 'failed' mode reports status failed with both verification flags false", async () => {
  const result = await run("failed");
  assert.equal(result.status, "failed");
  assert.equal(result.verification.testsPassed, false);
  assert.equal(result.verification.fixturesPassed, false);
  assert.equal(result.deliveryEvidence.commit, null);
});

test("mock runner: 'timeout' mode reports status timeout with a null exitCode and null commit", async () => {
  const result = await run("timeout");
  assert.equal(result.status, "timeout");
  assert.equal(result.exitCode, null);
  assert.equal(result.deliveryEvidence.commit, null);
});

test("mock runner: 'interrupted' mode reports status interrupted", async () => {
  const result = await run("interrupted");
  assert.equal(result.status, "interrupted");
});

test("mock runner: 'dirty-repository' mode reports a dirty working tree and no commit", async () => {
  const result = await run("dirty-repository");
  assert.equal(result.repository.workingTree, "dirty");
  assert.equal(result.deliveryEvidence.commit, null);
});

test("mock runner: 'tests-failed' mode reports testsPassed false but fixturesPassed true, with a real commit", async () => {
  const result = await run("tests-failed");
  assert.equal(result.verification.testsPassed, false);
  assert.equal(result.verification.fixturesPassed, true);
  assert.ok(result.deliveryEvidence.commit);
});

test("mock runner: 'fixtures-failed' mode reports fixturesPassed false but testsPassed true", async () => {
  const result = await run("fixtures-failed");
  assert.equal(result.verification.testsPassed, true);
  assert.equal(result.verification.fixturesPassed, false);
});

test("mock runner: 'adapter-error' mode throws RunnerExecutionFailedError, never returns", async () => {
  const adapter = createMockDeliveryOfficeRunnerAdapter({ mode: "adapter-error" });
  await assert.rejects(() => adapter.executeWorkOrder({ workOrder: WORK_ORDER, repository: REPOSITORY, executionPolicy: CONSERVATIVE_POLICY }), RunnerExecutionFailedError);
});

test("mock runner: 'malformed' mode returns a shape assertValidRunnerResult() rejects — proves the service, not the adapter, must catch it", async () => {
  const adapter = createMockDeliveryOfficeRunnerAdapter({ mode: "malformed" });
  const raw = await adapter.executeWorkOrder({ workOrder: WORK_ORDER, repository: REPOSITORY, executionPolicy: CONSERVATIVE_POLICY });
  assert.throws(() => assertValidRunnerResult(raw, WORK_ORDER.work_order_id));
});

test("mock runner: is deterministic — two invocations of the same mode produce a structurally identical outcome shape", async () => {
  const first = await run("success");
  const second = await run("success");
  assert.equal(first.status, second.status);
  assert.deepEqual(first.verification, second.verification);
});

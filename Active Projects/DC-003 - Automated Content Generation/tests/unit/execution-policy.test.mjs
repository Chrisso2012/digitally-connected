import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionPolicy, resolveEffectivePolicy } from "../../src/execution-policy.mjs";
import { InvalidExecutionPolicyError } from "../../src/delivery-office-errors.mjs";

test("createExecutionPolicy(): conservative defaults — no commits, no push, no docker, live calls and infra changes prohibited", () => {
  const policy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main" });
  assert.equal(policy.allowCommits, false);
  assert.equal(policy.allowPush, false);
  assert.equal(policy.allowDocker, false);
  assert.equal(policy.prohibitLiveExternalCalls, true);
  assert.equal(policy.prohibitInfrastructureChanges, true);
  assert.equal(policy.maxCostUsd, 2);
  assert.ok(policy.disallowedTools.includes("WebFetch"));
  assert.ok(policy.disallowedTools.includes("Bash(docker*)"));
  assert.ok(policy.disallowedTools.includes("Bash(git push*)"));
  assert.ok(policy.disallowedTools.includes("Bash(git commit*)"));
});

test("createExecutionPolicy(): requires repositoryPath and permittedBranch", () => {
  assert.throws(() => createExecutionPolicy({ permittedBranch: "main" }), InvalidExecutionPolicyError);
  assert.throws(() => createExecutionPolicy({ repositoryPath: "/repo" }), InvalidExecutionPolicyError);
});

test("createExecutionPolicy(): allowPush cannot be true while allowCommits is false", () => {
  assert.throws(
    () => createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", allowPush: true, allowCommits: false }),
    InvalidExecutionPolicyError
  );
});

test("createExecutionPolicy(): allowing commits/push/docker removes the corresponding computed denial", () => {
  const policy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", allowCommits: true, allowPush: true, allowDocker: true });
  assert.ok(!policy.disallowedTools.includes("Bash(docker*)"));
  assert.ok(!policy.disallowedTools.includes("Bash(git push*)"));
  assert.ok(!policy.disallowedTools.includes("Bash(git commit*)"));
});

test("createExecutionPolicy(): prohibitLiveExternalCalls=false removes the computed WebFetch/WebSearch denial", () => {
  const policy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", prohibitLiveExternalCalls: false });
  assert.ok(!policy.disallowedTools.includes("WebFetch"));
});

test("createExecutionPolicy(): caller-supplied disallowedTools are preserved alongside computed denials", () => {
  const policy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", disallowedTools: ["Bash(rm*)"] });
  assert.ok(policy.disallowedTools.includes("Bash(rm*)"));
  assert.ok(policy.disallowedTools.includes("Bash(docker*)"));
});

test("createExecutionPolicy(): rejects invalid field types", () => {
  assert.throws(() => createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", allowedTools: "not-an-array" }), InvalidExecutionPolicyError);
  assert.throws(() => createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", commandTimeoutMs: -1 }), InvalidExecutionPolicyError);
  assert.throws(
    () => createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", commandTimeoutMs: 100, maxRunDurationMs: 10 }),
    InvalidExecutionPolicyError
  );
  assert.throws(() => createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxCostUsd: -5 }), InvalidExecutionPolicyError);
  assert.throws(() => createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxTokens: 0 }), InvalidExecutionPolicyError);
});

test("createExecutionPolicy(): maxCostUsd/maxTokens may be explicitly null", () => {
  const policy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxCostUsd: null });
  assert.equal(policy.maxCostUsd, null);
});

test("createExecutionPolicy(): the returned policy is deep-frozen", () => {
  const policy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main" });
  assert.throws(() => {
    "use strict";
    policy.allowPush = true;
  });
});

test("resolveEffectivePolicy(): is currently an honest no-op — no structured Work Order narrowing field exists yet", () => {
  const policy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main" });
  const workOrder = { constraints: ["do not touch schema files"] };
  assert.equal(resolveEffectivePolicy(policy, workOrder), policy);
});

// Unit tests for the real Claude Code Delivery Runner Adapter
// (DC-003-I029.2). NEVER spawns a real subprocess and NEVER invokes real
// Claude Code — every executeWorkOrder() test injects a fake `spawnFn`
// (a plain EventEmitter standing in for a Node ChildProcess) and a fake
// `runGit`, exactly the injection points this file's own header comment
// describes as the intended test seam. The pure functions
// (buildDeliveryInstruction/buildClaudeArgs/parseClaudeSelfReport) are
// tested directly with hand-built fixture strings.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  buildDeliveryInstruction,
  buildClaudeArgs,
  parseClaudeSelfReport,
  createClaudeCodeDeliveryRunnerAdapter,
  CLAUDE_SELF_REPORT_JSON_SCHEMA,
} from "../../src/claude-code-delivery-runner-adapter.mjs";
import { assertValidRunnerResult } from "../../src/delivery-office-runner-adapter.mjs";
import { RunnerExecutionFailedError, MalformedRunnerResultError } from "../../src/delivery-office-errors.mjs";
import { createExecutionPolicy } from "../../src/execution-policy.mjs";

const WORK_ORDER = {
  work_order_id: "wo_claudetest0000001",
  milestone: "DC-003-I029.2",
  title: "Ship the thing",
  objective: "Do the thing safely.",
  repository_commit: "aaa1111",
  constraints: ["only touch src/foo.mjs"],
  dependencies: ["wo_dep000000000001"],
  review_criteria: ["tests pass", "no scope creep"],
};

function selfReport(overrides = {}) {
  return {
    completed: true,
    testsSummary: { passed: 10, failed: 0, total: 10 },
    fixturesSummary: { passed: 5, failed: 0, total: 5 },
    committed: true,
    commit: "bbb2222",
    pushed: false,
    summary: "implemented the thing",
    ...overrides,
  };
}

// --- buildDeliveryInstruction ----------------------------------------------

test("buildDeliveryInstruction(): includes every required Work Order field, nothing invented", () => {
  const instruction = buildDeliveryInstruction(WORK_ORDER);
  assert.match(instruction, /DC-003-I029\.2/);
  assert.match(instruction, /Ship the thing/);
  assert.match(instruction, /Do the thing safely\./);
  assert.match(instruction, /aaa1111/);
  assert.match(instruction, /only touch src\/foo\.mjs/);
  assert.match(instruction, /wo_dep000000000001/);
  assert.match(instruction, /tests pass/);
  assert.match(instruction, /no scope creep/);
  assert.match(instruction, /cannot approve its own work/);
  assert.match(instruction, /Do not make any live external API call/);
});

test("buildDeliveryInstruction(): handles empty constraints/dependencies gracefully", () => {
  const instruction = buildDeliveryInstruction({ ...WORK_ORDER, constraints: [], dependencies: [] });
  assert.match(instruction, /\(none recorded\)/);
  assert.match(instruction, /\(none\)/);
});

// --- buildClaudeArgs ---------------------------------------------------

test("buildClaudeArgs(): includes isolation and structured-output flags", () => {
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main" });
  const args = buildClaudeArgs({ instruction: "do it", executionPolicy });
  assert.ok(args.includes("--bare"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--setting-sources"));
  assert.ok(args.includes("project"));
  assert.ok(args.includes("--output-format"));
  assert.ok(args.includes("json"));
  assert.ok(args.includes("--json-schema"));
  assert.ok(args.includes("--permission-mode"));
  assert.ok(args.includes("acceptEdits"));
  assert.equal(args[args.length - 1], "do it", "the instruction is the final positional argument");
});

test("buildClaudeArgs(): omits --max-budget-usd when the policy sets maxCostUsd to null", () => {
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxCostUsd: null });
  const args = buildClaudeArgs({ instruction: "do it", executionPolicy });
  assert.ok(!args.includes("--max-budget-usd"));
});

test("buildClaudeArgs(): includes --max-budget-usd with the policy's own value", () => {
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxCostUsd: 3.5 });
  const args = buildClaudeArgs({ instruction: "do it", executionPolicy });
  const index = args.indexOf("--max-budget-usd");
  assert.ok(index !== -1);
  assert.equal(args[index + 1], "3.5");
});

// --- parseClaudeSelfReport ---------------------------------------------

test("parseClaudeSelfReport(): parses a top-level self-report-shaped object directly", () => {
  const parsed = parseClaudeSelfReport(JSON.stringify(selfReport()), WORK_ORDER.work_order_id);
  assert.equal(parsed.completed, true);
});

test("parseClaudeSelfReport(): parses a self-report nested under a `result` object field", () => {
  const parsed = parseClaudeSelfReport(JSON.stringify({ type: "result", result: selfReport() }), WORK_ORDER.work_order_id);
  assert.equal(parsed.completed, true);
});

test("parseClaudeSelfReport(): parses a self-report nested under a JSON-encoded-string `result` field", () => {
  const parsed = parseClaudeSelfReport(JSON.stringify({ type: "result", result: JSON.stringify(selfReport()) }), WORK_ORDER.work_order_id);
  assert.equal(parsed.completed, true);
});

test("parseClaudeSelfReport(): throws MalformedRunnerResultError for non-JSON stdout", () => {
  assert.throws(() => parseClaudeSelfReport("not json at all", WORK_ORDER.work_order_id), MalformedRunnerResultError);
});

test("parseClaudeSelfReport(): throws MalformedRunnerResultError when no candidate matches the self-report shape", () => {
  assert.throws(() => parseClaudeSelfReport(JSON.stringify({ hello: "world" }), WORK_ORDER.work_order_id), MalformedRunnerResultError);
});

// --- CLAUDE_SELF_REPORT_JSON_SCHEMA ----------------------------------------

test("CLAUDE_SELF_REPORT_JSON_SCHEMA: is a well-formed object schema with the exact required fields", () => {
  assert.equal(CLAUDE_SELF_REPORT_JSON_SCHEMA.type, "object");
  assert.deepEqual(
    [...CLAUDE_SELF_REPORT_JSON_SCHEMA.required].sort(),
    ["commit", "committed", "completed", "fixturesSummary", "pushed", "summary", "testsSummary"].sort()
  );
});

// --- createClaudeCodeDeliveryRunnerAdapter() — fake spawn, fake git -------

function fakeChild() {
  const emitter = new EventEmitter();
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.kill = (signal) => {
    setImmediate(() => emitter.emit("close", null, signal));
  };
  return emitter;
}

function buildAdapter({ spawnFn, runGit, env = {} } = {}) {
  return createClaudeCodeDeliveryRunnerAdapter({ spawnFn, runGit, env, now: () => "2026-08-05T00:00:00.000Z" });
}

function defaultFakeRunGit(commitByArgs) {
  return (args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") return commitByArgs.commit ?? "bbb2222";
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return commitByArgs.branch ?? "main";
    if (args[0] === "status") return "";
    if (args[0] === "rev-parse" && args[1] === "@{u}") throw new Error("no upstream");
    if (args[0] === "diff") return "";
    return "";
  };
}

test("createClaudeCodeDeliveryRunnerAdapter(): a successful subprocess with a valid self-report normalises to status 'completed'", async () => {
  const spawnFn = (command, args) => {
    const child = fakeChild();
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from(JSON.stringify(selfReport())));
      child.emit("close", 0, null);
    });
    return child;
  };
  const adapter = buildAdapter({ spawnFn, runGit: defaultFakeRunGit({}) });
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxRunDurationMs: 60000, commandTimeoutMs: 1000 });

  const result = await adapter.executeWorkOrder({ workOrder: WORK_ORDER, repository: { startingCommit: "aaa1111" }, executionPolicy });
  assertValidRunnerResult(result, WORK_ORDER.work_order_id);
  assert.equal(result.status, "completed");
  assert.equal(result.repository.endingCommit, "bbb2222");
  assert.equal(result.deliveryEvidence.commit, "bbb2222");
});

test("createClaudeCodeDeliveryRunnerAdapter(): completed:false in the self-report normalises to status 'failed' even with exitCode 0", async () => {
  const spawnFn = () => {
    const child = fakeChild();
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from(JSON.stringify(selfReport({ completed: false }))));
      child.emit("close", 0, null);
    });
    return child;
  };
  const adapter = buildAdapter({ spawnFn, runGit: defaultFakeRunGit({}) });
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main" });
  const result = await adapter.executeWorkOrder({ workOrder: WORK_ORDER, repository: { startingCommit: "aaa1111" }, executionPolicy });
  assert.equal(result.status, "failed");
});

test("createClaudeCodeDeliveryRunnerAdapter(): malformed stdout throws MalformedRunnerResultError, not a silent completed result", async () => {
  const spawnFn = () => {
    const child = fakeChild();
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from("not json"));
      child.emit("close", 0, null);
    });
    return child;
  };
  const adapter = buildAdapter({ spawnFn, runGit: defaultFakeRunGit({}) });
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main" });
  await assert.rejects(
    () => adapter.executeWorkOrder({ workOrder: WORK_ORDER, repository: { startingCommit: "aaa1111" }, executionPolicy }),
    MalformedRunnerResultError
  );
});

test("createClaudeCodeDeliveryRunnerAdapter(): a spawn error throws RunnerExecutionFailedError", async () => {
  const spawnFn = () => {
    const child = fakeChild();
    setImmediate(() => child.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" })));
    return child;
  };
  const adapter = buildAdapter({ spawnFn, runGit: defaultFakeRunGit({}) });
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main" });
  await assert.rejects(
    () => adapter.executeWorkOrder({ workOrder: WORK_ORDER, repository: { startingCommit: "aaa1111" }, executionPolicy }),
    RunnerExecutionFailedError
  );
});

test("createClaudeCodeDeliveryRunnerAdapter(): exceeding maxRunDurationMs kills the process and normalises to status 'timeout'", async () => {
  const spawnFn = () => fakeChild(); // never emits close/data on its own — only kill() unblocks it
  const adapter = buildAdapter({ spawnFn, runGit: defaultFakeRunGit({}) });
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxRunDurationMs: 20, commandTimeoutMs: 20 });

  const result = await adapter.executeWorkOrder({ workOrder: WORK_ORDER, repository: { startingCommit: "aaa1111" }, executionPolicy });
  assert.equal(result.status, "timeout");
  assert.equal(result.exitCode, null);
  assert.equal(result.verification.testsPassed, false);
});

test("createClaudeCodeDeliveryRunnerAdapter(): a signal-terminated process (not caused by our own timeout) normalises to status 'interrupted'", async () => {
  const spawnFn = () => {
    const child = fakeChild();
    setImmediate(() => child.emit("close", null, "SIGINT"));
    return child;
  };
  const adapter = buildAdapter({ spawnFn, runGit: defaultFakeRunGit({}) });
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main", maxRunDurationMs: 60000, commandTimeoutMs: 1000 });
  const result = await adapter.executeWorkOrder({ workOrder: WORK_ORDER, repository: { startingCommit: "aaa1111" }, executionPolicy });
  assert.equal(result.status, "interrupted");
});

test("createClaudeCodeDeliveryRunnerAdapter(): repository.endingCommit/branch/workingTree come from the injected runGit, never from the self-report", async () => {
  const spawnFn = () => {
    const child = fakeChild();
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from(JSON.stringify(selfReport())));
      child.emit("close", 0, null);
    });
    return child;
  };
  const runGit = defaultFakeRunGit({ commit: "realcommit1", branch: "feature-x" });
  const adapter = buildAdapter({ spawnFn, runGit });
  const executionPolicy = createExecutionPolicy({ repositoryPath: "/repo", permittedBranch: "main" });
  const result = await adapter.executeWorkOrder({ workOrder: WORK_ORDER, repository: { startingCommit: "aaa1111" }, executionPolicy });
  assert.equal(result.repository.endingCommit, "realcommit1");
  assert.equal(result.repository.branch, "feature-x");
});

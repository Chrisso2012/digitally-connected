// DC-003-I029.2 — Claude Code Delivery Runner Adapter: the real (never
// used by an automated test) implementation of the Delivery Office Runner
// Adapter contract, invoking Claude Code headless (`claude -p`) as a
// subprocess against exactly one approved Engineering Work Order.
//
// Mechanism decision (see the DC-003-I029.2 feasibility investigation
// report): Claude Code CLI subprocess, not the Agent SDK — the CLI's own
// `-p`/`--output-format json`/`--json-schema`/`--allowedTools`/
// `--disallowedTools`/`--permission-mode`/`--max-budget-usd`/`--bare`/
// `--strict-mcp-config`/`--setting-sources` flags already cover every
// control point this milestone needs, officially documented, no guessing.
//
// Isolation: every invocation passes `--bare --strict-mcp-config
// --setting-sources project` — headless mode loads this user's personal
// CLAUDE.md/settings/MCP servers/skills BY DEFAULT (a real feasibility
// finding, not assumed), which is far broader authority than an unattended
// automated runner should ever carry. This adapter deliberately opts OUT
// of that default rather than trusting it.
//
// The CLI exposes no `--timeout` flag (confirmed via `claude --help`) —
// timeout/interruption is this adapter's own responsibility, enforced with
// a manual setTimeout + SIGTERM-then-SIGKILL kill sequence against
// executionPolicy.maxRunDurationMs, mirroring this project's own
// established one-shot-safety-cap discipline (resolveLiveMaxAttempts() in
// renderer-config.mjs/llm-provider-config.mjs).
//
// The exact JSON envelope `--output-format json` wraps a `--json-schema`
// self-report in has not been observed against a real invocation — no
// real Claude Code execution is authorised during DC-003-I029.2's own
// implementation (see the brief's own "Initial Real-Runner Verification
// Gate"). parseClaudeSelfReport() below is therefore deliberately
// defensive (tries the documented/most-likely envelope shapes, never
// silently accepts a shape it cannot verify) and is exactly what that
// verification gate must confirm for real before any live Work Order is
// executed. No automated test invokes real Claude Code; the pure
// functions in this file (buildDeliveryInstruction/buildClaudeArgs/
// parseClaudeSelfReport) are unit-tested directly with hand-built fixture
// strings and an injected fake spawnFn, never a real subprocess.
//
// Never logged, stored, or returned: API keys, full stdout/stderr,
// hidden reasoning, environment dumps, stack traces. Only a
// caller-bounded self-report summary and independently-collected git
// evidence cross this adapter's own return boundary.

import { spawn } from "node:child_process";
import { RunnerExecutionFailedError, MalformedRunnerResultError } from "./delivery-office-errors.mjs";
import { assertValidRunnerResult } from "./delivery-office-runner-adapter.mjs";
import { loadDeliveryOfficeRunnerConfig } from "./delivery-office-runner-config.mjs";
import { readGitState, defaultRunGit } from "./repository-git-evidence.mjs";

const MAX_SUMMARY_LENGTH = 500;
const KILL_GRACE_MS = 5000;

const COUNT_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "failed", "total"],
  properties: {
    passed: { type: "integer", minimum: 0 },
    failed: { type: "integer", minimum: 0 },
    total: { type: "integer", minimum: 0 },
  },
};

export const CLAUDE_SELF_REPORT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["completed", "testsSummary", "fixturesSummary", "committed", "commit", "pushed", "summary"],
  properties: {
    completed: { type: "boolean", description: "true only if every review criterion in the Work Order was met" },
    testsSummary: { ...COUNT_SUMMARY_SCHEMA, description: "the real npm test result you observed via your own tool calls" },
    fixturesSummary: { ...COUNT_SUMMARY_SCHEMA, description: "the real npm run validate result you observed via your own tool calls" },
    committed: { type: "boolean" },
    commit: { type: ["string", "null"], description: "the commit hash produced, or null if none was created" },
    pushed: { type: "boolean" },
    summary: { type: "string", maxLength: MAX_SUMMARY_LENGTH, description: "a short, bounded engineering evidence summary — never a transcript" },
  },
};

/**
 * Translates one Work Order's structured fields into a deterministic
 * Claude execution instruction — §6 of the brief: only milestone, title,
 * objective, constraints, dependencies, review criteria, expected starting
 * commit, authority/safety rules, and the required self-report format.
 * Never embeds conversation history; never invents scope beyond these
 * fields.
 */
export function buildDeliveryInstruction(workOrder) {
  const lines = [
    `You are the Automated Delivery Office Runner executing one approved Engineering Work Order in the DC-003 repository.`,
    ``,
    `Milestone: ${workOrder.milestone}`,
    `Title: ${workOrder.title}`,
    `Objective: ${workOrder.objective}`,
    `Expected starting repository commit: ${workOrder.repository_commit ?? "(not recorded on the Work Order)"}`,
    ``,
    `Constraints:`,
    ...(workOrder.constraints.length > 0 ? workOrder.constraints.map((c) => `  - ${c}`) : ["  (none recorded)"]),
    ``,
    `Dependencies (other Work Order IDs this task depends on):`,
    ...(workOrder.dependencies.length > 0 ? workOrder.dependencies.map((d) => `  - ${d}`) : ["  (none)"]),
    ``,
    `Review criteria (the Strategy Office will judge the result against these):`,
    ...workOrder.review_criteria.map((c) => `  - ${c}`),
    ``,
    `Authority and safety rules — these are hard limits, not suggestions:`,
    `  - Stay strictly within the objective and constraints above. Do not invent additional scope.`,
    `  - Only the tools and repository paths you have been explicitly granted are available to you.`,
    `  - This execution cannot approve its own work. You are the Delivery Office, not the Strategy Office.`,
    `  - Do not make any live external API call (Anthropic application calls unrelated to this session, Templated, Google Drive, Instagram, LinkedIn, or any other production provider).`,
    `  - Do not recreate, reconfigure, or otherwise change any container, service, or credential.`,
    `  - Follow this repository's own existing conventions exactly as documented in its README before writing any code.`,
    ``,
    `When your work is finished (whether you succeeded, partially succeeded, or could not complete it), end your final turn by reporting the required structured result exactly matching the JSON Schema you have been given — completed/testsPassed/fixturesPassed/committed/commit/pushed/summary. The summary must be a short, factual account of what you did, bounded to ${MAX_SUMMARY_LENGTH} characters — never a transcript of your reasoning.`,
  ];
  return lines.join("\n");
}

/**
 * Builds the full `claude` argv (excluding the command itself — see
 * loadDeliveryOfficeRunnerConfig()) for one Work Order execution. Returned
 * as an array, never a shell string — spawn() below never uses
 * `shell: true`, so no argument (including the instruction's own free
 * text) is ever shell-interpreted, regardless of content.
 */
export function buildClaudeArgs({ instruction, executionPolicy }) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(CLAUDE_SELF_REPORT_JSON_SCHEMA),
    "--bare",
    "--strict-mcp-config",
    "--setting-sources",
    "project",
    "--permission-mode",
    "acceptEdits",
    "--no-session-persistence",
    "--allowedTools",
    executionPolicy.allowedTools.join(" "),
    "--disallowedTools",
    executionPolicy.disallowedTools.join(" "),
  ];
  if (executionPolicy.maxCostUsd !== null) {
    args.push("--max-budget-usd", String(executionPolicy.maxCostUsd));
  }
  args.push(instruction);
  return args;
}

/**
 * Extracts Claude's own structured self-report from raw stdout. Tries, in
 * order: (1) the whole stdout parses as JSON and already matches the
 * self-report shape directly; (2) it parses as JSON with a `result` field
 * that is itself the self-report object; (3) `result` is a JSON-encoded
 * string containing the self-report. Throws MalformedRunnerResultError if
 * none succeed — never silently invents a "completed" result.
 */
export function parseClaudeSelfReport(stdout, workOrderId) {
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (cause) {
    throw new MalformedRunnerResultError(workOrderId, "stdout was not valid JSON");
  }

  const candidates = [parsed, parsed?.result, typeof parsed?.result === "string" ? tryParse(parsed.result) : null].filter(Boolean);

  for (const candidate of candidates) {
    if (isSelfReportShaped(candidate)) return candidate;
  }
  throw new MalformedRunnerResultError(workOrderId, "no candidate in the CLI output matched the required self-report shape");
}

function tryParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isCountSummaryShaped(value) {
  return value && typeof value === "object" && Number.isInteger(value.passed) && Number.isInteger(value.failed) && Number.isInteger(value.total);
}

function isSelfReportShaped(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.completed === "boolean" &&
    isCountSummaryShaped(value.testsSummary) &&
    isCountSummaryShaped(value.fixturesSummary) &&
    typeof value.committed === "boolean" &&
    (value.commit === null || typeof value.commit === "string") &&
    typeof value.pushed === "boolean" &&
    typeof value.summary === "string"
  );
}

/**
 * Builds the real Claude Code Delivery Runner Adapter.
 *
 * options.env — override process.env (tests).
 * options.spawnFn — override node:child_process.spawn (tests only —
 *   automated tests never let this reach a real subprocess).
 * options.runGit — override the git evidence collector (tests).
 * options.now — override the clock (tests).
 */
export function createClaudeCodeDeliveryRunnerAdapter(options = {}) {
  const env = options.env ?? process.env;
  const spawnFn = options.spawnFn ?? spawn;
  const runGit = options.runGit ?? defaultRunGit;
  const now = options.now ?? (() => new Date().toISOString());
  const config = loadDeliveryOfficeRunnerConfig(env);

  return {
    name: "claude-code-cli-delivery-runner",

    async executeWorkOrder({ workOrder, repository, executionPolicy }) {
      const startedAt = now();
      const instruction = buildDeliveryInstruction(workOrder);
      const args = [...config.prefixArgs, ...buildClaudeArgs({ instruction, executionPolicy })];

      const outcome = await new Promise((resolve) => {
        const child = spawnFn(config.command, args, { cwd: executionPolicy.repositoryPath, env });
        let stdout = "";
        let timedOut = false;
        let killedForTimeout = null;

        const timer = setTimeout(() => {
          timedOut = true;
          killedForTimeout = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
          child.kill("SIGTERM");
        }, executionPolicy.maxRunDurationMs);

        child.stdout?.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        // stderr is drained (never accumulated/returned) — this adapter
        // never surfaces raw process output beyond the parsed structured
        // self-report, per this file's own header comment.
        child.stderr?.on("data", () => {});

        child.on("error", (error) => {
          clearTimeout(timer);
          if (killedForTimeout) clearTimeout(killedForTimeout);
          resolve({ kind: "spawn-error", error });
        });

        child.on("close", (exitCode, signal) => {
          clearTimeout(timer);
          if (killedForTimeout) clearTimeout(killedForTimeout);
          if (timedOut) {
            resolve({ kind: "timeout" });
          } else if (signal) {
            resolve({ kind: "interrupted", signal });
          } else {
            resolve({ kind: "exited", exitCode, stdout });
          }
        });
      });

      const completedAt = now();
      const gitState = readGitState(executionPolicy.repositoryPath, runGit);
      const repositoryResult = {
        startingCommit: repository.startingCommit,
        endingCommit: gitState.commit,
        branch: gitState.branch,
        workingTree: gitState.workingTreeClean ? "clean" : "dirty",
      };

      const zeroVerification = {
        testsPassed: false,
        fixturesPassed: false,
        testsSummary: { passed: 0, failed: 0, total: 0 },
        fixturesSummary: { passed: 0, failed: 0, total: 0 },
      };

      let result;
      if (outcome.kind === "spawn-error") {
        throw new RunnerExecutionFailedError(workOrder.work_order_id, `failed to start the Claude Code subprocess (${outcome.error.code ?? "error"})`, outcome.error);
      } else if (outcome.kind === "timeout") {
        result = {
          status: "timeout",
          workOrderId: workOrder.work_order_id,
          startedAt,
          completedAt,
          exitCode: null,
          sessionReference: null,
          repository: repositoryResult,
          verification: zeroVerification,
          deliveryEvidence: { commit: null, pushStatus: "not_applicable", summary: `execution exceeded the configured maximum run duration (${executionPolicy.maxRunDurationMs} ms)` },
        };
      } else if (outcome.kind === "interrupted") {
        result = {
          status: "interrupted",
          workOrderId: workOrder.work_order_id,
          startedAt,
          completedAt,
          exitCode: null,
          sessionReference: null,
          repository: repositoryResult,
          verification: zeroVerification,
          deliveryEvidence: { commit: null, pushStatus: "not_applicable", summary: `execution was interrupted by signal ${outcome.signal}` },
        };
      } else {
        const selfReport = parseClaudeSelfReport(outcome.stdout, workOrder.work_order_id);
        const boundedSummary = selfReport.summary.slice(0, MAX_SUMMARY_LENGTH);
        const testsPassed = selfReport.testsSummary.failed === 0 && selfReport.testsSummary.total > 0;
        const fixturesPassed = selfReport.fixturesSummary.failed === 0 && selfReport.fixturesSummary.total > 0;
        result = {
          status: outcome.exitCode === 0 && selfReport.completed ? "completed" : "failed",
          workOrderId: workOrder.work_order_id,
          startedAt,
          completedAt,
          exitCode: outcome.exitCode,
          sessionReference: null,
          repository: repositoryResult,
          verification: { testsPassed, fixturesPassed, testsSummary: selfReport.testsSummary, fixturesSummary: selfReport.fixturesSummary },
          deliveryEvidence: {
            commit: selfReport.committed ? (selfReport.commit ?? gitState.commit) : null,
            pushStatus: selfReport.pushed ? "pushed" : selfReport.committed ? "not_pushed" : "not_applicable",
            summary: boundedSummary,
          },
        };
      }

      return assertValidRunnerResult(result, workOrder.work_order_id);
    },
  };
}

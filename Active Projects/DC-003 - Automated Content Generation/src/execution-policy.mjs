// DC-003-I029.2 — Execution Policy: the single, explicit description of
// how much authority the Automated Delivery Office Runner is allowed to
// exercise inside the DC-003 repository. Composition only, no filesystem,
// no networking — the runner adapter (claude-code-delivery-runner-adapter.mjs)
// is the only module that turns this into real subprocess flags.
//
// Defaults are deliberately conservative (§3 of the DC-003-I029.2 brief):
// no commits, no pushes, no Docker, live external calls and infrastructure
// changes both prohibited, a small default cost ceiling. A caller must
// explicitly opt into anything broader — there is no "trust the Work
// Order" escape hatch.
//
// Repository-evidence finding, worth recording here: engineering-work-order
// .schema.json (I029) has no structured field for a Work Order to request
// narrower (or broader) execution authority — only a free-text
// `constraints` array (an array of strings, no machine-parseable schema).
// The brief's own §3 instruction ("a Work Order may narrow permissions
// further, it may never broaden the configured maximum authority") is
// therefore honoured by resolveEffectivePolicy() as a currently-honest
// no-op: constraints are surfaced verbatim into the Claude instruction (see
// buildDeliveryInstruction() in claude-code-delivery-runner-adapter.mjs) for
// Claude itself to read and respect, but are never mechanically parsed
// into policy flags — inventing a parsing contract engineering-work-order
// .schema.json doesn't define would be new scope this milestone's own
// brief (§6) explicitly forbids. A future milestone that wants real
// per-Work-Order narrowing needs a real schema field to parse, not a
// guessed convention.

import { InvalidExecutionPolicyError } from "./delivery-office-errors.mjs";
import { deepFreezeClone } from "./immutable.mjs";

const DEFAULT_ALLOWED_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(git status)", "Bash(git diff*)", "Bash(git log*)", "Bash(git add*)", "Bash(git commit*)"];
const DEFAULT_DISALLOWED_TOOLS = ["WebFetch", "WebSearch"];
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RUN_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_MAX_COST_USD = 2;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && v.trim() !== "");
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * Builds an immutable Execution Policy.
 *
 * fields.repositoryPath — required, non-empty string. Never defaulted —
 *   mirrors this codebase's "storeDirectory is always an explicit
 *   argument" convention (see local-json-*-adapter.mjs).
 * fields.permittedBranch — required, non-empty string (e.g. "main" or a
 *   feature branch name).
 * fields.allowedTools — optional array of strings, default a narrow
 *   read/edit/local-git set (see DEFAULT_ALLOWED_TOOLS above).
 * fields.disallowedTools — optional array of strings, default
 *   ["WebFetch", "WebSearch"] — always merged with the live-external-call
 *   and infrastructure denials computed below, never replacing them.
 * fields.commandTimeoutMs — optional positive integer, default 5 minutes.
 * fields.maxRunDurationMs — optional positive integer, default 30 minutes.
 *   Must be >= commandTimeoutMs.
 * fields.allowCommits — optional boolean, default false.
 * fields.allowPush — optional boolean, default false. Requires
 *   allowCommits === true (a policy cannot push without also allowing the
 *   commit that would be pushed).
 * fields.allowDocker — optional boolean, default false.
 * fields.prohibitLiveExternalCalls — optional boolean, default true.
 * fields.prohibitInfrastructureChanges — optional boolean, default true.
 * fields.maxCostUsd — optional positive number or null, default 2.
 * fields.maxTokens — optional positive integer or null, default null
 *   (unset — Claude Code's own --max-budget-usd is the primary ceiling
 *   this project uses; token budgets are not currently exposed as a
 *   distinct CLI flag per the DC-003-I029.2 feasibility investigation).
 *
 * Throws InvalidExecutionPolicyError for any structurally invalid field.
 */
export function createExecutionPolicy(fields = {}) {
  if (!isNonEmptyString(fields.repositoryPath)) {
    throw new InvalidExecutionPolicyError("fields.repositoryPath is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.permittedBranch)) {
    throw new InvalidExecutionPolicyError("fields.permittedBranch is required and must be a non-empty string");
  }

  const allowedTools = fields.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  if (!isStringArray(allowedTools)) {
    throw new InvalidExecutionPolicyError("fields.allowedTools must be an array of non-empty strings");
  }

  const callerDisallowedTools = fields.disallowedTools ?? [];
  if (!isStringArray(callerDisallowedTools) && callerDisallowedTools.length !== 0) {
    throw new InvalidExecutionPolicyError("fields.disallowedTools must be an array of non-empty strings");
  }

  const commandTimeoutMs = fields.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  if (!isPositiveInteger(commandTimeoutMs)) {
    throw new InvalidExecutionPolicyError("fields.commandTimeoutMs must be a positive integer");
  }
  const maxRunDurationMs = fields.maxRunDurationMs ?? DEFAULT_MAX_RUN_DURATION_MS;
  if (!isPositiveInteger(maxRunDurationMs)) {
    throw new InvalidExecutionPolicyError("fields.maxRunDurationMs must be a positive integer");
  }
  if (maxRunDurationMs < commandTimeoutMs) {
    throw new InvalidExecutionPolicyError("fields.maxRunDurationMs must be greater than or equal to fields.commandTimeoutMs");
  }

  const allowCommits = fields.allowCommits ?? false;
  if (typeof allowCommits !== "boolean") {
    throw new InvalidExecutionPolicyError("fields.allowCommits must be a boolean");
  }
  const allowPush = fields.allowPush ?? false;
  if (typeof allowPush !== "boolean") {
    throw new InvalidExecutionPolicyError("fields.allowPush must be a boolean");
  }
  if (allowPush && !allowCommits) {
    throw new InvalidExecutionPolicyError("fields.allowPush cannot be true while fields.allowCommits is false — a policy cannot push a commit it does not allow creating");
  }
  const allowDocker = fields.allowDocker ?? false;
  if (typeof allowDocker !== "boolean") {
    throw new InvalidExecutionPolicyError("fields.allowDocker must be a boolean");
  }
  const prohibitLiveExternalCalls = fields.prohibitLiveExternalCalls ?? true;
  if (typeof prohibitLiveExternalCalls !== "boolean") {
    throw new InvalidExecutionPolicyError("fields.prohibitLiveExternalCalls must be a boolean");
  }
  const prohibitInfrastructureChanges = fields.prohibitInfrastructureChanges ?? true;
  if (typeof prohibitInfrastructureChanges !== "boolean") {
    throw new InvalidExecutionPolicyError("fields.prohibitInfrastructureChanges must be a boolean");
  }

  const maxCostUsd = fields.maxCostUsd === undefined ? DEFAULT_MAX_COST_USD : fields.maxCostUsd;
  if (maxCostUsd !== null && !(typeof maxCostUsd === "number" && maxCostUsd > 0)) {
    throw new InvalidExecutionPolicyError("fields.maxCostUsd must be a positive number or null");
  }
  const maxTokens = fields.maxTokens ?? null;
  if (maxTokens !== null && !isPositiveInteger(maxTokens)) {
    throw new InvalidExecutionPolicyError("fields.maxTokens must be a positive integer or null");
  }

  // Live-external-call and infrastructure-change denials are computed,
  // never left to caller opt-out — they are ALWAYS present in
  // disallowedTools when their governing flag is true, merged with
  // whatever the caller additionally supplied.
  const computedDenials = new Set(callerDisallowedTools);
  if (prohibitLiveExternalCalls) {
    for (const tool of DEFAULT_DISALLOWED_TOOLS) computedDenials.add(tool);
  }
  if (!allowDocker) {
    computedDenials.add("Bash(docker*)");
  }
  if (!allowPush) {
    computedDenials.add("Bash(git push*)");
  }
  if (!allowCommits) {
    computedDenials.add("Bash(git commit*)");
  }

  const policy = {
    repositoryPath: fields.repositoryPath,
    permittedBranch: fields.permittedBranch,
    allowedTools: [...allowedTools],
    disallowedTools: [...computedDenials],
    commandTimeoutMs,
    maxRunDurationMs,
    allowCommits,
    allowPush,
    allowDocker,
    prohibitLiveExternalCalls,
    prohibitInfrastructureChanges,
    maxCostUsd,
    maxTokens,
  };

  return deepFreezeClone(policy);
}

/**
 * Resolves the effective policy for one specific Work Order. Currently an
 * honest no-op — see this module's own header comment for why: no
 * structured narrowing field exists on engineering-work-order.schema.json
 * yet. Kept as its own named function (rather than inlining "just use the
 * policy") so the call site in automated-delivery-office-service.mjs
 * documents the intent and gives a future milestone one obvious place to
 * add real narrowing once a schema field exists for it.
 */
export function resolveEffectivePolicy(policy, _workOrder) {
  return policy;
}

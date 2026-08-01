// DC-003-I012 — Production Workflow: composes the entire platform
// (n8n Adapter -> Invocation Adapter -> Pipeline Orchestrator -> platform
// pipeline) into one runnable, end-to-end production execution.
//
// This module implements no platform behavior of its own. It calls the
// n8n Adapter (DC-003-I011, unchanged) exactly once, times that one call,
// and reports/persists the result. Every architectural decision
// (validation, orchestration, rendering, ledger writes, response mapping)
// stays inside the layers already built in DC-003-I001 through I011 —
// per the Strategy Office's own framing, this milestone is composition,
// not construction.
//
// "Collecting the completed InvocationResponse" (per the brief) means the
// object n8nAdapter.invoke() itself returns — the n8n Output shape
// (DC-003-I011): { success, executionId, requestId, status,
// finishedCarousel, warnings, error }. The workflow deliberately does not
// bypass the n8n Adapter to reach the Invocation Adapter directly for the
// raw InvocationResponse's own accepted/correlation_metadata fields — "the
// n8n Adapter must not communicate directly with the Pipeline
// Orchestrator" extends here too: the workflow only ever calls the n8n
// Adapter, exactly matching the brief's own architecture diagram
// (Workflow Trigger -> n8n Adapter -> ... -> Workflow Output).
//
// No new error classes: PipelineConfigurationError (misconfiguration) and
// toSafeInvocationError() (the one defensive fallback below) are both
// reused, unchanged, from existing modules.

import { writeFileSync } from "node:fs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";
import { toSafeInvocationError } from "./invocation-errors.mjs";

function elapsedMs(startedAt, completedAt) {
  return Date.parse(completedAt) - Date.parse(startedAt);
}

function safeFallbackOutput(workflowInput, error) {
  return {
    success: false,
    executionId: null,
    requestId: typeof workflowInput?.requestId === "string" ? workflowInput.requestId : null,
    status: "failed",
    finishedCarousel: null,
    warnings: [],
    error: toSafeInvocationError(error),
  };
}

/**
 * Builds a Production Workflow bound to one n8n Adapter.
 *
 * fields.n8nAdapter — required, the return value of createN8nAdapter()
 *   (an object with `invoke()`) — checked immediately, matching every
 *   other adapter/orchestrator's fail-fast-on-misconfiguration pattern in
 *   this codebase.
 *
 * Returns { run }.
 */
export function createProductionWorkflow({ n8nAdapter } = {}) {
  if (!n8nAdapter || typeof n8nAdapter.invoke !== "function") {
    throw new PipelineConfigurationError(
      "createProductionWorkflow requires a valid n8n Adapter (an object with invoke())"
    );
  }

  /**
   * Executes one complete production run: invokes the n8n Adapter exactly
   * once, and assembles the workflow's own output and summary around it.
   * Loading workflow input from disk is the caller's job (typically a
   * CLI) — this function takes the already-parsed workflow input object.
   *
   * options.clock — () => ISO date-time string, used only to measure this
   *   workflow's own wall-clock duration around the single n8n Adapter
   *   call. Forwarded to the n8n Adapter (and everything beneath it)
   *   unchanged, so the whole chain shares one clock in tests.
   *
   * Never throws: even if n8nAdapter.invoke() itself throws unexpectedly
   * (not expected in practice — DC-003-I011's own adapter is already a
   * safety net for this — but tested directly, matching the same "assume
   * nothing" discipline every layer in this platform already applies to
   * itself), run() still resolves to a well-formed workflow result.
   *
   * Returns { invocationResponse, finishedCarousel, executionId,
   * requestId, summary } — no internal platform object (PipelineContext,
   * StageResult, a raw ExecutionRecord) ever appears here.
   */
  async function run(workflowInput, options = {}) {
    const clock = options.clock ?? (() => new Date().toISOString());
    const startedAt = clock();

    let invocationResponse;
    try {
      invocationResponse = await n8nAdapter.invoke(workflowInput, options);
    } catch (error) {
      invocationResponse = safeFallbackOutput(workflowInput, error);
    }

    const completedAt = clock();
    const summary = {
      status: invocationResponse.status,
      executionId: invocationResponse.executionId,
      requestId: invocationResponse.requestId,
      durationMs: elapsedMs(startedAt, completedAt),
      completedAt,
      warningCount: invocationResponse.warnings.length,
      hasError: invocationResponse.error !== null,
    };

    return {
      invocationResponse,
      finishedCarousel: invocationResponse.finishedCarousel,
      executionId: invocationResponse.executionId,
      requestId: invocationResponse.requestId,
      summary,
    };
  }

  return { run };
}

/**
 * Persists a workflow result (createProductionWorkflow().run()'s return
 * value) to disk as pretty-printed JSON — "output persistence," kept as a
 * separate, side-effect-only function so run() itself stays pure and
 * trivially testable without touching the filesystem.
 */
export function persistWorkflowOutput(outputPath, workflowResult) {
  writeFileSync(outputPath, JSON.stringify(workflowResult, null, 2), "utf-8");
}

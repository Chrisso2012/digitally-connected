// DC-003-I010 — External Invocation Adapter: the platform's first stable
// external boundary. Translates an InvocationRequest into a Pipeline
// Orchestrator call, and the resulting PipelineResult back into a safe
// InvocationResponse.
//
// Fundamental Principle (per the DC-003-I010 brief): the adapter
// translates. It does not orchestrate, does not generate content, does
// not render, and never writes to the Execution Ledger — every one of
// those responsibilities stays inside the Pipeline Orchestrator
// (DC-003-I009) and the modules it coordinates. This file contains no
// pipeline business logic of its own.
//
// Correlation: request_id (external, caller-supplied) and execution_id
// (internal, orchestrator-generated) are always kept distinct — the
// adapter never substitutes one for the other, and both appear, unchanged,
// on every InvocationResponse.
//
// Execution model: strictly synchronous. invoke() awaits the entire
// pipeline run before returning — no polling, no callbacks, no
// asynchronous processing. The field separation between `accepted`
// (was this request even valid) and `status` (how did execution turn
// out) already anticipates a future asynchronous adapter that could
// return `accepted: true` before execution finishes; DC-003-I010's own
// synchronous flow always resolves `status` to its terminal value before
// returning.
//
// Safety net: invoke() never throws under normal operation — every branch
// (validation failure, a genuine orchestrator error, a successful or
// failed pipeline run) always resolves to a well-formed InvocationResponse.

import { prepareInvocationRequest } from "./invocation-request.mjs";
import { normalizeInvocationRequest } from "./invocation-normalizer.mjs";
import { createInvocationResponse } from "./invocation-response.mjs";
import { toSafeInvocationError } from "./invocation-errors.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";

function extractRequestId(rawRequest) {
  return typeof rawRequest?.request_id === "string" && rawRequest.request_id.trim() !== "" ? rawRequest.request_id : null;
}

function extractCorrelationMetadata(rawRequest) {
  const value = rawRequest?.correlation_metadata;
  return value && typeof value === "object" ? value : null;
}

/**
 * Builds an External Invocation Adapter bound to one Pipeline Orchestrator.
 *
 * fields.orchestrator — required, the return value of
 *   createPipelineOrchestrator() (an object with `run()`) — checked
 *   immediately, matching the same fail-fast-on-misconfiguration pattern
 *   createPipelineOrchestrator() and createExecutionLedger() already use.
 *
 * Returns { invoke }.
 */
export function createExternalInvocationAdapter({ orchestrator } = {}) {
  if (!orchestrator || typeof orchestrator.run !== "function") {
    throw new PipelineConfigurationError(
      "createExternalInvocationAdapter requires a valid Pipeline Orchestrator (an object with run())"
    );
  }

  /**
   * The adapter's one public entry point.
   *
   * options.clock / executionIdGenerator / recordIdGenerator — forwarded
   *   straight through to orchestrator.run() for deterministic tests.
   * options.validator — forwarded to prepareInvocationRequest()/
   *   createInvocationResponse().
   *
   * Always resolves to an InvocationResponse — never rejects/throws for a
   * validation failure or a pipeline failure. Only a genuinely unexpected
   * bug elsewhere would still be caught here rather than propagate,
   * exactly as pipeline-orchestrator.mjs is itself a safety net for a
   * misbehaving stage.
   */
  async function invoke(rawRequest, options = {}) {
    const fallbackRequestId = extractRequestId(rawRequest);
    const fallbackCorrelationMetadata = extractCorrelationMetadata(rawRequest);

    let invocationRequest;
    try {
      invocationRequest = prepareInvocationRequest(rawRequest, options);
    } catch (error) {
      return createInvocationResponse(
        {
          accepted: false,
          request_id: fallbackRequestId,
          execution_id: null,
          status: "rejected",
          finished_carousel: null,
          warnings: [],
          error: toSafeInvocationError(error),
          correlation_metadata: fallbackCorrelationMetadata,
        },
        options
      );
    }

    const correlationMetadata = invocationRequest.correlation_metadata ?? null;
    const normalized = normalizeInvocationRequest(invocationRequest);

    let pipelineResult;
    try {
      pipelineResult = await orchestrator.run(normalized, {
        clock: options.clock,
        executionIdGenerator: options.executionIdGenerator,
        recordIdGenerator: options.recordIdGenerator,
      });
    } catch (error) {
      // orchestrator.run() never throws for a pipeline-execution failure
      // (see pipeline-orchestrator.mjs) — this only catches a genuine
      // orchestrator-level error (e.g. a ledger write failure for
      // execution.started itself, before any stage runs).
      return createInvocationResponse(
        {
          accepted: true,
          request_id: invocationRequest.request_id,
          execution_id: null,
          status: "failed",
          finished_carousel: null,
          warnings: [],
          error: toSafeInvocationError(error),
          correlation_metadata: correlationMetadata,
        },
        options
      );
    }

    return createInvocationResponse(
      {
        accepted: true,
        request_id: invocationRequest.request_id,
        execution_id: pipelineResult.executionId,
        status: pipelineResult.success ? "completed" : "failed",
        finished_carousel: pipelineResult.finishedCarousel,
        warnings: pipelineResult.warnings,
        error: pipelineResult.error ? toSafeInvocationError(pipelineResult.error) : null,
        correlation_metadata: correlationMetadata,
      },
      options
    );
  }

  return { invoke };
}

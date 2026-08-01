// DC-003-I011 — n8n Adapter: the platform's first production integration,
// a thin translation layer between an n8n workflow and the External
// Invocation Adapter (DC-003-I010, unchanged). It contains no platform
// business logic of its own — every real decision (request validation,
// orchestration, rendering, ledger writes) stays inside the layers
// beneath it. This adapter never talks to the Pipeline Orchestrator
// directly; every request flows through the Invocation Adapter.
//
// Responsibilities, and only these: map workflow input into an
// InvocationRequest-shaped object (n8n-workflow-mapper.mjs), invoke the
// Invocation Adapter, and map the resulting InvocationResponse into an
// n8n-friendly output object (n8n-response-mapper.mjs). No validation
// logic of its own is duplicated here — invocationAdapter.invoke() is
// already the platform's one safe, never-throwing validation boundary.

import { mapWorkflowInputToInvocationRequest } from "./n8n-workflow-mapper.mjs";
import { mapInvocationResponseToN8nOutput } from "./n8n-response-mapper.mjs";
import { toSafeInvocationError } from "./invocation-errors.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";

/**
 * Builds an n8n Adapter bound to one External Invocation Adapter.
 *
 * fields.invocationAdapter — required, the return value of
 *   createExternalInvocationAdapter() (an object with `invoke()`) —
 *   checked immediately, matching every other adapter/orchestrator in
 *   this codebase's fail-fast-on-misconfiguration pattern.
 *
 * Returns { invoke }.
 */
export function createN8nAdapter({ invocationAdapter } = {}) {
  if (!invocationAdapter || typeof invocationAdapter.invoke !== "function") {
    throw new PipelineConfigurationError(
      "createN8nAdapter requires a valid External Invocation Adapter (an object with invoke())"
    );
  }

  /**
   * The adapter's one public entry point.
   *
   * options — forwarded straight through to invocationAdapter.invoke()
   *   (clock/executionIdGenerator/recordIdGenerator, for deterministic
   *   tests).
   *
   * Never throws to the calling workflow. Even a workflowInput so
   * malformed it crashes mapping itself (never expected in practice —
   * mapWorkflowInputToInvocationRequest() is written defensively enough
   * not to — but tested directly, the same "assume nothing" discipline
   * every adapter boundary in this codebase already applies to itself)
   * still resolves to a well-formed, safe n8n output object.
   */
  async function invoke(workflowInput, options = {}) {
    let invocationRequest;
    try {
      invocationRequest = mapWorkflowInputToInvocationRequest(workflowInput);
    } catch (error) {
      return {
        success: false,
        executionId: null,
        requestId: null,
        status: "rejected",
        finishedCarousel: null,
        warnings: [],
        error: toSafeInvocationError(error),
      };
    }

    const invocationResponse = await invocationAdapter.invoke(invocationRequest, options);
    return mapInvocationResponseToN8nOutput(invocationResponse);
  }

  return { invoke };
}

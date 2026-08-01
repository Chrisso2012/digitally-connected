// DC-003-I011 — n8n output mapping: converts an InvocationResponse
// (DC-003-I010, unchanged) into the flat, camelCase object shape n8n
// downstream nodes expect. Pure, deterministic, no I/O — a straight field
// rename/selection, the same kind of mechanical translation every adapter
// boundary in this codebase already does at its own edge.
//
// `success` is deliberately NOT the same as InvocationResponse.accepted:
// `accepted` only means the request was well-formed enough to attempt;
// a workflow branching on "did this actually work" needs `status ===
// "completed"` — accepted-but-failed must not read as success to n8n.
//
// `finished_carousel` is passed through unchanged (only renamed to
// camelCase at this outer key) — it is already this platform's own public,
// provider-independent contract (DC-003-I007), so no further translation
// of its internal fields happens at this boundary. `error` is passed
// through unchanged too: InvocationResponse.error is already the
// `{ code, message, retryable }` safe shape this output needs.
// `correlation_metadata` is deliberately dropped — not part of the
// documented n8n output contract.

/**
 * Maps an InvocationResponse onto the n8n output shape:
 * { success, executionId, requestId, status, finishedCarousel, warnings, error }.
 */
export function mapInvocationResponseToN8nOutput(invocationResponse) {
  return {
    success: invocationResponse.status === "completed",
    executionId: invocationResponse.execution_id,
    requestId: invocationResponse.request_id,
    status: invocationResponse.status,
    finishedCarousel: invocationResponse.finished_carousel,
    warnings: invocationResponse.warnings,
    error: invocationResponse.error,
  };
}

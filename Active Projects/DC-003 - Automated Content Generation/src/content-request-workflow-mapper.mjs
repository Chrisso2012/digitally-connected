// DC-003-I016 — Content Request -> Production Workflow input mapping.
// Pure, deterministic, no I/O — a straight field mapping onto the exact
// shape DC-003-I012's Production Workflow already expects
// ({ requestId, topicPackageData }), unchanged. The Content Request's own
// request_id becomes the workflow's requestId — the same identifier flows
// through end to end, which is intentional (see content-request-service.mjs
// for why this isn't the "reuse" the I016 brief forbids).

/**
 * Maps a validated Content Request and its already-resolved Topic
 * Package onto a Production Workflow input object.
 */
export function mapContentRequestToProductionWorkflowInput(contentRequest, resolvedTopicPackage) {
  return {
    requestId: contentRequest.request_id,
    topicPackageData: resolvedTopicPackage,
  };
}

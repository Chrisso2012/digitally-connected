// DC-003-I010 — Request Normalization: converts a validated
// InvocationRequest into the exact input shape the Pipeline Orchestrator's
// run() expects. No validation happens here — prepareInvocationRequest()
// already did that — this is pure structural translation, the same kind
// of mechanical renaming DC-003-I005's Payload Mapper and DC-003-I009's
// pipeline-stages.mjs already do at their own boundaries. No normalization
// logic belongs inside the orchestrator itself (per the DC-003-I010
// brief); this module is where it lives instead.

/**
 * Converts an InvocationRequest into { configuration } — the first
 * argument orchestrator.run() expects.
 */
export function normalizeInvocationRequest(invocationRequest) {
  const reference = invocationRequest.topic_package_reference;
  const topicPackageSource = "file_path" in reference ? { filePath: reference.file_path } : { data: reference.data };

  return { configuration: { topicPackageSource } };
}

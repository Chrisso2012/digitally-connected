// DC-003-I011 — n8n workflow input mapping: converts a flat, n8n-friendly
// workflow input object into the exact shape prepareInvocationRequest()
// (DC-003-I010, unchanged) expects. Pure, deterministic, and deliberately
// does no validation of its own — "no additional platform-specific
// information should be required from n8n," and re-validating here would
// duplicate the Invocation Adapter's own (already-safe) validation, which
// the DC-003-I011 brief explicitly forbids. A malformed or ambiguous
// mapping (a missing request_id, neither/both of file_path/data) still
// produces a well-formed-shaped object; invocationAdapter.invoke() is what
// catches and safely rejects it downstream — never this function.
//
// Workflow input shape (n8n's own convention — camelCase, flat, no schema
// of its own; this is not one of this platform's public contracts):
//
//   { requestId: string,
//     topicPackageFilePath?: string,
//     topicPackageData?: object,
//     executionOptions?: object,
//     correlationMetadata?: object }

/**
 * Maps n8n workflow input onto an InvocationRequest-shaped object
 * (snake_case, matching invocation-request.schema.json). Never throws:
 * property access on `workflowInput ?? {}` is safe regardless of the
 * input's actual type (a primitive, null, or undefined all resolve to
 * `undefined` fields here, which InvocationRequest's own schema then
 * rejects as missing/invalid — this function does not decide that).
 */
export function mapWorkflowInputToInvocationRequest(workflowInput) {
  const input = workflowInput ?? {};

  const topicPackageReference = {};
  if (typeof input.topicPackageFilePath === "string") {
    topicPackageReference.file_path = input.topicPackageFilePath;
  }
  if (input.topicPackageData && typeof input.topicPackageData === "object") {
    topicPackageReference.data = input.topicPackageData;
  }

  return {
    request_id: input.requestId,
    topic_package_reference: topicPackageReference,
    execution_options: input.executionOptions ?? null,
    correlation_metadata: input.correlationMetadata ?? null,
  };
}

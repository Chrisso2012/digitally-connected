// DC-003-I010 — structured errors + the safe-error mapping for the
// External Invocation Adapter.

/**
 * An InvocationRequest failed schema validation via the I002 runtime.
 * Thrown before any pipeline work begins — a validation failure never
 * reaches the Pipeline Orchestrator.
 */
export class InvocationRequestValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Invocation Request failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "InvocationRequestValidationError";
    this.errors = errors;
  }
}

/**
 * The adapter's own assembled InvocationResponse failed schema validation
 * — a bug in the adapter itself (every branch in invocation-adapter.mjs
 * should always produce a schema-valid response), not a caller error.
 */
export class InvocationResponseValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Invocation Response failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "InvocationResponseValidationError";
    this.errors = errors;
  }
}

const RETRYABLE_ERROR_NAMES = new Set(["TimeoutError", "TransportError"]);

/**
 * Converts any error into the allowlisted shape InvocationResponse.error
 * requires: { code, message, retryable }. This is the external contract's
 * own boundary — deliberately narrower than pipeline-errors.mjs's
 * toSafeStageError() (which also carries `stage`): "stage" names an
 * internal pipeline concept an external caller has no business depending
 * on, so it's dropped here rather than passed through. Never a stack
 * trace, a raw provider response, an API key, a transport detail, a raw
 * ValidationError, or an internal module name — see README "Error
 * mapping".
 *
 * Accepts either a genuine thrown Error, or an already-safe
 * { code, message, retryable } (or { stage, code, message, retryable })
 * object such as PipelineResult.error/StageResult.error — every DC-003
 * error class and every existing safe-error shape already constructs a
 * safe message, so this function only normalizes the shape, it never
 * needs to re-sanitize content that's already clean.
 */
export function toSafeInvocationError(error) {
  if (error && typeof error.code === "string" && typeof error.message === "string") {
    return { code: error.code, message: error.message, retryable: Boolean(error.retryable) };
  }
  return {
    code: error?.name ?? "UnknownError",
    message: error?.message ?? "Invocation failed with no further detail",
    retryable: RETRYABLE_ERROR_NAMES.has(error?.name),
  };
}

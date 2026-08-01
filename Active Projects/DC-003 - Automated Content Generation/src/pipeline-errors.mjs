// DC-003-I009 — structured errors + the safe-error mapping for the
// Pipeline Orchestrator.

/**
 * The orchestrator itself was misconfigured (no valid ExecutionLedger, an
 * empty/malformed stage list) — a caller bug, not a pipeline-execution
 * failure, so it's thrown immediately rather than surfacing as a failed
 * PipelineResult. A missing/malformed *input* to a stage (e.g. no Topic
 * Package source given to run()) is different — that's a normal failed
 * execution, reported as a failed PipelineResult via toSafeStageError()
 * below, never thrown out of run().
 */
export class PipelineConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PipelineConfigurationError";
  }
}

// Error classes from earlier stages whose underlying cause is genuinely
// transient (a network hiccup, a timeout) — informational only.
// DC-003-I009 does not add any orchestrator-level retry behavior around
// this ("Out of scope: Retry policy changes") — every existing retry
// policy (DC-003-I004's carousel generation, DC-003-I006's renderer) is
// untouched and still governs its own module internally.
const RETRYABLE_ERROR_NAMES = new Set(["TimeoutError", "TransportError"]);

/**
 * Converts any thrown error (a recognized DC-003 error class, or a
 * genuinely unexpected one) into the safe, structured shape both
 * StageResult.error and an execution.failed record's diagnostics need:
 * { stage, code, message, retryable }.
 *
 * Every DC-003 error class already constructs a safe message (no raw
 * response bodies, no API keys, no stack traces — see each module's own
 * error file), so `error.message` is safe to surface directly here; this
 * function's job is only to normalize the shape into one every stage and
 * the orchestrator itself share, never to re-sanitize content that's
 * already clean. This is what "no raw provider errors leave the pipeline"
 * means in practice: nothing here ever touches `error.stack`, a raw
 * transport response, or an Authorization header.
 */
export function toSafeStageError(stageName, error) {
  return {
    stage: stageName,
    code: error?.name ?? "UnknownError",
    message: error?.message ?? "Stage failed with no further detail",
    retryable: RETRYABLE_ERROR_NAMES.has(error?.name),
  };
}

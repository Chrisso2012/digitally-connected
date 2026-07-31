// DC-003-I006 — structured renderer error hierarchy.
//
// Unlike earlier DC-003 error modules (flat classes, each extending Error
// directly), this module builds a genuine hierarchy — every renderer error
// extends RendererError — so a caller can `instanceof RendererError` as a
// catch-all, or check a specific subclass for precise handling. Both
// styles support instanceof checks; this one adds a common ancestor
// because the I006 brief explicitly calls for a "structured renderer error
// hierarchy," not just a set of distinct classes.

export class RendererError extends Error {
  constructor(message) {
    super(message);
    this.name = "RendererError";
  }
}

export class AuthenticationError extends RendererError {
  constructor(message) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class TransportError extends RendererError {
  constructor(message, cause) {
    super(message);
    this.name = "TransportError";
    this.cause = cause ?? null;
  }
}

export class TimeoutError extends RendererError {
  constructor(message, timeoutMs) {
    super(message);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs ?? null;
  }
}

/**
 * The transport's raw response could not be trusted — wrong shape,
 * missing/invalid required fields. Distinct from RenderRejected: this
 * means the response itself is untrustworthy, not that Templated reported
 * a failed render.
 */
export class ValidationError extends RendererError {
  constructor(message, details = []) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

/**
 * The transport's response was well-formed but reported a terminal
 * "failed" render status. Non-retryable: the same payload will fail again.
 */
export class RenderRejected extends RendererError {
  constructor(message, renderId, reason) {
    super(message);
    this.name = "RenderRejected";
    this.renderId = renderId ?? null;
    this.reason = reason ?? null;
  }
}

/**
 * Every retry attempt failed. `attempts` is the full array of per-attempt
 * { ok: false, error } results, preserved in order — never collapsed into
 * a single generic message.
 */
export class RetryLimitExceeded extends RendererError {
  constructor(attempts, maxAttempts) {
    const summary = attempts
      .map((attempt, index) => `  attempt ${index + 1}: [${attempt.error?.name ?? "Error"}] ${attempt.error?.message ?? "unknown error"}`)
      .join("\n");
    super(`Render failed after ${attempts.length}/${maxAttempts} attempt(s):\n${summary}`);
    this.name = "RetryLimitExceeded";
    this.attempts = attempts;
    this.maxAttempts = maxAttempts;
  }
}

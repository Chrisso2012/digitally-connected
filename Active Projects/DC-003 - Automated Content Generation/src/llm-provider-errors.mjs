// DC-003-I019 — structured LLM provider error hierarchy. Mirrors
// DC-003-I006's RendererError hierarchy exactly (a genuine hierarchy —
// every error extends LlmProviderError — so a caller can `instanceof
// LlmProviderError` as a catch-all, or check a specific subclass).
//
// Every class carries a `retryable` boolean — the one generic signal
// `carousel-generator.mjs`'s retry loop checks (see that module's own
// header comment) to decide whether to retry or propagate immediately.
// This mirrors the `retryable` field DC-003-I010's InvocationResponse.error
// already established as this codebase's own vocabulary for "will this
// fail identically again" — not a new concept, and not provider-specific:
// `carousel-generator.mjs` checks `cause?.retryable === false` generically,
// never `instanceof` on any class defined here, so no LLM-provider-specific
// structure crosses into the domain layer.
//
// None of these ever carry an API key, an authorization header, a raw
// provider response body, or the full prompt text in `.message` — see
// each class's own comment for what it does carry.

export class LlmProviderError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = "LlmProviderError";
    this.retryable = retryable;
  }
}

/**
 * Required configuration (an API key, a model, a base URL) is missing or
 * invalid — thrown at adapter/transport construction time, before any
 * request is ever attempted. Never retryable: the same missing
 * configuration will be missing again immediately.
 */
export class LlmConfigurationError extends LlmProviderError {
  constructor(message) {
    super(message, { retryable: false });
    this.name = "LlmConfigurationError";
  }
}

/**
 * The provider rejected the request's credentials (HTTP 401/403). Never
 * retryable — the same key will be rejected again identically.
 */
export class LlmAuthenticationError extends LlmProviderError {
  constructor(message) {
    super(message, { retryable: false });
    this.name = "LlmAuthenticationError";
  }
}

/**
 * The provider reported a rate limit (HTTP 429). Retryable — "rate limit
 * where safe," per the approved I019 brief — bounded by the same
 * maxAttempts ceiling every other retryable failure in this codebase
 * already respects; never unbounded.
 */
export class LlmRateLimitError extends LlmProviderError {
  constructor(message, retryAfterMs) {
    super(message, { retryable: true });
    this.name = "LlmRateLimitError";
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

/**
 * The request did not complete within the configured timeout. Retryable —
 * a timeout is transient by nature.
 */
export class LlmTimeoutError extends LlmProviderError {
  constructor(message, timeoutMs) {
    super(message, { retryable: true });
    this.name = "LlmTimeoutError";
    this.timeoutMs = timeoutMs ?? null;
  }
}

/**
 * A network-level failure, or a provider 5xx response — transient by
 * nature. Retryable.
 */
export class LlmTransportError extends LlmProviderError {
  constructor(message, cause) {
    super(message, { retryable: true });
    this.name = "LlmTransportError";
    this.cause = cause ?? null;
  }
}

/**
 * The provider rejected the request itself — an HTTP 4xx response other
 * than 401/403 (authentication) or 429 (rate limit); HTTP 400
 * invalid_request_error is the common case, and the one that triggered
 * this class's own introduction in DC-003-I019.1 (see README "Live
 * Verification Gate incident"). Never retryable — a request-construction
 * problem is deterministic and will be rejected again identically.
 * Carries a `diagnostic` object ({ status, errorType, requestId, message })
 * built by llm-error-diagnostics.mjs — never the raw response body,
 * headers, API key, request payload, prompt, or tool content.
 */
export class LlmClientError extends LlmProviderError {
  constructor(message, diagnostic = null) {
    super(message, { retryable: false });
    this.name = "LlmClientError";
    this.diagnostic = diagnostic;
  }
}

/**
 * The provider's response could not be trusted — not valid JSON, missing
 * the expected structured-output block, or an input that isn't a plain
 * object. Never retryable: a shape mismatch is deterministic and will
 * recur identically on retry (the same reasoning DC-003-I006's
 * ValidationError already established for Templated responses).
 * `details` never includes the raw response body — only a safe,
 * type-level descriptor of what was found.
 */
export class LlmMalformedResponseError extends LlmProviderError {
  constructor(message, details = []) {
    super(message, { retryable: false });
    this.name = "LlmMalformedResponseError";
    this.details = details;
  }
}

/**
 * The provider understood the request but declined to fulfill it (a
 * content-policy refusal, or an explicit stop_reason indicating the
 * model would not complete the structured tool call). Never retryable —
 * the same prompt will be declined again identically.
 */
export class LlmProviderRejectedError extends LlmProviderError {
  constructor(message, reason) {
    super(message, { retryable: false });
    this.name = "LlmProviderRejectedError";
    this.reason = reason ?? null;
  }
}

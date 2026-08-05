// DC-003-I027 — structured errors for the Instagram Carousel Publisher
// Adapter. Mirrors google-drive-publisher-adapter.mjs's own discipline
// exactly: every message here is written on the assumption it may be
// shown to an external caller — none of them ever interpolate a raw
// access token, a raw HTTP response body, a caption, or a stack trace.

export class InstagramConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InstagramConfigurationError";
  }
}

/** Instagram rejected the credentials — HTTP 401/403. Never retryable. */
export class InstagramAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InstagramAuthenticationError";
  }
}

/** A network-level failure, or a 5xx response — transient by nature. */
export class InstagramTransportError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "InstagramTransportError";
  }
}

export class InstagramTimeoutError extends Error {
  constructor(message, timeoutMs) {
    super(message);
    this.name = "InstagramTimeoutError";
    this.timeoutMs = timeoutMs ?? null;
  }
}

/**
 * Instagram rejected the request itself (HTTP 4xx other than 401/403/429)
 * — deterministic, never retried. Carries a `diagnostic` object
 * ({ status, errorType, message }) built the same safe way
 * llm-error-diagnostics.mjs (I019.1) / google-drive-publisher-adapter.mjs
 * (I022) already established — never the raw response body, headers, or
 * access token, and never the caption/alt text supplied in the request.
 */
export class InstagramClientError extends Error {
  constructor(message, diagnostic = null) {
    super(message);
    this.name = "InstagramClientError";
    this.diagnostic = diagnostic;
  }
}

export class InstagramRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "InstagramRateLimitError";
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

/**
 * One of the six carousel-item child container creations failed. Names
 * which slide (already a public identifier, e.g. "cover"/"content"),
 * never the image URL or any request detail.
 */
export class InstagramContainerError extends Error {
  constructor(slideType, reason, cause) {
    super(`Failed to create the Instagram carousel item container for the "${slideType}" slide — ${reason}`, { cause });
    this.name = "InstagramContainerError";
    this.slideType = slideType;
  }
}

/** The final media_publish call failed after all containers were created. */
export class InstagramPublishError extends Error {
  constructor(reason, cause) {
    super(`Failed to publish the Instagram carousel — ${reason}`, { cause });
    this.name = "InstagramPublishError";
  }
}

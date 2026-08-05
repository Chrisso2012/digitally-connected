// DC-003-I027 — structured errors for the LinkedIn Multi-Image Publisher
// Adapter. Mirrors google-drive-publisher-adapter.mjs's own discipline
// exactly: every message here is written on the assumption it may be
// shown to an external caller — none of them ever interpolate a raw
// access token, upload URL, raw HTTP response body, commentary, or a
// stack trace.

export class LinkedInConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LinkedInConfigurationError";
  }
}

/** LinkedIn rejected the credentials — HTTP 401/403. Never retryable. */
export class LinkedInAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LinkedInAuthenticationError";
  }
}

/** A network-level failure, or a 5xx response — transient by nature. */
export class LinkedInTransportError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "LinkedInTransportError";
  }
}

export class LinkedInTimeoutError extends Error {
  constructor(message, timeoutMs) {
    super(message);
    this.name = "LinkedInTimeoutError";
    this.timeoutMs = timeoutMs ?? null;
  }
}

/**
 * LinkedIn rejected the request itself (HTTP 4xx other than 401/403/429)
 * — deterministic, never retried. Carries a `diagnostic` object
 * ({ status, message }) built the same safe way this codebase's other
 * platform adapters already establish — never the raw response body,
 * headers, access token, or commentary.
 */
export class LinkedInClientError extends Error {
  constructor(message, diagnostic = null) {
    super(message);
    this.name = "LinkedInClientError";
    this.diagnostic = diagnostic;
  }
}

export class LinkedInRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "LinkedInRateLimitError";
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

/**
 * One of the six image uploads (initialize or binary PUT) failed. Names
 * which slide (an already-public identifier), never the upload URL or
 * image bytes. Uploads stop immediately — no later image is attempted,
 * and no post is created.
 */
export class LinkedInImageUploadError extends Error {
  constructor(slideType, reason, cause) {
    super(`Failed to upload the LinkedIn image for the "${slideType}" slide — ${reason}`, { cause });
    this.name = "LinkedInImageUploadError";
    this.slideType = slideType;
  }
}

/** The final multi-image post creation failed after all six images uploaded. */
export class LinkedInPostCreationError extends Error {
  constructor(reason, cause) {
    super(`Failed to create the LinkedIn multi-image post — ${reason}`, { cause });
    this.name = "LinkedInPostCreationError";
  }
}

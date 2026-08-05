// DC-003-I028 — structured errors for the Instagram Insights Adapter.
// Mirrors instagram-publisher-errors.mjs's (I027) own discipline exactly:
// every message here is written on the assumption it may be shown to an
// external caller — none of them ever interpolate a raw access token, a
// raw HTTP response body, or a stack trace.

export class InstagramAnalyticsConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InstagramAnalyticsConfigurationError";
  }
}

/** Instagram rejected the credentials — HTTP 401/403. Never retryable. */
export class InstagramAnalyticsAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InstagramAnalyticsAuthenticationError";
  }
}

/** A network-level failure, or a 5xx response — transient by nature. */
export class InstagramAnalyticsTransportError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "InstagramAnalyticsTransportError";
  }
}

export class InstagramAnalyticsTimeoutError extends Error {
  constructor(message, timeoutMs) {
    super(message);
    this.name = "InstagramAnalyticsTimeoutError";
    this.timeoutMs = timeoutMs ?? null;
  }
}

/**
 * Instagram rejected the request itself (HTTP 4xx other than 401/403/429)
 * — deterministic, never retried. Carries a `diagnostic` object
 * ({ status, errorType, message }), never the raw response body, headers,
 * or access token.
 */
export class InstagramAnalyticsClientError extends Error {
  constructor(message, diagnostic = null) {
    super(message);
    this.name = "InstagramAnalyticsClientError";
    this.diagnostic = diagnostic;
  }
}

export class InstagramAnalyticsRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "InstagramAnalyticsRateLimitError";
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

/** The insights request itself failed for a reason not covered above. */
export class InstagramInsightsRequestError extends Error {
  constructor(reason, cause) {
    super(`Failed to retrieve Instagram media insights — ${reason}`, { cause });
    this.name = "InstagramInsightsRequestError";
  }
}

/**
 * The Instagram Insights response could not be parsed into the expected
 * `{ data: [ { name, values/total_value }, ... ] }` shape — a malformed
 * provider response, never silently treated as "no metrics available".
 */
export class InstagramInsightsMalformedResponseError extends Error {
  constructor(reason) {
    super(`Instagram Insights response is malformed — ${reason}`);
    this.name = "InstagramInsightsMalformedResponseError";
  }
}

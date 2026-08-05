// DC-003-I028 — structured errors for the LinkedIn Post Analytics Adapter.
// Mirrors linkedin-publisher-errors.mjs's (I027) own discipline exactly —
// never a raw access token, raw HTTP response body, or stack trace.

export class LinkedInAnalyticsConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LinkedInAnalyticsConfigurationError";
  }
}

/**
 * The post's author was classified as "member" (a personal-profile URN)
 * but LINKEDIN_MEMBER_POST_ANALYTICS_ENABLED is not set. Member post
 * analytics require LinkedIn's own distinct, partner-gated
 * `r_member_postAnalytics` permission (Community Management API) — see
 * linkedin-analytics-config.mjs's own header comment. Fails BEFORE any
 * request, naming the exact required permission/configuration class —
 * never a token or credential value.
 */
export class LinkedInMemberAnalyticsNotEnabledError extends Error {
  constructor() {
    super(
      "Member (personal-profile) LinkedIn post analytics require the r_member_postAnalytics permission " +
        "(LinkedIn Community Management API — a separate, partner-gated permission from ordinary posting access) " +
        "and an explicit LINKEDIN_MEMBER_POST_ANALYTICS_ENABLED=true opt-in confirming it has been granted"
    );
    this.name = "LinkedInMemberAnalyticsNotEnabledError";
  }
}

/** LinkedIn rejected the credentials — HTTP 401/403. Never retryable. */
export class LinkedInAnalyticsAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LinkedInAnalyticsAuthenticationError";
  }
}

/** A network-level failure, or a 5xx response — transient by nature. */
export class LinkedInAnalyticsTransportError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "LinkedInAnalyticsTransportError";
  }
}

export class LinkedInAnalyticsTimeoutError extends Error {
  constructor(message, timeoutMs) {
    super(message);
    this.name = "LinkedInAnalyticsTimeoutError";
    this.timeoutMs = timeoutMs ?? null;
  }
}

/**
 * LinkedIn rejected the request itself (HTTP 4xx other than 401/403/429)
 * — deterministic, never retried. Carries a `diagnostic` object
 * ({ status, message }), never the raw response body or access token.
 */
export class LinkedInAnalyticsClientError extends Error {
  constructor(message, diagnostic = null) {
    super(message);
    this.name = "LinkedInAnalyticsClientError";
    this.diagnostic = diagnostic;
  }
}

export class LinkedInAnalyticsRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "LinkedInAnalyticsRateLimitError";
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

/** The share-statistics request itself failed for a reason not covered above. */
export class LinkedInAnalyticsRequestError extends Error {
  constructor(reason, cause) {
    super(`Failed to retrieve LinkedIn post analytics — ${reason}`, { cause });
    this.name = "LinkedInAnalyticsRequestError";
  }
}

/**
 * The LinkedIn organizationalEntityShareStatistics response could not be
 * parsed into the expected `{ elements: [ { totalShareStatistics, ... } ] }`
 * shape — a malformed provider response, never silently treated as "no
 * metrics available".
 */
export class LinkedInAnalyticsMalformedResponseError extends Error {
  constructor(reason) {
    super(`LinkedIn post analytics response is malformed — ${reason}`);
    this.name = "LinkedInAnalyticsMalformedResponseError";
  }
}

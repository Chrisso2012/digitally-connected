// DC-003-I028 — structured errors for the Social Analytics Collection
// Service. Mirrors this codebase's established discipline throughout:
// every message here is written on the assumption it may be shown to an
// external caller — never a raw access token, raw provider response body,
// or stack trace.

/**
 * The Publisher Result's own `provider` is not a currently-supported
 * social analytics platform ("instagram" | "linkedin") — most notably,
 * rejects a Google Drive Publisher Result outright (brief's own explicit
 * "do not accept Google Drive Publisher Results as social posts" rule).
 * No request is ever made.
 */
export class UnsupportedAnalyticsProviderError extends Error {
  constructor(publisherResultId, provider) {
    super(`Publisher Result "${publisherResultId}" has provider "${provider}", which is not a supported social analytics platform (instagram | linkedin)`);
    this.name = "UnsupportedAnalyticsProviderError";
    this.publisherResultId = publisherResultId;
    this.provider = provider;
  }
}

/**
 * The Publisher Result has no usable `provider_reference` — analytics
 * collection never infers a post reference from a URL or any other
 * heuristic (brief's own explicit rule). No request is ever made.
 */
export class MissingProviderPostReferenceError extends Error {
  constructor(publisherResultId) {
    super(`Publisher Result "${publisherResultId}" has no usable provider_reference — analytics collection requires a canonical platform post/media reference, never inferred`);
    this.name = "MissingProviderPostReferenceError";
    this.publisherResultId = publisherResultId;
  }
}

/**
 * The Publisher Result's own `status` is not "completed" — defensive
 * check; publisher-result.schema.json's own `const: "completed"` already
 * guarantees this in practice, but this service never assumes a
 * caller-loaded record satisfies its own schema.
 */
export class IneligiblePublisherResultForAnalyticsError extends Error {
  constructor(publisherResultId, reason) {
    super(`Publisher Result "${publisherResultId}" is not eligible for analytics collection — ${reason}`);
    this.name = "IneligiblePublisherResultForAnalyticsError";
    this.publisherResultId = publisherResultId;
  }
}

/**
 * The selected platform adapter's own collectAnalytics() call failed. The
 * underlying cause (which may contain a raw API response, headers, or
 * credential) is attached as `.cause` for local debugging only, never
 * included in `.message`. No snapshot is persisted when this is thrown.
 */
export class SocialAnalyticsCollectionFailedError extends Error {
  constructor(provider, publisherResultId, reason, cause) {
    super(`Collecting analytics for Publisher Result "${publisherResultId}" (provider "${provider}") failed — ${reason}`, { cause });
    this.name = "SocialAnalyticsCollectionFailedError";
    this.provider = provider;
    this.publisherResultId = publisherResultId;
  }
}

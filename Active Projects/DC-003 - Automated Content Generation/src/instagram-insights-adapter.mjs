// DC-003-I028 — Instagram Insights Adapter: the one social-analytics-adapter.mjs
// implementation this milestone ships for Instagram. Retrieves post-level
// insights for an already-published Instagram carousel (I027) via Meta's
// documented Instagram Platform Insights API
// (https://developers.facebook.com/docs/instagram-platform/insights/ and
// .../reference/instagram-media/insights). Like every other HTTP
// integration in this codebase before its own first live call
// (instagram-carousel-publisher-adapter.mjs among them), this has NOT been
// exercised against a real request as of this milestone's delivery. No
// live Instagram request is authorised during implementation.
//
// Repository + official-API investigation findings (see README "Instagram
// Insights Adapter"):
//  - The published carousel's own media_id (I027's `provider_reference`,
//    captured from the `media_publish` response) is the ONLY id ever
//    queried — GET /<media-id>/insights. Individual carousel-child media
//    do not carry their own insights (Meta's own docs: "insights data is
//    not available for any media within an Instagram Media album" — read
//    as referring to the children, not the album/carousel post itself,
//    whose media_product_type is FEED like any other feed post).
//  - Metrics requested: reach, likes, comments, saved, shares — all
//    documented FEED-product-type metrics. `impressions` is EXCLUDED
//    (Meta: deprecated for any media created after 2024-07-02, which is
//    every media this codebase could ever publish) and `views` is
//    EXCLUDED (video-only, not applicable to a static-image carousel) —
//    both are reported as `not-supported` WITHOUT ever being requested,
//    a client-side classification made before any request per this
//    milestone's own schema vocabulary.
//  - Meta's own documented "unavailable" signal: "If insights data you are
//    requesting does not exist or is currently unavailable, the API
//    returns an empty data set instead of 0 for individual metrics" — a
//    requested metric name simply absent from the response `data` array
//    is normalized to `availability: "unavailable"`, never a 0.
//  - Permission: `instagram_manage_insights` (Facebook Login, matching
//    this codebase's own `graph.facebook.com` base URL / I027's own
//    Facebook Login flow) — a DIFFERENT permission from the
//    `instagram_content_publish` scope I027's own publishing already
//    required; provisioning it on the existing app/token is an operator
//    concern, not something this adapter can detect ahead of a real call.

import {
  InstagramAnalyticsConfigurationError,
  InstagramAnalyticsAuthenticationError,
  InstagramAnalyticsTransportError,
  InstagramAnalyticsTimeoutError,
  InstagramAnalyticsClientError,
  InstagramAnalyticsRateLimitError,
  InstagramInsightsRequestError,
  InstagramInsightsMalformedResponseError,
} from "./instagram-analytics-errors.mjs";

const MAX_MESSAGE_LENGTH = 300;
const SECRET_LIKE_PATTERN = /EA[A-Za-z0-9]{20,}|[A-Za-z0-9_-]{40,}/g;
// FEED-product-type metrics documented as applicable to a carousel post —
// see this file's own header comment for why impressions/views are
// excluded from this list entirely.
const REQUESTED_METRICS = ["reach", "likes", "comments", "saved", "shares"];

function redact(text) {
  return text.replace(SECRET_LIKE_PATTERN, "[REDACTED]");
}

function sanitizeMessage(message) {
  if (typeof message !== "string" || message.trim() === "") return null;
  const redacted = redact(message);
  return redacted.length > MAX_MESSAGE_LENGTH ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…` : redacted;
}

function buildSafeDiagnostic(response, bodyText) {
  const status = response.status;
  const minimal = { status, errorType: null, message: null };

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json") || typeof bodyText !== "string" || bodyText.trim() === "") {
    return minimal;
  }
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return minimal;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return minimal;
  const errorField = parsed.error;
  if (errorField === null || typeof errorField !== "object" || Array.isArray(errorField)) return minimal;

  return {
    status,
    errorType: typeof errorField.type === "string" ? errorField.type : null,
    message: sanitizeMessage(errorField.message),
  };
}

async function readErrorBodyText(response) {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

async function sendRequest(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { method: "GET", signal: controller.signal });
  } catch (cause) {
    if (cause.name === "AbortError") {
      throw new InstagramAnalyticsTimeoutError(`Instagram Insights request timed out after ${timeoutMs}ms`, timeoutMs);
    }
    throw new InstagramAnalyticsTransportError(`Instagram Insights request failed: ${cause.message}`, cause);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new InstagramAnalyticsAuthenticationError(`Instagram rejected the credentials (HTTP ${response.status})`);
  }
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    throw new InstagramAnalyticsRateLimitError(
      "Instagram reported a rate limit (HTTP 429)",
      retryAfterHeader ? Number(retryAfterHeader) * 1000 : null
    );
  }
  if (response.status >= 500) {
    throw new InstagramAnalyticsTransportError(`Instagram returned a server error (HTTP ${response.status})`, null);
  }
  if (!response.ok) {
    const bodyText = await readErrorBodyText(response);
    const diagnostic = buildSafeDiagnostic(response, bodyText);
    throw new InstagramAnalyticsClientError(`Instagram rejected the insights request (HTTP ${response.status})`, diagnostic);
  }

  return response;
}

// Extracts a single metric's numeric value from its own documented `data[]`
// entry — a metric named but absent from `values`/`total_value` entirely
// is a malformed response (distinct from the metric being absent from the
// whole `data` array, which is Meta's own documented "unavailable" signal
// and is handled by the caller, not here).
function extractMetricValue(entry) {
  const fromValues = Array.isArray(entry.values) && entry.values.length > 0 ? entry.values[0]?.value : undefined;
  const value = fromValues !== undefined ? fromValues : entry.total_value?.value;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new InstagramInsightsMalformedResponseError(`metric "${entry.name}" was present but had no valid non-negative numeric value`);
  }
  return value;
}

function normalizeMetrics(responseBody) {
  if (!responseBody || !Array.isArray(responseBody.data)) {
    throw new InstagramInsightsMalformedResponseError('expected a top-level "data" array');
  }

  const byName = new Map();
  for (const entry of responseBody.data) {
    if (!entry || typeof entry.name !== "string") {
      throw new InstagramInsightsMalformedResponseError('each "data" entry must have a string "name"');
    }
    byName.set(entry.name, entry);
  }

  const metricValues = {};
  for (const metricName of REQUESTED_METRICS) {
    const entry = byName.get(metricName);
    metricValues[metricName] = entry ? { value: extractMetricValue(entry), availability: "available" } : { value: null, availability: "unavailable" };
  }
  return metricValues;
}

/**
 * Builds the Instagram Insights Adapter.
 *
 * config — required, the return value of loadInstagramAnalyticsConfig().
 *   Missing accessToken/userId throws InstagramAnalyticsConfigurationError
 *   at the first collectAnalytics() call.
 *
 * Returns { name, provider, collectAnalytics({ publisherResult, collectedAt }) }.
 */
export function createInstagramInsightsAdapter(config) {
  return {
    name: "instagram-insights-adapter",
    provider: "instagram",

    /**
     * Retrieves insights for `publisherResult.provider_reference` (the
     * published carousel's own media id). Returns
     * { metrics, engagement, sourceApiVersion, sourceType: "provider-api" }
     * — see social-analytics-adapter.mjs's own contract for the exact
     * shape. Throws InstagramAnalyticsConfigurationError if required
     * config is missing. Throws InstagramInsightsRequestError /
     * InstagramInsightsMalformedResponseError / any Instagram*Error
     * transport error on failure — no snapshot is ever built from a
     * failed or malformed call.
     */
    async collectAnalytics({ publisherResult }) {
      if (typeof config.accessToken !== "string" || config.accessToken.trim() === "") {
        throw new InstagramAnalyticsConfigurationError("Instagram analytics collection requires INSTAGRAM_ACCESS_TOKEN");
      }

      const mediaId = publisherResult.provider_reference;
      const query = new URLSearchParams({ metric: REQUESTED_METRICS.join(","), access_token: config.accessToken });
      const url = `${config.apiBaseUrl}/${config.apiVersion}/${mediaId}/insights?${query.toString()}`;

      let response;
      try {
        response = await sendRequest(url, config.requestTimeoutMs);
      } catch (cause) {
        if (
          cause.name === "InstagramAnalyticsAuthenticationError" ||
          cause.name === "InstagramAnalyticsRateLimitError" ||
          cause.name === "InstagramAnalyticsClientError" ||
          cause.name === "InstagramAnalyticsTimeoutError" ||
          cause.name === "InstagramAnalyticsTransportError"
        ) {
          throw cause;
        }
        throw new InstagramInsightsRequestError(cause.message ?? "request failed", cause);
      }

      const body = await response.json();
      const metricValues = normalizeMetrics(body);

      return {
        metrics: {
          reach: metricValues.reach,
          // Deprecated (impressions) / not applicable to a static-image
          // carousel (views, video-only) — classified without a request.
          views: { value: null, availability: "not-supported" },
        },
        engagement: {
          reactions: metricValues.likes,
          comments: metricValues.comments,
          shares: metricValues.shares,
          saves: metricValues.saved,
        },
        sourceApiVersion: config.apiVersion,
        sourceType: "provider-api",
      };
    },
  };
}

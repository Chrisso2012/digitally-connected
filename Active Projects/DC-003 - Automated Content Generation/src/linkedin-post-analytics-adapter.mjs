// DC-003-I028 — LinkedIn Post Analytics Adapter: the one
// social-analytics-adapter.mjs implementation this milestone ships for
// LinkedIn. Retrieves post-level analytics for an already-published
// LinkedIn post (I027), using a DIFFERENT documented endpoint depending on
// whether the post's author is a member (personal profile) or an
// organization — never guessed, always classified via the author URN
// itself (reuses classifyAuthorUrn() from linkedin-publisher-config.mjs
// verbatim — no second classifier was invented). Like every other HTTP
// integration in this codebase before its own first live call, this has
// NOT been exercised against a real request as of this milestone's
// delivery. No live LinkedIn request is authorised during implementation.
//
// Repository + official-API investigation findings (see README "LinkedIn
// Post Analytics Adapter" for the full account):
//
//  ORGANIZATION posts — Organization Share Statistics API
//  (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics),
//  permission `rw_organization_admin` (the standard, generally-available
//  Marketing API tier). ONE request retrieves everything:
//  GET /rest/organizationalEntityShareStatistics?q=organizationalEntity
//  &organizationalEntity={destination}&shares=List({postUrn}) (or
//  &ugcPosts=List({postUrn}) if the reference is a ugcPost URN). Returns
//  clickCount/commentCount/engagement/impressionCount/likeCount/shareCount/
//  uniqueImpressionsCount. LinkedIn's own docs explicitly state: "Shares
//  with no actions or impressions are not included... can be assumed to
//  have counts of 0" — an EMPTY `elements` array for the org path is
//  therefore a legitimate, documented zero, not "unavailable" (the
//  opposite convention from Instagram's own "empty means unavailable"
//  rule — each platform's own documented behavior is honored, not
//  homogenized).
//
//  MEMBER posts — Member Post Analytics API
//  (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics),
//  permission `r_member_postAnalytics` — a DISTINCT, partner-gated
//  permission under LinkedIn's Community Management API requiring its own
//  separate application/approval, materially different from
//  `rw_organization_admin`. This path is gated behind an explicit
//  LINKEDIN_MEMBER_POST_ANALYTICS_ENABLED opt-in (see
//  linkedin-analytics-config.mjs) and fails BEFORE any request if unset.
//  Structurally different and MUCH more expensive: `queryType` accepts
//  exactly ONE metric per request (no comma-list like the org endpoint or
//  Instagram) — five separate GET requests are required for the five
//  metrics common to every documented API version (IMPRESSION,
//  MEMBERS_REACHED, RESHARE, REACTION, COMMENT), each
//  q=entity&entity=(share:{urn})|(ugc:{urn})&aggregation=TOTAL. Newer API
//  versions (2026-04+) add POST_SAVE/POST_SEND/LINK_CLICKS/etc., but this
//  adapter deliberately requests only the five metrics documented as
//  present across EVERY listed API version (li-lms-2025-08 through
//  2026-07) to stay correct regardless of which LINKEDIN_API_VERSION an
//  operator configures — `saves` is reported `not-supported` on the
//  member path for this reason (see README for the exact trade-off). No
//  explicit "empty response means zero" statement exists in LinkedIn's own
//  docs for this endpoint (unlike the organization path) — an empty
//  `elements` array here is conservatively treated as "unavailable", never
//  assumed to be zero.

import { classifyAuthorUrn } from "./linkedin-publisher-config.mjs";
import {
  LinkedInAnalyticsConfigurationError,
  LinkedInMemberAnalyticsNotEnabledError,
  LinkedInAnalyticsAuthenticationError,
  LinkedInAnalyticsTransportError,
  LinkedInAnalyticsTimeoutError,
  LinkedInAnalyticsClientError,
  LinkedInAnalyticsRateLimitError,
  LinkedInAnalyticsRequestError,
  LinkedInAnalyticsMalformedResponseError,
} from "./linkedin-analytics-errors.mjs";

const MEMBER_QUERY_TYPES = ["IMPRESSION", "MEMBERS_REACHED", "RESHARE", "REACTION", "COMMENT"];

function linkedInHeaders(config) {
  return {
    authorization: `Bearer ${config.accessToken}`,
    "linkedin-version": config.apiVersion,
    "x-restli-protocol-version": "2.0.0",
  };
}

async function sendRequest(url, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let response;
  try {
    response = await fetch(url, { method: "GET", headers: linkedInHeaders(config), signal: controller.signal });
  } catch (cause) {
    if (cause.name === "AbortError") {
      throw new LinkedInAnalyticsTimeoutError(`LinkedIn analytics request timed out after ${config.requestTimeoutMs}ms`, config.requestTimeoutMs);
    }
    throw new LinkedInAnalyticsTransportError(`LinkedIn analytics request failed: ${cause.message}`, cause);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new LinkedInAnalyticsAuthenticationError(`LinkedIn rejected the credentials (HTTP ${response.status})`);
  }
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    throw new LinkedInAnalyticsRateLimitError("LinkedIn reported a rate limit (HTTP 429)", retryAfterHeader ? Number(retryAfterHeader) * 1000 : null);
  }
  if (response.status >= 500) {
    throw new LinkedInAnalyticsTransportError(`LinkedIn returned a server error (HTTP ${response.status})`, null);
  }
  if (!response.ok) {
    let bodyText = null;
    try {
      bodyText = await response.text();
    } catch {
      // leave null
    }
    let message = null;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json") && bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        if (typeof parsed?.message === "string") message = parsed.message.slice(0, 300);
      } catch {
        // leave null
      }
    }
    throw new LinkedInAnalyticsClientError(`LinkedIn rejected the analytics request (HTTP ${response.status})`, { status: response.status, message });
  }

  return response;
}

function metricValueFrom(numberOrUndefined) {
  if (typeof numberOrUndefined !== "number" || !Number.isFinite(numberOrUndefined) || numberOrUndefined < 0) {
    return null;
  }
  return { value: numberOrUndefined, availability: "available" };
}

// --- Organization path ---------------------------------------------------

function buildShareStatisticsUrl(config, destination, providerPostReference) {
  const params = new URLSearchParams({ q: "organizationalEntity", organizationalEntity: destination });
  let url = `${config.apiBaseUrl}/rest/organizationalEntityShareStatistics?${params.toString()}`;
  if (providerPostReference.startsWith("urn:li:share:")) {
    url += `&shares=List(${encodeURIComponent(providerPostReference)})`;
  } else if (providerPostReference.startsWith("urn:li:ugcPost:")) {
    url += `&ugcPosts=List(${encodeURIComponent(providerPostReference)})`;
  } else {
    throw new LinkedInAnalyticsRequestError(
      `provider_reference "${providerPostReference}" is not a recognized urn:li:share:... or urn:li:ugcPost:... URN`
    );
  }
  return url;
}

async function collectOrganizationAnalytics(config, destination, providerPostReference) {
  const url = buildShareStatisticsUrl(config, destination, providerPostReference);

  let response;
  try {
    response = await sendRequest(url, config);
  } catch (cause) {
    if (
      cause.name === "LinkedInAnalyticsAuthenticationError" ||
      cause.name === "LinkedInAnalyticsRateLimitError" ||
      cause.name === "LinkedInAnalyticsClientError" ||
      cause.name === "LinkedInAnalyticsTimeoutError" ||
      cause.name === "LinkedInAnalyticsTransportError"
    ) {
      throw cause;
    }
    throw new LinkedInAnalyticsRequestError(cause.message ?? "request failed", cause);
  }

  const body = await response.json();
  if (!body || !Array.isArray(body.elements)) {
    throw new LinkedInAnalyticsMalformedResponseError('expected a top-level "elements" array');
  }

  // LinkedIn's own documented convention for this endpoint: a share with
  // no actions/impressions is simply absent from `elements` — a
  // legitimate, documented zero, never "unavailable".
  const zero = { value: 0, availability: "available" };
  if (body.elements.length === 0) {
    return {
      metrics: { impressions: zero, unique_impressions: zero, clicks: zero },
      engagement: { reactions: zero, comments: zero, shares: zero, saves: { value: null, availability: "not-supported" } },
    };
  }

  const stats = body.elements[0]?.totalShareStatistics;
  if (!stats || typeof stats !== "object") {
    throw new LinkedInAnalyticsMalformedResponseError('expected elements[0].totalShareStatistics to be an object');
  }

  const impressions = metricValueFrom(stats.impressionCount);
  const uniqueImpressions = metricValueFrom(stats.uniqueImpressionsCount);
  const clicks = metricValueFrom(stats.clickCount);
  const likes = metricValueFrom(stats.likeCount);
  const comments = metricValueFrom(stats.commentCount);
  const shares = metricValueFrom(stats.shareCount);

  if (!impressions || !likes || !comments || !shares) {
    throw new LinkedInAnalyticsMalformedResponseError("totalShareStatistics is missing one or more required numeric fields");
  }

  return {
    metrics: {
      impressions,
      unique_impressions: uniqueImpressions ?? { value: null, availability: "not-returned" },
      clicks: clicks ?? { value: null, availability: "not-returned" },
    },
    engagement: { reactions: likes, comments, shares, saves: { value: null, availability: "not-supported" } },
  };
}

// --- Member path ----------------------------------------------------------

function buildEntityParam(providerPostReference) {
  if (providerPostReference.startsWith("urn:li:share:")) {
    return `(share:${encodeURIComponent(providerPostReference)})`;
  }
  if (providerPostReference.startsWith("urn:li:ugcPost:")) {
    return `(ugc:${encodeURIComponent(providerPostReference)})`;
  }
  throw new LinkedInAnalyticsRequestError(
    `provider_reference "${providerPostReference}" is not a recognized urn:li:share:... or urn:li:ugcPost:... URN`
  );
}

function extractMetricType(entry) {
  if (typeof entry.metricType === "string") return entry.metricType;
  if (entry.metricType && typeof entry.metricType === "object") {
    const values = Object.values(entry.metricType);
    if (values.length === 1 && typeof values[0] === "string") return values[0];
  }
  return null;
}

async function fetchOneMemberMetric(config, entityParam, queryType) {
  const url = `${config.apiBaseUrl}/rest/memberCreatorPostAnalytics?q=entity&entity=${entityParam}&queryType=${queryType}&aggregation=TOTAL`;

  let response;
  try {
    response = await sendRequest(url, config);
  } catch (cause) {
    if (
      cause.name === "LinkedInAnalyticsAuthenticationError" ||
      cause.name === "LinkedInAnalyticsRateLimitError" ||
      cause.name === "LinkedInAnalyticsClientError" ||
      cause.name === "LinkedInAnalyticsTimeoutError" ||
      cause.name === "LinkedInAnalyticsTransportError"
    ) {
      throw cause;
    }
    throw new LinkedInAnalyticsRequestError(cause.message ?? "request failed", cause);
  }

  const body = await response.json();
  if (!body || !Array.isArray(body.elements)) {
    throw new LinkedInAnalyticsMalformedResponseError('expected a top-level "elements" array');
  }
  // No documented "empty means zero" convention for this endpoint (unlike
  // the organization path) — conservatively "unavailable", never assumed
  // to be zero.
  if (body.elements.length === 0) {
    return { value: null, availability: "unavailable" };
  }

  const entry = body.elements[0];
  const metricType = extractMetricType(entry);
  if (metricType !== queryType) {
    throw new LinkedInAnalyticsMalformedResponseError(`expected metricType "${queryType}", got ${JSON.stringify(metricType)}`);
  }
  const value = metricValueFrom(entry.count);
  if (!value) {
    throw new LinkedInAnalyticsMalformedResponseError(`metricType "${queryType}" had no valid non-negative "count"`);
  }
  return value;
}

async function collectMemberAnalytics(config, providerPostReference) {
  if (!config.memberPostAnalyticsEnabled) {
    throw new LinkedInMemberAnalyticsNotEnabledError();
  }
  const entityParam = buildEntityParam(providerPostReference);

  const results = {};
  for (const queryType of MEMBER_QUERY_TYPES) {
    // eslint-disable-next-line no-await-in-loop -- this endpoint accepts
    // exactly one metric per request; five sequential requests are the
    // documented cost of member-post analytics (see this file's own
    // header comment for the full request-budget accounting).
    results[queryType] = await fetchOneMemberMetric(config, entityParam, queryType);
  }

  return {
    metrics: { impressions: results.IMPRESSION, members_reached: results.MEMBERS_REACHED },
    engagement: {
      reactions: results.REACTION,
      comments: results.COMMENT,
      shares: results.RESHARE,
      saves: { value: null, availability: "not-supported" },
    },
  };
}

/**
 * Builds the LinkedIn Post Analytics Adapter.
 *
 * config — required, the return value of loadLinkedInAnalyticsConfig().
 *
 * Returns { name, provider, collectAnalytics({ publisherResult, collectedAt }) }.
 */
export function createLinkedInPostAnalyticsAdapter(config) {
  return {
    name: "linkedin-post-analytics-adapter",
    provider: "linkedin",

    /**
     * Retrieves analytics for `publisherResult.provider_reference`, using
     * the organization or member endpoint depending on
     * classifyAuthorUrn(publisherResult.destination). Throws
     * LinkedInAnalyticsConfigurationError for missing/unrecognized
     * config. Throws LinkedInMemberAnalyticsNotEnabledError before any
     * request if the author is a member and the explicit opt-in is not
     * set. Never silently switches between member and organization
     * analytics — the classification comes only from the author URN
     * itself.
     */
    async collectAnalytics({ publisherResult }) {
      if (typeof config.accessToken !== "string" || config.accessToken.trim() === "") {
        throw new LinkedInAnalyticsConfigurationError("LinkedIn analytics collection requires LINKEDIN_ACCESS_TOKEN");
      }
      if (typeof config.apiVersion !== "string" || config.apiVersion.trim() === "") {
        throw new LinkedInAnalyticsConfigurationError("LinkedIn analytics collection requires LINKEDIN_API_VERSION (LinkedIn's own dated version header value)");
      }

      const authorType = classifyAuthorUrn(publisherResult.destination);
      if (authorType === null) {
        throw new LinkedInAnalyticsConfigurationError(
          `Publisher Result destination "${publisherResult.destination}" is not a recognized urn:li:person:... or urn:li:organization:... URN`
        );
      }

      const { metrics, engagement } =
        authorType === "organization"
          ? await collectOrganizationAnalytics(config, publisherResult.destination, publisherResult.provider_reference)
          : await collectMemberAnalytics(config, publisherResult.provider_reference);

      return { metrics, engagement, sourceApiVersion: config.apiVersion, sourceType: "provider-api" };
    },
  };
}

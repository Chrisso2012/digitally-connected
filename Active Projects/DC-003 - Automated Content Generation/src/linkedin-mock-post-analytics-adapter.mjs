// DC-003-I028 — mock LinkedIn Post Analytics Adapter. The ONLY LinkedIn
// analytics adapter automated tests and the CLI's own default
// (non---live) mode use — no network dependency, fully deterministic.
// Returns a generic shape independent of the destination's actual
// member/organization classification (the real adapter's own
// classifyAuthorUrn() branch is exercised separately, against the real
// linkedin-post-analytics-adapter.mjs, not this mock).

import { LinkedInAnalyticsClientError, LinkedInAnalyticsMalformedResponseError } from "./linkedin-analytics-errors.mjs";

const available = (value) => ({ value, availability: "available" });
const UNAVAILABLE = { value: null, availability: "unavailable" };
const NOT_RETURNED = { value: null, availability: "not-returned" };
const NOT_SUPPORTED = { value: null, availability: "not-supported" };

/**
 * options.mode — "completed" (default) | "zero-engagement" |
 *   "unavailable-metrics" | "delayed" | "failure" | "malformed"
 * options.impressions / reactions / comments / shares — override the
 *   "completed"/"delayed" scenario's numeric values (used by tests).
 */
export function createMockLinkedInPostAnalyticsAdapter(options = {}) {
  let calls = 0;
  const mode = options.mode ?? "completed";

  return {
    name: "mock-linkedin-post-analytics-adapter",
    provider: "linkedin",
    callCount: () => calls,

    async collectAnalytics() {
      calls += 1;

      if (mode === "failure") {
        throw new LinkedInAnalyticsClientError("LinkedIn rejected the analytics request (HTTP 400) [mock]", { status: 400, message: "simulated failure" });
      }
      if (mode === "malformed") {
        throw new LinkedInAnalyticsMalformedResponseError("simulated malformed response [mock]");
      }
      if (mode === "zero-engagement") {
        return {
          metrics: { impressions: available(0) },
          engagement: { reactions: available(0), comments: available(0), shares: available(0), saves: NOT_SUPPORTED },
          sourceApiVersion: "202601",
          sourceType: "mock",
        };
      }
      if (mode === "unavailable-metrics") {
        return {
          metrics: { impressions: UNAVAILABLE },
          engagement: { reactions: UNAVAILABLE, comments: UNAVAILABLE, shares: UNAVAILABLE, saves: NOT_SUPPORTED },
          sourceApiVersion: "202601",
          sourceType: "mock",
        };
      }
      if (mode === "delayed") {
        return {
          metrics: { impressions: available(options.impressions ?? 3400) },
          engagement: { reactions: available(options.reactions ?? 50), comments: NOT_RETURNED, shares: NOT_RETURNED, saves: NOT_SUPPORTED },
          sourceApiVersion: "202601",
          sourceType: "mock",
        };
      }

      // "completed"
      return {
        metrics: { impressions: available(options.impressions ?? 3400) },
        engagement: {
          reactions: available(options.reactions ?? 60),
          comments: available(options.comments ?? 8),
          shares: available(options.shares ?? 4),
          saves: NOT_SUPPORTED,
        },
        sourceApiVersion: "202601",
        sourceType: "mock",
      };
    },
  };
}

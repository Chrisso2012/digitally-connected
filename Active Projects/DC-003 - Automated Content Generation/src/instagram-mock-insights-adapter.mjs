// DC-003-I028 — mock Instagram Insights Adapter. The ONLY Instagram
// analytics adapter automated tests and the CLI's own default
// (non---live) mode use — no network dependency, fully deterministic.
// Mirrors instagram-mock-publisher-adapter.mjs (I027) exactly: same
// `options.mode` convention. Covers every scenario the brief's own
// "Mock Analytics Adapters" section requires.

import { InstagramAnalyticsClientError } from "./instagram-analytics-errors.mjs";
import { InstagramInsightsMalformedResponseError } from "./instagram-analytics-errors.mjs";

const available = (value) => ({ value, availability: "available" });
const UNAVAILABLE = { value: null, availability: "unavailable" };
const NOT_RETURNED = { value: null, availability: "not-returned" };
const NOT_SUPPORTED = { value: null, availability: "not-supported" };

/**
 * options.mode — "completed" (default) | "zero-engagement" |
 *   "unavailable-metrics" | "delayed" | "failure" | "malformed"
 * options.reach / reactions / comments / shares / saves — override the
 *   "completed"/"delayed" scenario's numeric values (used by tests).
 */
export function createMockInstagramInsightsAdapter(options = {}) {
  let calls = 0;
  const mode = options.mode ?? "completed";

  return {
    name: "mock-instagram-insights-adapter",
    provider: "instagram",
    callCount: () => calls,

    async collectAnalytics() {
      calls += 1;

      if (mode === "failure") {
        throw new InstagramAnalyticsClientError("Instagram rejected the insights request (HTTP 400) [mock]", {
          status: 400,
          errorType: "mock_error",
          message: "simulated failure",
        });
      }
      if (mode === "malformed") {
        throw new InstagramInsightsMalformedResponseError("simulated malformed response [mock]");
      }
      if (mode === "zero-engagement") {
        return {
          metrics: { reach: available(0), views: NOT_SUPPORTED },
          engagement: { reactions: available(0), comments: available(0), shares: available(0), saves: available(0) },
          sourceApiVersion: "v21.0",
          sourceType: "mock",
        };
      }
      if (mode === "unavailable-metrics") {
        return {
          metrics: { reach: UNAVAILABLE, views: NOT_SUPPORTED },
          engagement: { reactions: UNAVAILABLE, comments: UNAVAILABLE, shares: UNAVAILABLE, saves: UNAVAILABLE },
          sourceApiVersion: "v21.0",
          sourceType: "mock",
        };
      }
      if (mode === "delayed") {
        return {
          metrics: { reach: available(options.reach ?? 1200), views: NOT_SUPPORTED },
          engagement: {
            reactions: available(options.reactions ?? 40),
            comments: NOT_RETURNED,
            shares: NOT_RETURNED,
            saves: available(options.saves ?? 5),
          },
          sourceApiVersion: "v21.0",
          sourceType: "mock",
        };
      }

      // "completed"
      return {
        metrics: { reach: available(options.reach ?? 1200), views: NOT_SUPPORTED },
        engagement: {
          reactions: available(options.reactions ?? 85),
          comments: available(options.comments ?? 12),
          shares: available(options.shares ?? 6),
          saves: available(options.saves ?? 20),
        },
        sourceApiVersion: "v21.0",
        sourceType: "mock",
      };
    },
  };
}

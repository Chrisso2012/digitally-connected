// DC-003-I028 — Social Analytics Adapter abstraction.
//
// The domain layer (social-analytics-service.mjs) must know nothing about
// Instagram, LinkedIn, or any other platform's own response shape — only
// this contract. A Social Analytics Adapter is any object shaped:
//
//   { name: string,
//     provider: string,   // "instagram" | "linkedin" — passed through
//                          // verbatim, never re-derived by the service
//     collectAnalytics({ publisherResult, collectedAt }): Promise<{
//       metrics: { <name>: { value, availability } },
//       engagement: { reactions, comments, shares, saves }, // each
//                    // { value, availability } — `total` is NOT supplied
//                    // here; it's calculated by the domain object factory
//       sourceApiVersion: string | null,
//       sourceType: "provider-api" | "mock",
//     }> }
//
// The adapter's own return value must already be fully normalized — no
// Meta-specific or LinkedIn-specific response shape (raw JSON field names,
// header objects, error envelopes) may cross this boundary. This mirrors
// the same "dumb, swappable implementation behind one documented shape"
// pattern this codebase has already established repeatedly — the Storage
// Adapter (I015/I023/I025), the Renderer's Transport (I006), the LLM
// Provider's Transport (I019), the Social Publisher Adapter (I027).
//
// `publisherResult` — an already-loaded, already-eligibility-checked
// Publisher Result record (see social-analytics-service.mjs) — adapters
// read `destination`/`provider_reference` from it to know which account
// and which post/media to query. `collectedAt` — the ISO timestamp the
// service wants recorded on the resulting snapshot (usually "now", but
// injectable for deterministic tests).
//
// See instagram-insights-adapter.mjs / instagram-mock-insights-adapter.mjs
// and linkedin-post-analytics-adapter.mjs / linkedin-mock-post-analytics-adapter.mjs
// for the implementations this milestone ships.

import { InvalidSocialAnalyticsAdapterError } from "./social-analytics-errors.mjs";

/**
 * Throws InvalidSocialAnalyticsAdapterError if `adapter` doesn't implement
 * the Social Analytics Adapter shape. Used by social-analytics-service.mjs
 * so a malformed adapter is caught immediately, not at the first call.
 */
export function assertValidSocialAnalyticsAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.provider !== "string" ||
    typeof adapter.collectAnalytics !== "function"
  ) {
    throw new InvalidSocialAnalyticsAdapterError();
  }
}

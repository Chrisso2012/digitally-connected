// DC-003-I027 — Instagram Publisher configuration, sourced from
// environment variables. Never reads config/*.json — these values include
// a credential and an account identifier, so they belong here, exactly
// matching every other *-config.mjs in this codebase (google-drive-publisher-config.mjs,
// llm-provider-config.mjs, renderer-config.mjs).
//
// Repository investigation finding (see README "Social Publisher
// (DC-003-I027)"): no INSTAGRAM_*/META_*/FACEBOOK_* environment variable
// or n8n credential exists anywhere in this project as of I027 — checked
// directly, not assumed. Publishing to Instagram additionally requires an
// eligible Instagram professional (Business or Creator) account linked to
// a Facebook Page, and a Meta App with the `instagram_content_publish`
// permission — provisioning either is outside this milestone's own scope.
//
// The adapter itself (instagram-carousel-publisher-adapter.mjs) never
// calls this — it only ever receives an already-resolved config object via
// construction. Only a CLI (or whoever constructs the adapter) reads this.

export function loadInstagramPublisherConfig(env = process.env) {
  return {
    accessToken: env.INSTAGRAM_ACCESS_TOKEN || null,
    userId: env.INSTAGRAM_USER_ID || null,
    apiBaseUrl: env.INSTAGRAM_API_BASE_URL || "https://graph.facebook.com",
    apiVersion: env.INSTAGRAM_API_VERSION || "v21.0",
    requestTimeoutMs: Number(env.INSTAGRAM_REQUEST_TIMEOUT_MS) || 15000,
  };
}

// --- Live-verification safety (the same pattern DC-003-I006/I019/I022
// established after their own incidents — proactively applied here from
// day one, before this adapter has ever made a single live call) --------
//
// A --live CLI invocation must default to exactly one attempt per
// request, completely independent of any general-purpose retry
// configuration (none exists for this adapter as of I027 — every request
// this adapter makes is part of an irreversible content-publishing
// sequence, so it never retries automatically at all; this constant exists
// for symmetry with every other live-capable CLI in this codebase and as
// a documented ceiling, not because a retry loop currently reads it).

export const DEFAULT_LIVE_MAX_ATTEMPTS = 1;

/**
 * Resolves how many attempts a --live CLI invocation should use.
 * `explicitOverride` is whatever the caller typed after
 * --live-max-attempts= (a string) — undefined/null means no override was
 * given, so the safe default applies. Throws RangeError for anything that
 * isn't a positive integer.
 */
export function resolveLiveMaxAttempts(explicitOverride) {
  if (explicitOverride === undefined || explicitOverride === null || explicitOverride === "") {
    return DEFAULT_LIVE_MAX_ATTEMPTS;
  }
  const parsed = Number(explicitOverride);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError(`--live-max-attempts must be a positive integer, got "${explicitOverride}"`);
  }
  return parsed;
}

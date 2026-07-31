// DC-003-I006 — renderer configuration, sourced from environment
// variables. Never reads config/*.json — those files are for non-secret,
// version-controlled config (see README "Configuration vs. credentials");
// the renderer's configuration includes a credential, so it belongs here,
// exactly as config/env.example documents.
//
// The renderer service itself (renderer.mjs) never calls this — it only
// ever receives { transport, maxAttempts, timeoutMs } via options, and has
// no knowledge that an apiKey or baseUrl exist. Only the CLI (and whoever
// constructs an HTTP transport) reads this.

export function loadRendererConfig(env = process.env) {
  return {
    apiKey: env.TEMPLATED_API_KEY || null,
    baseUrl: env.TEMPLATED_API_BASE_URL || "https://api.templated.io/v1",
    requestTimeoutMs: Number(env.TEMPLATED_REQUEST_TIMEOUT_MS) || 15000,
    maxAttempts: Number(env.TEMPLATED_RENDER_MAX_ATTEMPTS) || 3,
  };
}

// --- Live-verification safety (added after the DC-003-I006 incident: a
// live CLI run fired three real requests instead of one, because it reused
// TEMPLATED_RENDER_MAX_ATTEMPTS — the normal production retry default —
// without any live-specific ceiling) -------------------------------------
//
// A --live CLI invocation must default to exactly one attempt, completely
// independent of TEMPLATED_RENDER_MAX_ATTEMPTS. Raising it requires an
// explicit, per-invocation override (the CLI's --live-max-attempts flag) —
// never a config file, never an env var silently shared with production.

export const DEFAULT_LIVE_MAX_ATTEMPTS = 1;

/**
 * Resolves how many attempts a --live CLI invocation should use.
 * `explicitOverride` is whatever the caller typed after
 * --live-max-attempts= (a string) — undefined/null means no override was
 * given, so the safe default applies. Throws RangeError for anything that
 * isn't a positive integer, so a typo can't silently become "unlimited" or
 * "zero attempts."
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

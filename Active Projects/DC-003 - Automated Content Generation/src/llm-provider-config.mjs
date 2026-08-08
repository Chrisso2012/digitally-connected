// DC-003-I019 — LLM provider configuration, sourced from environment
// variables. Never reads config/*.json — those files are for non-secret,
// version-controlled config (see README "Configuration vs. credentials");
// this configuration includes a credential, so it belongs here, exactly
// as config/env.example already documented before this milestone
// (LLM_API_KEY/LLM_MODEL were already reserved placeholders).
//
// Generic LLM_* names, not ANTHROPIC_*-prefixed ones — matching this
// repository's own established convention (config/env.example already
// committed to LLM_API_KEY/LLM_MODEL before I019 existed) rather than
// switching to provider-specific naming. Mirrors renderer-config.mjs's
// own structure exactly, including the live-verification safety pattern
// below.
//
// The provider adapter itself (llm-provider-anthropic.mjs) never calls
// this — it only ever receives { transport, model, temperature, maxTokens,
// timeoutMs } via options, and has no knowledge that an apiKey or baseUrl
// exist. Only a CLI (and whoever constructs the HTTP transport) reads this.

export function loadLlmProviderConfig(env = process.env) {
  return {
    provider: env.LLM_PROVIDER || "anthropic",
    apiKey: env.LLM_API_KEY || null,
    model: env.LLM_MODEL || "claude-sonnet-5",
    baseUrl: env.LLM_API_BASE_URL || "https://api.anthropic.com/v1",
    requestTimeoutMs: Number(env.LLM_REQUEST_TIMEOUT_MS) || 15000,
    maxAttempts: Number(env.LLM_MAX_ATTEMPTS) || 3,
  };
}

// --- Live-verification safety (same pattern DC-003-I006 established
// after its own incident: a live CLI run fired three real requests
// instead of one, because it reused the normal production retry default
// with no live-specific ceiling) ------------------------------------
//
// A --live CLI invocation must default to exactly one attempt, completely
// independent of LLM_MAX_ATTEMPTS. Raising it requires an explicit,
// per-invocation override (a CLI's own --live-max-attempts flag) — never
// a config file, never an env var silently shared with production.

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

// --- DC-003-I031.1 — live request timeout override, same shape as the
// live-max-attempts safety above but deliberately NOT shared between
// milestones. Strategy Office approved a narrowly-scoped increase for
// I031 only, after two independent genuine live Anthropic requests both
// timed out at the shared config's own 15000ms default
// (loadLlmProviderConfig().requestTimeoutMs, still 15000, still used
// unchanged by I032's own --live path). Only editorial-package.mjs (I031)
// calls resolveLiveRequestTimeoutMs() — social-media-package.mjs (I032)
// is untouched by this change and keeps reading config.requestTimeoutMs
// directly, per Strategy Office's explicit "do not change any other I031
// responsibility" instruction.

export const DEFAULT_LIVE_REQUEST_TIMEOUT_MS = 60000;

/**
 * Resolves the per-attempt timeout (ms) a --live CLI invocation should
 * use. `explicitOverride` is whatever the caller typed after
 * --live-timeout-ms= (a string) — undefined/null/blank means no override
 * was given, so `defaultMs` applies. Throws RangeError for anything that
 * isn't a positive integer.
 */
export function resolveLiveRequestTimeoutMs(explicitOverride, defaultMs = DEFAULT_LIVE_REQUEST_TIMEOUT_MS) {
  if (explicitOverride === undefined || explicitOverride === null || explicitOverride === "") {
    return defaultMs;
  }
  const parsed = Number(explicitOverride);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError(`--live-timeout-ms must be a positive integer, got "${explicitOverride}"`);
  }
  return parsed;
}

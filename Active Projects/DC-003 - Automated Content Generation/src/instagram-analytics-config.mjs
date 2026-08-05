// DC-003-I028 — Instagram Insights configuration, sourced from environment
// variables. Deliberately reuses the SAME variable names
// instagram-publisher-config.mjs (I027) already established
// (INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID / INSTAGRAM_API_BASE_URL /
// INSTAGRAM_API_VERSION / INSTAGRAM_REQUEST_TIMEOUT_MS) — per this
// milestone's own brief ("Reuse I027 variables where they are already
// appropriate. Do not invent duplicate credential variables
// unnecessarily"). This is a genuinely separate config module (not an
// import of instagram-publisher-config.mjs) because analytics reads and
// content publishing are separate concerns in this codebase's own
// established convention (a separate *-config.mjs per concern, even where
// underlying env vars overlap) — but the values themselves are the same
// account/app credential.
//
// Operational note (see README "Instagram credential/permission
// requirements"): the SAME access token used for publishing does not
// automatically carry insights-read scope. Meta requires
// `instagram_manage_insights` (Facebook Login) or
// `instagram_business_manage_insights` (Instagram Login) in addition to
// whatever publish-only scope I027 already required — provisioning that
// additional scope on the existing token (or app) is an operator/Meta App
// Review concern, not something this module can detect or work around.

export function loadInstagramAnalyticsConfig(env = process.env) {
  return {
    accessToken: env.INSTAGRAM_ACCESS_TOKEN || null,
    userId: env.INSTAGRAM_USER_ID || null,
    apiBaseUrl: env.INSTAGRAM_API_BASE_URL || "https://graph.facebook.com",
    apiVersion: env.INSTAGRAM_API_VERSION || "v21.0",
    requestTimeoutMs: Number(env.INSTAGRAM_REQUEST_TIMEOUT_MS) || 15000,
  };
}

// --- Live-verification safety (the same DC-003-I006/I019/I022/I027
// pattern, applied proactively from day one) ---------------------------

export const DEFAULT_LIVE_MAX_ATTEMPTS = 1;

/**
 * Resolves how many attempts a --live CLI invocation should use.
 * Throws RangeError for anything that isn't a positive integer.
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

// DC-003-I028 — LinkedIn Post Analytics configuration, sourced from
// environment variables. Reuses the SAME LINKEDIN_ACCESS_TOKEN /
// LINKEDIN_API_BASE_URL / LINKEDIN_API_VERSION / LINKEDIN_REQUEST_TIMEOUT_MS
// variable names linkedin-publisher-config.mjs (I027) already established
// — per this milestone's own brief instruction to reuse I027 variables
// where already appropriate.
//
// One genuinely NEW variable, `LINKEDIN_MEMBER_POST_ANALYTICS_ENABLED` —
// not a duplicate credential, an explicit capability confirmation. Repository
// investigation (current official LinkedIn docs, see README "LinkedIn
// credential/permission requirements") found that member (personal-profile)
// post analytics require `r_member_postAnalytics`, a DISTINCT, partner-gated
// permission under LinkedIn's Community Management API that requires its
// own separate application/approval process — materially different from
// `rw_organization_admin`, the standard Marketing API permission
// organization share statistics uses. The access token I027 already
// provisions for publishing was never requested with this scope. Rather
// than attempting a member-analytics request against a token that almost
// certainly lacks this scope and only discovering that via an HTTP 403,
// this flag requires an explicit, informed operator opt-in before any
// member-post request is even attempted — matching the brief's own "fail
// before any request if configuration required by an enabled collection
// is missing" instruction.
//
// Organization-post analytics need no equivalent flag: Organization Share
// Statistics is the standard, generally-available permission tier
// (`rw_organization_admin`), not a restricted partner permission.

const TRUTHY_VALUES = new Set(["1", "true", "yes"]);

export function loadLinkedInAnalyticsConfig(env = process.env) {
  return {
    accessToken: env.LINKEDIN_ACCESS_TOKEN || null,
    apiBaseUrl: env.LINKEDIN_API_BASE_URL || "https://api.linkedin.com",
    apiVersion: env.LINKEDIN_API_VERSION || null,
    requestTimeoutMs: Number(env.LINKEDIN_REQUEST_TIMEOUT_MS) || 15000,
    memberPostAnalyticsEnabled: TRUTHY_VALUES.has(String(env.LINKEDIN_MEMBER_POST_ANALYTICS_ENABLED ?? "").toLowerCase()),
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

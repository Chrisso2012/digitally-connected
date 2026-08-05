// DC-003-I027 — LinkedIn Publisher configuration, sourced from
// environment variables. Never reads config/*.json — these values include
// a credential and an author identity, so they belong here, exactly
// matching every other *-config.mjs in this codebase.
//
// Repository investigation finding (see README "Social Publisher
// (DC-003-I027)"): no LINKEDIN_* environment variable or n8n credential
// exists anywhere in this project as of I027 — checked directly, not
// assumed. LinkedIn's own permission requirements differ depending on
// whether posting is done as a member ("Share on LinkedIn" / "openid
// profile w_member_social" scopes) or as an organisation page (requires
// admin access to that page plus the relevant Community Management /
// organisation posting permission) — provisioning either is outside this
// milestone's own scope.
//
// `authorUrn` must be the FULL, explicit URN — `urn:li:person:<id>` for
// member publishing or `urn:li:organization:<id>` for a page. This
// adapter never infers or silently defaults between the two — see the
// I027 brief's own "the configured author must be explicit" instruction.
//
// The adapter itself (linkedin-multi-image-publisher-adapter.mjs) never
// calls this — it only ever receives an already-resolved config object via
// construction. Only a CLI (or whoever constructs the adapter) reads this.

const AUTHOR_URN_PATTERN = /^urn:li:(person|organization):.+$/;

export function loadLinkedInPublisherConfig(env = process.env) {
  return {
    accessToken: env.LINKEDIN_ACCESS_TOKEN || null,
    authorUrn: env.LINKEDIN_AUTHOR_URN || null,
    apiBaseUrl: env.LINKEDIN_API_BASE_URL || "https://api.linkedin.com",
    apiVersion: env.LINKEDIN_API_VERSION || null,
    requestTimeoutMs: Number(env.LINKEDIN_REQUEST_TIMEOUT_MS) || 15000,
  };
}

/**
 * Returns "member" or "organization" for a syntactically valid authorUrn,
 * or null if it doesn't match either recognised LinkedIn URN shape —
 * never guessed, never defaulted.
 */
export function classifyAuthorUrn(authorUrn) {
  const match = typeof authorUrn === "string" ? authorUrn.match(AUTHOR_URN_PATTERN) : null;
  if (!match) return null;
  return match[1] === "person" ? "member" : "organization";
}

// --- Live-verification safety (see instagram-publisher-config.mjs's own
// header comment for the identical reasoning) ----------------------------

export const DEFAULT_LIVE_MAX_ATTEMPTS = 1;

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

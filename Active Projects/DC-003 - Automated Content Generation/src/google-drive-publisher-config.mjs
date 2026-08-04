// DC-003-I022 — Google Drive Publisher configuration, sourced from
// environment variables. Never reads config/*.json — those files are for
// non-secret, version-controlled config (see README "Configuration vs.
// credentials"); this configuration includes credentials and a
// deployment-specific folder ID, so it belongs here, exactly matching
// llm-provider-config.mjs (I019) and renderer-config.mjs (I006).
//
// Repository investigation finding (see README "Google Drive Publisher
// (DC-003-I022)"): no Google Drive integration exists anywhere in this
// repository or in the n8n environment's own credential store (checked via
// the n8n MCP `list_credentials` — two Google-related credentials exist,
// "Google Sheets account" (googleSheetsOAuth2Api) and "Google Sheets
// account 2" (googleApi), neither confirmed to carry Drive-write scope,
// and neither is what this module reads from anyway — every external
// credential in this codebase, including this one, is a plain environment
// variable read directly by DC-003's own config loaders, never n8n's
// credential vault; n8n only ever invokes this codebase's CLIs as an
// external process, per the established I013/I017/I020 pattern).
//
// Authentication: a standard OAuth2 refresh-token exchange
// (GOOGLE_DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN) — the same "no new
// dependency, Node's built-in fetch only" choice DC-003-I006/I019/I021
// already made for their own HTTP integrations. No googleapis SDK, no new
// package.json dependency.
//
// The publisher adapter itself (google-drive-publisher-adapter.mjs) never
// calls this — it only ever receives an already-resolved config object via
// construction fields. Only a CLI (or whoever constructs the adapter)
// reads this.

export function loadGoogleDrivePublisherConfig(env = process.env) {
  return {
    clientId: env.GOOGLE_DRIVE_CLIENT_ID || null,
    clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET || null,
    refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN || null,
    rootFolderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID || null,
    apiBaseUrl: env.GOOGLE_DRIVE_API_BASE_URL || "https://www.googleapis.com",
    tokenUrl: env.GOOGLE_DRIVE_TOKEN_URL || "https://oauth2.googleapis.com/token",
    requestTimeoutMs: Number(env.GOOGLE_DRIVE_REQUEST_TIMEOUT_MS) || 15000,
    maxAttempts: Number(env.GOOGLE_DRIVE_MAX_ATTEMPTS) || 3,
  };
}

// --- Live-verification safety (same pattern DC-003-I006/I019 established
// after their own incidents: a live CLI run fired multiple real requests
// instead of one, because it reused the normal production retry default
// with no live-specific ceiling) -----------------------------------------
//
// A --live CLI invocation must default to exactly one attempt per Drive
// request, completely independent of GOOGLE_DRIVE_MAX_ATTEMPTS. Raising it
// requires an explicit, per-invocation override — never a config file,
// never an env var silently shared with production. Applied proactively
// here, before this adapter has ever made a single live call — I022
// deliberately does not wait for its own live-verification incident to
// learn this lesson.

export const DEFAULT_LIVE_MAX_ATTEMPTS = 1;

/**
 * Resolves how many attempts a --live CLI invocation should use per Drive
 * request (token refresh, folder lookup/create, each file upload).
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

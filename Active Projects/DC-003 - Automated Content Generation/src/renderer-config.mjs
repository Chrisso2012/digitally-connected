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

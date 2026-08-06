// DC-003-I030 — Google Docs source configuration: how the real
// (non-mock) google-docs-source-adapter.mjs authenticates. Mirrors
// delivery-office-runner-config.mjs / llm-provider-config.mjs's own "read
// env, never assume, never guess" discipline.
//
// GOOGLE_SERVICE_ACCOUNT_JSON carries the FULL downloaded service account
// key file's own JSON content, verbatim, as a single environment variable
// value — not a file path. This matches the rest of this codebase's own
// "env var-driven config, never an assumed filesystem location" convention
// (LLM_API_KEY, OPENAI_API_KEY, CLAUDE_CODE_COMMAND) and sidesteps a
// container/host filesystem-path mismatch entirely (see DC-005-OC-001's
// own README for how much that class of problem has cost this project
// elsewhere). Never logged, never returned by describeAuthenticationAvailability()
// below beyond a bare boolean.
//
// `configured` is a structural signal only ("is a syntactically valid key
// present"), never a live authentication check — this module makes no
// network call. Whether the key actually authenticates, and whether the
// target document has actually been shared with the service account's own
// email, is exactly what a future, separately-authorised Live Verification
// Gate would determine — not something a config loader may probe (same
// discipline as delivery-office-runner-config.mjs's own
// describeAuthenticationAvailability()).

import { ContentSourceConfigurationError } from "./content-source-errors.mjs";

export function loadGoogleDocsSourceConfig(env = process.env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || raw.trim() === "") {
    return { configured: false, clientEmail: null, privateKey: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ContentSourceConfigurationError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  if (typeof parsed.client_email !== "string" || parsed.client_email.trim() === "") {
    throw new ContentSourceConfigurationError("GOOGLE_SERVICE_ACCOUNT_JSON is missing a valid client_email field");
  }
  if (typeof parsed.private_key !== "string" || parsed.private_key.trim() === "") {
    throw new ContentSourceConfigurationError("GOOGLE_SERVICE_ACCOUNT_JSON is missing a valid private_key field");
  }

  return { configured: true, clientEmail: parsed.client_email, privateKey: parsed.private_key };
}

/**
 * Name-only authentication signal for reporting (mirrors
 * describeClaudeCodeAuthenticationAvailability() — CLI/Control Centre
 * "is a mechanism configured", never a value or a live check).
 */
export function describeGoogleDocsAuthenticationAvailability(env = process.env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim() !== "") {
    return { mechanism: "GOOGLE_SERVICE_ACCOUNT_JSON", available: true };
  }
  return { mechanism: "GOOGLE_SERVICE_ACCOUNT_JSON (not set) — the live Google Docs adapter is unusable until configured", available: false };
}

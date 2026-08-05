// DC-003-I029.3 — OpenAI Strategy Review configuration, sourced from
// environment variables. Never reads config/*.json (that's for
// non-secret, version-controlled config) — mirrors llm-provider-config.mjs
// (I019) / google-drive-publisher-config.mjs (I022)'s own discipline.
//
// A genuinely new credential family (OPENAI_*/STRATEGY_REVIEW_*) — no
// existing env var in config/env.example was reusable (confirmed via
// repository investigation: LLM_API_KEY is Anthropic-specific, already
// committed to LLM_PROVIDER=anthropic naming).
//
// STRATEGY_REVIEW_MAX_ATTEMPTS is read here for informational/reporting
// purposes only (e.g. the CLI's own `inspect` output) — it can NEVER
// actually raise how many live OpenAI requests one review makes.
// strategy-review-policy.mjs's own MAX_OPENAI_REQUESTS constant (1) is
// hardcoded and unconfigurable, exactly like execution-policy.mjs's own
// equivalent ceiling (I029.2) — per this milestone's own brief, "no CLI
// option may broaden attempts during initial verification."

export function loadStrategyReviewConfig(env = process.env) {
  return {
    apiKey: env.OPENAI_API_KEY || null,
    model: env.STRATEGY_REVIEW_MODEL || "gpt-4o-2024-08-06",
    baseUrl: env.OPENAI_API_BASE_URL || "https://api.openai.com/v1",
    timeoutMs: Number(env.STRATEGY_REVIEW_TIMEOUT_MS) || 60000,
    maxOutputTokens: Number(env.STRATEGY_REVIEW_MAX_OUTPUT_TOKENS) || 2000,
    maxInputChars: Number(env.STRATEGY_REVIEW_MAX_INPUT_CHARS) || 20000,
    configuredMaxAttempts: Number(env.STRATEGY_REVIEW_MAX_ATTEMPTS) || 1,
  };
}

/** Name-only authentication signal — never reveals a value. */
export function describeAuthenticationAvailability(env = process.env) {
  const available = Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim() !== "");
  return { mechanism: "OPENAI_API_KEY", available };
}

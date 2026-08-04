// DC-003-I023 — Production cost configuration, sourced from environment
// variables. Never reads config/*.json — that's for non-secret,
// version-controlled config; these are pricing RATES, which change over
// time and are deployment-specific, not permanent truth — see README
// "Configurable pricing" for why this mirrors llm-provider-config.mjs
// (I019) / renderer-config.mjs (I006) / google-drive-publisher-config.mjs
// (I022) exactly, rather than hardcoding commercial pricing anywhere in
// source.
//
// production-cost-calculator.mjs never reads process.env itself — it only
// ever receives an already-resolved config object via explicit
// construction fields, matching every other calculation module in this
// codebase's own "no configuration reads inside calculation functions"
// discipline.
//
// README examples showing sample rates are explicitly labelled as
// EXAMPLES, not authoritative current prices — this module's own defaults
// below are chosen to be obviously-a-placeholder (round numbers), not a
// claim about real Anthropic/Templated/Google pricing at any point in
// time.

export function loadProductionCostConfig(env = process.env) {
  return {
    anthropicInputCostPerMillionTokens: Number(env.ANTHROPIC_INPUT_COST_PER_MILLION_TOKENS) || 0,
    anthropicOutputCostPerMillionTokens: Number(env.ANTHROPIC_OUTPUT_COST_PER_MILLION_TOKENS) || 0,
    templatedCostPerRender: Number(env.TEMPLATED_COST_PER_RENDER) || 0,
    googleDriveCostPerUpload: Number(env.GOOGLE_DRIVE_COST_PER_UPLOAD) || 0,
    currency: env.PRODUCTION_COST_CURRENCY || "USD",
  };
}

// DC-003-I023 — Production Cost Calculator: pure functions only. No
// provider HTTP calls, no filesystem access, no configuration reads —
// every function here receives an already-resolved config object
// (production-cost-config.mjs's own loadProductionCostConfig() return
// value) via an explicit parameter, never process.env directly.
//
// Vocabulary (documented once, here, and reused everywhere costs are
// reported — see README "Actual vs. estimated costs"):
//   - "estimated": calculated from a configured rate and real usage/count
//     evidence (token counts, render counts, upload counts). This is the
//     ONLY classification this calculator ever produces when a
//     calculation actually happens — it is never upgraded to "actual",
//     because none of Anthropic/Templated/Google Drive's real billing
//     APIs are integrated (explicitly out of scope for I023 — see
//     README's own closing instruction: "It must not claim to answer:
//     What did the provider invoice us?").
//   - "unavailable": no usage/count evidence exists to calculate from
//     (e.g. a mock run's provider never reported token usage) — amount is
//     always 0, never a guessed placeholder value.
//   - "actual": reserved for a future milestone that integrates real
//     provider billing APIs. This calculator never produces it.
//
// Rounding (documented once, here — see README "Precision and rounding"):
// every per-provider `amount` is rounded to 6 decimal places
// (roundToCalculationPrecision()) at the moment it's calculated, from an
// unrounded intermediate multiplication. `total` is then the sum of those
// three already-6-decimal amounts, rounded again to 6 decimals. Six
// decimal places is precise enough (a millionth of a currency unit) that
// summing three already-rounded amounts and rounding once more introduces
// no practically meaningful compounding error — this is deliberately NOT
// the coarser "round to 2 decimals (cents) per line item, then sum"
// pattern the brief's own guidance warns against, which would lose real
// precision on sub-cent per-token LLM costs.

const CALCULATION_PRECISION_DECIMALS = 6;

function roundToCalculationPrecision(value) {
  const factor = 10 ** CALCULATION_PRECISION_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * usage — { inputTokens, outputTokens } or null/undefined when no usage
 *   evidence was captured (see llm-provider-anthropic.mjs's own onUsage
 *   hook, DC-003-I023's smallest-safe-change to preserve it).
 * config — loadProductionCostConfig()'s own return shape.
 *
 * Returns { amount, calculationType }. "unavailable" (amount: 0) when
 * `usage` is absent — this calculator never estimates token counts from
 * anything else (e.g. character counts), since that would be inventing
 * evidence the provider itself didn't supply.
 */
export function calculateAnthropicCost(usage, config) {
  if (!usage || typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") {
    return { amount: 0, calculationType: "unavailable" };
  }
  const inputCost = (usage.inputTokens / 1_000_000) * config.anthropicInputCostPerMillionTokens;
  const outputCost = (usage.outputTokens / 1_000_000) * config.anthropicOutputCostPerMillionTokens;
  return { amount: roundToCalculationPrecision(inputCost + outputCost), calculationType: "estimated" };
}

/**
 * renderCount — a non-negative integer (Templated does not return any
 *   cost/credit/usage field — confirmed by repository investigation, see
 *   README "Templated usage calculation" — so this is always an estimate
 *   from render count alone, never derived from provider-reported usage).
 * config — loadProductionCostConfig()'s own return shape.
 *
 * Returns { amount, calculationType }. "unavailable" only when
 * `renderCount` itself isn't a valid non-negative integer (a caller bug);
 * a genuine renderCount of 0 (e.g. generation failed before any render
 * was attempted) correctly produces amount: 0 with calculationType
 * "estimated" — zero renders is real evidence, not missing evidence.
 */
export function calculateTemplatedCost(renderCount, config) {
  if (typeof renderCount !== "number" || !Number.isInteger(renderCount) || renderCount < 0) {
    return { amount: 0, calculationType: "unavailable" };
  }
  return { amount: roundToCalculationPrecision(renderCount * config.templatedCostPerRender), calculationType: "estimated" };
}

/**
 * uploadCount — a non-negative integer.
 * config — loadProductionCostConfig()'s own return shape.
 *
 * Returns { amount, calculationType }. Same "unavailable only on a
 * malformed count, zero uploads is real evidence" reasoning as
 * calculateTemplatedCost(). Defaults to a configured cost-per-upload of 0
 * (see production-cost-config.mjs) when Drive uploads are not billed —
 * still classified "estimated", not "actual", since it's still a
 * calculation from a configured rate, not a real invoice line.
 */
export function calculateGoogleDriveCost(uploadCount, config) {
  if (typeof uploadCount !== "number" || !Number.isInteger(uploadCount) || uploadCount < 0) {
    return { amount: 0, calculationType: "unavailable" };
  }
  return { amount: roundToCalculationPrecision(uploadCount * config.googleDriveCostPerUpload), calculationType: "estimated" };
}

/**
 * Combines three already-calculated provider costs (each { amount,
 * calculationType }, e.g. straight from calculateAnthropicCost() etc.)
 * into { currency, anthropic, templated, google_drive, total } — the
 * exact shape production-metrics.schema.json's own `costs` object
 * requires. `total` sums the three UNROUNDED amounts internally before a
 * single final rounding — see this module's own header comment for why.
 */
export function calculateTotalCost({ anthropic, templated, googleDrive, currency }) {
  const total = roundToCalculationPrecision(anthropic.amount + templated.amount + googleDrive.amount);
  return { currency, anthropic, templated, googleDrive, total };
}

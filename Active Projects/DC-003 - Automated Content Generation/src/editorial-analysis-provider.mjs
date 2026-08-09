// DC-003-I031 — Editorial Analysis Provider: the provider-neutral contract
// every AI-assisted editorial analysis implementation (the mock in
// editorial-analysis-mock-provider.mjs, the real one in
// editorial-analysis-anthropic-provider.mjs) must satisfy. Mirrors
// DC-003-I004/I019's own Provider interface exactly —
// `{ name, generateCarousel(prompt, context) }` — rather than
// DC-003-I030's Content Source Adapter shape, since this is the same
// class of thing I004/I019 already solved (call an AI provider with a
// deterministic prompt, get raw JSON back), not a new class of adapter.
//
//   { name: string,
//     analyzeContent(prompt, context): Promise<string> }  // raw JSON string
//
// content.ingestedContent is passed via `context` for interface parity
// with createMockProvider()'s own `{ topicPackage }` context — the mock
// provider reads it directly (no LLM call); a real provider ignores it
// (the prompt string already carries everything it needs, exactly like
// createAnthropicProvider()'s own documented boundary: "adapter must not
// build prompts").
//
// Also exports assertValidEditorialAnalysisResult() — a defense-in-depth
// check on the PARSED JSON object every provider (mock or real) returns,
// run by editorial-package-generator.mjs before createEditorialPackage()
// is ever called, mirroring content-source-adapter.mjs's own
// assertValidContentSourceFetchResult() precedent for untrusted
// provider/adapter output.

import { InvalidEditorialAnalysisProviderError, MalformedEditorialAnalysisResultError } from "./editorial-analysis-errors.mjs";

const REQUIRED_STRING_FIELDS = [
  "primaryHeadline",
  "supportingHeadline",
  "executiveSummary",
  "coreMessage",
  "primaryAudience",
  "primaryProblem",
  "desiredOutcome",
  "callToAction",
  "seoTitle",
  "seoDescription",
];

const REQUIRED_ARRAY_FIELDS = ["keyInsights", "pullQuotes", "keywords", "suggestedHashtags", "editorialThemes", "contentCategories"];

export function assertValidEditorialAnalysisProvider(provider) {
  if (!provider || typeof provider.name !== "string" || typeof provider.analyzeContent !== "function") {
    throw new InvalidEditorialAnalysisProviderError();
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Validates a provider's parsed JSON output against the Editorial
 * Analysis Result contract — every field createEditorialPackage() itself
 * requires (in camelCase, matching its own fields.* input), except
 * ingestedContentId/llmModel/promptVersion/schemaVersion, which
 * editorial-package-generator.mjs supplies itself, never the provider.
 */
// DC-003-I031.3 — safe, content-free structural diagnostics for the one
// field that has failed validation twice in live use (keyInsights).
// Reports shape/type/length/boolean facts only — NEVER the actual string
// values, never article text, never any generated content — so a live
// failure can be diagnosed without exposing anything this project treats
// as sensitive. See editorial-package.mjs's own --live path, the only
// caller: it prints this object (never the raw result) when a
// "result-shape" attempt fails.
export function describeKeyInsightsShape(value) {
  if (value === undefined) {
    return { exists: false, isUndefined: true, isNull: false, type: "undefined", isArray: false, length: null, itemTypes: null, itemLengths: null, anyZeroLength: null, anyBlankAfterTrim: null };
  }
  if (value === null) {
    return { exists: true, isUndefined: false, isNull: true, type: "object", isArray: false, length: null, itemTypes: null, itemLengths: null, anyZeroLength: null, anyBlankAfterTrim: null };
  }
  if (!Array.isArray(value)) {
    return { exists: true, isUndefined: false, isNull: false, type: typeof value, isArray: false, length: null, itemTypes: null, itemLengths: null, anyZeroLength: null, anyBlankAfterTrim: null };
  }
  const itemTypes = value.map((item) => typeof item);
  const itemLengths = value.map((item) => (typeof item === "string" ? item.length : null));
  const anyZeroLength = value.some((item) => typeof item === "string" && item.length === 0);
  const anyBlankAfterTrim = value.some((item) => typeof item === "string" && item.trim() === "");
  return {
    exists: true,
    isUndefined: false,
    isNull: false,
    type: "object",
    isArray: true,
    length: value.length,
    itemTypes,
    itemLengths,
    anyZeroLength,
    anyBlankAfterTrim,
  };
}

// DC-003-I031.4 — narrowly-scoped provider-boundary normalisation for
// keyInsights only. Live evidence (I031.3's own diagnostics) confirmed
// Anthropic can return keyInsights as a single string despite the tool
// schema declaring an array — this is model behaviour our own schema
// (I031.2) cannot force. Called by editorial-package-generator.mjs
// immediately after JSON.parse(raw), before assertValidEditorialAnalysisResult()
// ever runs — never alters, rewrites, splits, or otherwise touches the
// string's own content; a non-empty, non-whitespace string becomes
// exactly a one-item array wrapping that same string, verbatim. Every
// other shape (already an array, null, a number, an object, a blank/
// whitespace-only string) passes through completely unchanged, so the
// existing validator still rejects it exactly as before — this function
// never makes an invalid result look valid beyond the one specific,
// evidence-confirmed shape it targets.
export function normalizeEditorialAnalysisKeyInsights(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const value = result.keyInsights;
  if (typeof value === "string" && value.trim() !== "") {
    return { ...result, keyInsights: [value] };
  }
  return result;
}

export function assertValidEditorialAnalysisResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new MalformedEditorialAnalysisResultError("result is not an object");
  }
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(result[field])) {
      throw new MalformedEditorialAnalysisResultError(`${field} is required and must be a non-empty string`);
    }
  }
  for (const field of REQUIRED_ARRAY_FIELDS) {
    if (!Array.isArray(result[field]) || result[field].length === 0 || !result[field].every(isNonEmptyString)) {
      throw new MalformedEditorialAnalysisResultError(`${field} must be a non-empty array of non-empty strings`);
    }
  }
  return result;
}

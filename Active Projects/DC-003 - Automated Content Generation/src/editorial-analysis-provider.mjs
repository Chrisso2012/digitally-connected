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

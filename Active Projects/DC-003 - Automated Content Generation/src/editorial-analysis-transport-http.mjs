// DC-003-I031 — HTTP transport for editorial-analysis calls to
// Anthropic's Messages API. Mirrors llm-transport-http.mjs's own request
// construction, error mapping, and safe-diagnostic handling exactly (same
// endpoint, headers, timeout/AbortController mechanics, and — DC-003-I019.3
// lesson applied from day one here — `temperature` omitted from the
// request unless the caller explicitly set one). The only real difference
// is the forced tool's own name/schema, which is naturally
// editorial-package-shaped rather than carousel-slide-shaped; every other
// concern (LlmAuthenticationError/LlmRateLimitError/LlmTimeoutError/
// LlmTransportError/LlmClientError classification, buildSafeDiagnostic())
// is imported and reused unmodified from llm-provider-errors.mjs /
// llm-error-diagnostics.mjs — see this module's own investigation note in
// README "AI Processing" for why a parallel transport file was written
// instead of parameterising llm-transport-http.mjs itself: this codebase's
// own established discipline is to leave an already-shipped, tested
// milestone's files untouched rather than risk it for a later milestone's
// convenience (the same reasoning DC-003-I029.1 gave for not touching
// I029's Work Order/Delivery Report Stores).

import { LlmAuthenticationError, LlmClientError, LlmConfigurationError, LlmRateLimitError, LlmTimeoutError, LlmTransportError } from "./llm-provider-errors.mjs";
import { buildSafeDiagnostic } from "./llm-error-diagnostics.mjs";

export const TOOL_NAME = "return_editorial_package";

// DC-003-I031.2 — every string leaf here carries minLength: 1. Root
// cause of a genuine live failure: this schema's own string/array-item
// fields previously had no minLength, so Anthropic's structured-output
// enforcement (which validates strictly against whatever JSON schema is
// supplied) treated an empty string as schema-valid — while
// editorial-analysis-provider.mjs's own assertValidEditorialAnalysisResult()
// has always required every one of these strings to be non-empty. A live
// response containing a blank keyInsights entry passed Anthropic's own
// schema check (nothing forbade it) and only then failed local
// validation, surfacing as a generic "malformed result" rather than
// being prevented at the source. Fixing this at the schema boundary
// (never generating an empty string in the first place) is preferred
// over any post-hoc repair of already-invalid output — see this
// milestone's own README section for the full investigation.
const NON_EMPTY_STRING = { type: "string", minLength: 1 };

// DC-003-I031.6 — root cause of a live failure downstream of I031.2/I031.5:
// Anthropic returned every one of these six fields as ONE string
// containing literal "<item>...</item>"-tagged segments rather than
// genuine array elements. Investigated and ruled out as the source: the
// ingested article body itself (Google Drive's own mimeType=text/plain
// export never produces XML-style markup — see
// google-docs-source-adapter.mjs). Confirmed instead: this schema's own
// `type: "array"` declaration alone is NOT sufficient to guarantee
// Anthropic's tool-use output actually conforms to it — the earlier
// keyInsights-as-string and pullQuotes-as-string live failures both
// returned a normal successful HTTP response with a schema-violating
// shape; nothing on Anthropic's own side rejected it, and this
// transport never validated the tool_use input's sub-schema itself
// (only editorial-analysis-provider.mjs's own local validator ever
// caught it, after the fact). Neither this schema nor the prompt
// (editorial-package-prompt-builder.mjs) previously told the model
// explicitly NOT to represent a list as XML-tagged prose inside a single
// string — a documented Claude habit when asked for "a list" without
// that constraint spelled out. `description` here is the fix: each
// array field's own description now explicitly forbids XML tags/
// `<item>` wrappers/pseudo-lists and states "one element per real
// insight/quote/etc.", reinforcing the same constraint the prompt itself
// now also states in its own "Writing constraints"/"Output format"
// sections (PROMPT_VERSION bumped to editorial-package.v2).
function nonEmptyStringArray(itemNoun) {
  return {
    type: "array",
    items: NON_EMPTY_STRING,
    minItems: 1,
    description: `A native JSON array of strings — one ${itemNoun} per array element. Do NOT return a single string. Do NOT use XML tags (e.g. <item>...</item>), newline-delimited lists, or comma-delimited lists inside one string.`,
  };
}

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    primaryHeadline: NON_EMPTY_STRING,
    supportingHeadline: NON_EMPTY_STRING,
    executiveSummary: NON_EMPTY_STRING,
    coreMessage: NON_EMPTY_STRING,
    primaryAudience: NON_EMPTY_STRING,
    primaryProblem: NON_EMPTY_STRING,
    desiredOutcome: NON_EMPTY_STRING,
    keyInsights: nonEmptyStringArray("insight"),
    pullQuotes: nonEmptyStringArray("quote"),
    callToAction: NON_EMPTY_STRING,
    keywords: nonEmptyStringArray("keyword or phrase"),
    seoTitle: NON_EMPTY_STRING,
    seoDescription: NON_EMPTY_STRING,
    suggestedHashtags: nonEmptyStringArray("hashtag"),
    editorialThemes: nonEmptyStringArray("theme"),
    contentCategories: nonEmptyStringArray("category"),
  },
  required: [
    "primaryHeadline", "supportingHeadline", "executiveSummary", "coreMessage", "primaryAudience", "primaryProblem",
    "desiredOutcome", "keyInsights", "pullQuotes", "callToAction", "keywords", "seoTitle", "seoDescription",
    "suggestedHashtags", "editorialThemes", "contentCategories",
  ],
};

/**
 * config: { apiKey, baseUrl }
 */
export function createEditorialAnalysisHttpTransport(config) {
  if (!config?.apiKey) {
    throw new LlmConfigurationError("LLM_API_KEY is required to create the editorial-analysis HTTP transport");
  }
  const baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");

  return {
    name: "anthropic-http-editorial-analysis",
    async send(request, sendOptions = {}) {
      const timeoutMs = sendOptions.timeoutMs ?? 15000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response;
      try {
        response = await fetch(`${baseUrl}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: request.model,
            max_tokens: request.maxTokens,
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            messages: [{ role: "user", content: request.prompt }],
            tools: [{ name: request.toolName, description: "Return the extracted editorial package as structured data.", input_schema: TOOL_INPUT_SCHEMA }],
            tool_choice: { type: "tool", name: request.toolName },
          }),
          signal: controller.signal,
        });
      } catch (cause) {
        if (cause.name === "AbortError") {
          throw new LlmTimeoutError(`Anthropic request timed out after ${timeoutMs}ms`, timeoutMs);
        }
        throw new LlmTransportError(`Anthropic request failed: ${cause.message}`, cause);
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 401 || response.status === 403) {
        throw new LlmAuthenticationError(`Anthropic rejected the API key (HTTP ${response.status})`);
      }
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
        throw new LlmRateLimitError(`Anthropic reported a rate limit (HTTP 429)`, retryAfterMs);
      }
      if (response.status >= 500) {
        throw new LlmTransportError(`Anthropic returned a server error (HTTP ${response.status})`, null);
      }
      if (!response.ok) {
        let bodyText = null;
        try {
          bodyText = await response.text();
        } catch {
          bodyText = null;
        }
        const diagnostic = buildSafeDiagnostic(response, bodyText);
        throw new LlmClientError(`Anthropic rejected the request (HTTP ${response.status})`, diagnostic);
      }

      let body;
      try {
        body = await response.json();
      } catch (cause) {
        throw new LlmTransportError(`Anthropic response was not valid JSON: ${cause.message}`, cause);
      }
      return body;
    },
  };
}

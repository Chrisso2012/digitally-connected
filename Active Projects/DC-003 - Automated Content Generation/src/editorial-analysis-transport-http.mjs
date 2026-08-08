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
const NON_EMPTY_STRING_ARRAY = { type: "array", items: NON_EMPTY_STRING, minItems: 1 };

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
    keyInsights: NON_EMPTY_STRING_ARRAY,
    pullQuotes: NON_EMPTY_STRING_ARRAY,
    callToAction: NON_EMPTY_STRING,
    keywords: NON_EMPTY_STRING_ARRAY,
    seoTitle: NON_EMPTY_STRING,
    seoDescription: NON_EMPTY_STRING,
    suggestedHashtags: NON_EMPTY_STRING_ARRAY,
    editorialThemes: NON_EMPTY_STRING_ARRAY,
    contentCategories: NON_EMPTY_STRING_ARRAY,
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

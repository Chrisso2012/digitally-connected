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

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    primaryHeadline: { type: "string" },
    supportingHeadline: { type: "string" },
    executiveSummary: { type: "string" },
    coreMessage: { type: "string" },
    primaryAudience: { type: "string" },
    primaryProblem: { type: "string" },
    desiredOutcome: { type: "string" },
    keyInsights: { type: "array", items: { type: "string" }, minItems: 1 },
    pullQuotes: { type: "array", items: { type: "string" }, minItems: 1 },
    callToAction: { type: "string" },
    keywords: { type: "array", items: { type: "string" }, minItems: 1 },
    seoTitle: { type: "string" },
    seoDescription: { type: "string" },
    suggestedHashtags: { type: "array", items: { type: "string" }, minItems: 1 },
    editorialThemes: { type: "array", items: { type: "string" }, minItems: 1 },
    contentCategories: { type: "array", items: { type: "string" }, minItems: 1 },
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

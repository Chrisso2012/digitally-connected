// DC-003-I032 — HTTP transport for social-media-package calls to
// Anthropic's Messages API. Mirrors editorial-analysis-transport-http.mjs
// (and, before it, llm-transport-http.mjs) exactly — same endpoint,
// headers, timeout/AbortController mechanics, and the same
// `temperature`-omitted-unless-explicit lesson applied from day one. The
// only real difference is the forced tool's own name/schema, naturally
// social-media-package-shaped; every other concern (error classification,
// safe diagnostics) is imported and reused unmodified from
// llm-provider-errors.mjs / llm-error-diagnostics.mjs — see this
// milestone's own README "AI Processing" for why a parallel transport
// file was written instead of parameterising llm-transport-http.mjs
// itself (leaving an already-shipped milestone's files untouched).

import { LlmAuthenticationError, LlmClientError, LlmConfigurationError, LlmRateLimitError, LlmTimeoutError, LlmTransportError } from "./llm-provider-errors.mjs";
import { buildSafeDiagnostic } from "./llm-error-diagnostics.mjs";

export const TOOL_NAME = "return_social_media_package";

const textVariationSchema = {
  type: "object",
  properties: { postText: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } },
  required: ["postText", "hashtags"],
};

// DC-003-I032.1 — one carousel slide, semantically typed. `statistic`/
// `quote` are nullable evidence containers (Anthropic's structured-output
// tool_choice requires every property listed even when the value is
// null, so both remain in `required` — the model must explicitly choose
// null rather than omit the field when no real evidence exists).
const carouselSlideSchema = {
  type: "object",
  properties: {
    slideNumber: { type: "integer", minimum: 1, maximum: 6 },
    slideRole: { type: "string", enum: ["cover", "insight", "statistic", "quote", "takeaway", "cta"] },
    heading: { type: "string" },
    body: { type: "string" },
    imageGuidance: { type: "string" },
    statistic: {
      anyOf: [{ type: "null" }, { type: "object", properties: { value: { type: "string" }, context: { type: "string" } }, required: ["value", "context"] }],
    },
    quote: {
      anyOf: [{ type: "null" }, { type: "object", properties: { quoteText: { type: "string" } }, required: ["quoteText"] }],
    },
    keyPoints: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 4 },
  },
  required: ["slideNumber", "slideRole", "heading", "body", "imageGuidance", "statistic", "quote", "keyPoints"],
};

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    hook: { type: "string" },
    callToAction: { type: "string" },
    tone: { type: "string" },
    audience: { type: "string" },
    // DC-003-I031.8 — an honest evidence container, mirroring statistic/
    // quote's own null-or-real pattern: non-null ONLY when the audience
    // above clearly supports a specific industry/sector/professional
    // domain, described in the model's own words; null when the source
    // is genuinely general-audience. Required (like statistic/quote) so
    // the model must explicitly choose null rather than silently omit it.
    industryContext: { anyOf: [{ type: "null" }, { type: "string", minLength: 1 }] },
    platforms: {
      type: "object",
      properties: {
        linkedin: textVariationSchema,
        facebook: textVariationSchema,
        x: textVariationSchema,
        instagram: {
          type: "object",
          properties: { caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } },
          required: ["caption", "hashtags"],
        },
      },
      required: ["linkedin", "facebook", "x", "instagram"],
    },
    carousel: {
      type: "object",
      properties: {
        headings: { type: "array", items: { type: "string" }, minItems: 6, maxItems: 6 },
        slideCopy: { type: "array", items: { type: "string" }, minItems: 6, maxItems: 6 },
        imageGuidance: { type: "array", items: { type: "string" }, minItems: 6, maxItems: 6 },
        slides: { type: "array", items: carouselSlideSchema, minItems: 6, maxItems: 6 },
      },
      required: ["headings", "slideCopy", "imageGuidance", "slides"],
    },
  },
  required: ["hook", "callToAction", "tone", "audience", "industryContext", "platforms", "carousel"],
};

/**
 * config: { apiKey, baseUrl }
 */
export function createSocialMediaHttpTransport(config) {
  if (!config?.apiKey) {
    throw new LlmConfigurationError("LLM_API_KEY is required to create the social-media-package HTTP transport");
  }
  const baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");

  return {
    name: "anthropic-http-social-media-package",
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
            tools: [{ name: request.toolName, description: "Return the generated social media package as structured data.", input_schema: TOOL_INPUT_SCHEMA }],
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

// DC-003-I019 — HTTP transport for Anthropic's Messages API. The only
// place in this codebase that speaks HTTP to Anthropic. Uses Node's
// built-in global fetch (Node 18+) — no new dependency, mirroring
// DC-003-I006's renderer-transport-http.mjs exactly. Never used by
// automated tests; see llm-transport-mock.mjs for what tests actually
// run against.
//
// Endpoint (POST https://api.anthropic.com/v1/messages), headers
// (`x-api-key`, `anthropic-version: 2023-06-01`), and the tool-use
// mechanism for forcing structured output are per Anthropic's published
// Messages API documentation (https://docs.anthropic.com/en/api/messages,
// https://docs.anthropic.com/en/docs/build-with-claude/tool-use). Not yet
// exercised against a live request as of this comment — that requires
// fresh Strategy Office + CEO approval per the I019 brief's own Live
// Verification Gate, capped at one request, and is deliberately not part
// of this milestone's automated implementation.
//
// Structured output, not prose-embedded JSON: the request forces exactly
// one tool call via `tool_choice`, so the response's `content` contains a
// `tool_use` block whose `input` is already a parsed JSON object matching
// TOOL_INPUT_SCHEMA below — never free-form text requiring a
// find-the-JSON-in-prose parse. The schema is deliberately small (an
// array of exactly 6 { slide_type, content } objects, `content` untyped)
// — mirroring this codebase's own existing simplification for Carousel
// Content (schemas/carousel-content.schema.json also types `content` as
// a generic object; see README "Schemas"). Precise per-slide-type field
// validation happens afterward, unchanged, in
// carousel-content-shape.mjs — this schema's only job is forcing valid,
// roughly-shaped JSON out of the model, not re-implementing that
// validation a second time.

import { LlmAuthenticationError, LlmConfigurationError, LlmRateLimitError, LlmTimeoutError, LlmTransportError } from "./llm-provider-errors.mjs";

export const TOOL_NAME = "return_carousel_slides";

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          slide_type: { type: "string" },
          content: { type: "object" },
        },
        required: ["slide_type", "content"],
      },
    },
  },
  required: ["slides"],
};

/**
 * config: { apiKey, baseUrl }
 */
export function createHttpTransport(config) {
  if (!config?.apiKey) {
    throw new LlmConfigurationError("LLM_API_KEY is required to create the Anthropic HTTP transport");
  }
  const baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");

  return {
    name: "anthropic-http",
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
            temperature: request.temperature,
            messages: [{ role: "user", content: request.prompt }],
            tools: [{ name: request.toolName, description: "Return the six carousel slides as structured data.", input_schema: TOOL_INPUT_SCHEMA }],
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
        // A 4xx other than 401/403/429 (e.g. 400 invalid_request_error) is
        // a request-construction problem, not a transient one — surfaced
        // as a transport failure since it isn't one of this module's own
        // more specific categories, but deliberately not retried by
        // carousel-generator.mjs either way (LlmTransportError is
        // retryable by default for the genuinely transient 5xx case
        // above; a 4xx here still gets one retry under the existing
        // policy, matching this codebase's existing "err toward simple,
        // bounded retry" stance rather than adding a further category).
        throw new LlmTransportError(`Anthropic request returned HTTP ${response.status}`, null);
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

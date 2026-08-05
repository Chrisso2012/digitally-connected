// DC-003-I029.3 — OpenAI Strategy Review Adapter: the real (never used by
// an automated test) implementation of the Strategy Review Agent Adapter
// contract, calling OpenAI's Responses API directly via Node's built-in
// `fetch` — no SDK dependency, mirroring llm-transport-http.mjs's own
// (I019) "raw fetch, one HTTP call" discipline exactly.
//
// Mechanism confirmed against OpenAI's own current documentation during
// this milestone's feasibility investigation (fetched live, doc-only, no
// API key used — see the investigation report): `POST /v1/responses`,
// structured output via `text.format = { type: "json_schema", name,
// schema, strict: true }` (the older `response_format` key is deprecated
// for this endpoint), `max_output_tokens`, no `tools` field at all (tools
// omitted entirely = no tool execution possible). The response's
// structured JSON lands at `output[].content[].text` (a string to
// JSON.parse); usage at `usage.input_tokens`/`output_tokens`/`total_tokens`.
// This has not been confirmed against a real live call — no live OpenAI
// request is authorised during this milestone's implementation; the
// Initial Live Review Verification Gate (see README) is what confirms it
// for real, once, under separate authorisation.
//
// Never sent: API credentials (only ever placed in the Authorization
// header, never the body/logs), complete repository files, full source
// diffs, raw Claude transcripts, hidden reasoning, environment values, or
// arbitrary filesystem content — buildReviewInstruction() only ever
// includes bounded evidence summaries and the Work Order's own fields.
// Never returned or logged: the API key, request headers, the full
// instruction, the full evidence package, or the raw response body —
// only the normalised Review Proposal and (on failure) a bounded
// diagnostic from strategy-review-error-diagnostics.mjs.

import {
  StrategyReviewConfigurationError,
  StrategyReviewAuthenticationError,
  StrategyReviewRateLimitError,
  StrategyReviewTimeoutError,
  StrategyReviewClientError,
  StrategyReviewTransportError,
  MalformedReviewProposalError,
} from "./strategy-review-errors.mjs";
import { buildOpenAiSafeDiagnostic } from "./strategy-review-error-diagnostics.mjs";
import { buildReviewInstruction, REVIEW_PROPOSAL_JSON_SCHEMA } from "./strategy-review-instruction.mjs";

function extractOutputText(body) {
  const message = Array.isArray(body?.output) ? body.output.find((o) => o.type === "message") : null;
  const textBlock = Array.isArray(message?.content) ? message.content.find((c) => c.type === "output_text") : null;
  return typeof textBlock?.text === "string" ? textBlock.text : null;
}

/**
 * Builds the real OpenAI Strategy Review Adapter.
 *
 * config.apiKey — required (throws StrategyReviewConfigurationError if
 *   absent — never at import time, only when this factory is actually
 *   called, so a missing key never breaks the mock-default path).
 * config.model / baseUrl / maxOutputTokens / maxInputChars — see
 *   strategy-review-config.mjs.
 * options.fetchFn — override global fetch (tests only — automated tests
 *   never let this reach a real network call).
 */
export function createOpenAiStrategyReviewAdapter(config, options = {}) {
  if (!config?.apiKey) {
    throw new StrategyReviewConfigurationError("OPENAI_API_KEY is required to create the OpenAI Strategy Review adapter");
  }
  const baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const fetchFn = options.fetchFn ?? fetch;

  return {
    name: "openai-responses-strategy-review",

    async reviewDelivery({ workOrder, deliveryReport, evidence, policy }) {
      const rawInstruction = buildReviewInstruction({ workOrder, deliveryReport, evidence, policy });
      const instruction = rawInstruction.length > policy.maxInputChars ? `${rawInstruction.slice(0, policy.maxInputChars)}… [truncated]` : rawInstruction;

      const timeoutMs = Math.min(config.timeoutMs ?? policy.maxReviewDurationMs, policy.maxReviewDurationMs);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response;
      try {
        response = await fetchFn(`${baseUrl}/responses`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            model: config.model,
            input: [{ role: "developer", content: instruction }],
            text: { format: { type: "json_schema", name: "strategy_review_proposal", strict: true, schema: REVIEW_PROPOSAL_JSON_SCHEMA } },
            max_output_tokens: policy.maxOutputTokens ?? config.maxOutputTokens,
          }),
          signal: controller.signal,
        });
      } catch (cause) {
        if (cause.name === "AbortError") {
          throw new StrategyReviewTimeoutError(`OpenAI Strategy Review request timed out after ${timeoutMs}ms`, timeoutMs);
        }
        throw new StrategyReviewTransportError(`OpenAI Strategy Review request failed: ${cause.message}`, cause);
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 401 || response.status === 403) {
        throw new StrategyReviewAuthenticationError(`OpenAI rejected the API key (HTTP ${response.status})`);
      }
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("retry-after");
        throw new StrategyReviewRateLimitError("OpenAI reported a rate limit (HTTP 429)", retryAfterHeader ? Number(retryAfterHeader) * 1000 : null);
      }
      if (response.status >= 500) {
        throw new StrategyReviewTransportError(`OpenAI returned a server error (HTTP ${response.status})`, null);
      }
      if (!response.ok) {
        let bodyText = null;
        try {
          bodyText = await response.text();
        } catch {
          bodyText = null;
        }
        throw new StrategyReviewClientError(`OpenAI rejected the request (HTTP ${response.status})`, buildOpenAiSafeDiagnostic(response, bodyText));
      }

      let body;
      try {
        body = await response.json();
      } catch (cause) {
        throw new StrategyReviewTransportError(`OpenAI response was not valid JSON: ${cause.message}`, cause);
      }

      const outputText = extractOutputText(body);
      if (outputText === null) {
        throw new MalformedReviewProposalError("OpenAI response did not contain a structured output_text block at the documented location");
      }

      let proposal;
      try {
        proposal = JSON.parse(outputText);
      } catch {
        throw new MalformedReviewProposalError("OpenAI's own structured output_text was not valid JSON");
      }

      return proposal;
    },
  };
}

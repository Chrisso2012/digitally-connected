// DC-003-I031 — Anthropic Editorial Analysis Provider Adapter. Mirrors
// llm-provider-anthropic.mjs's own structure and boundaries exactly —
// implements the Editorial Analysis Provider interface
// (editorial-analysis-provider.mjs), makes exactly ONE transport call per
// analyzeContent() invocation (no internal retry loop — retrying is
// entirely editorial-package-generator.mjs's own withRetry() job, the
// same reasoning llm-provider-anthropic.mjs's own header comment gives).
//
// Reuses llm-response-validator.mjs's validateLlmTransportResponse()
// directly, unmodified — it already accepts an arbitrary `toolName`
// parameter and its actual logic (validate the response envelope, find
// the matching tool_use block, return its JSON input + normalised usage)
// has no carousel-specific content; only its return field name
// (`slidesJson`) is carousel-flavoured, so it's destructured and renamed
// locally below. Writing a byte-for-byte duplicate of this function under
// a different name would be pure, needless drift risk for zero benefit.

import { TOOL_NAME } from "./editorial-analysis-transport-http.mjs";
import { validateLlmTransportResponse } from "./llm-response-validator.mjs";
import { LlmProviderError } from "./llm-provider-errors.mjs";

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Builds an Anthropic-backed Editorial Analysis provider, implementing
 * the same { name, analyzeContent(prompt, context) } interface
 * createEditorialAnalysisMockProvider() implements.
 *
 * fields.transport — required, { name, send(request, { timeoutMs }) } —
 *   the return value of createEditorialAnalysisHttpTransport(). No
 *   implicit default, mirroring createAnthropicProvider()'s own "no
 *   automated or careless script can ever accidentally reach a real
 *   endpoint" design.
 * fields.model — required, the exact model identifier.
 * fields.temperature — no default; omitted from the request entirely
 *   unless explicitly passed (see editorial-analysis-transport-http.mjs's
 *   header comment for why).
 * fields.maxTokens — default 4096.
 * fields.timeoutMs — per-call timeout, default 15000.
 * fields.onUsage — optional, `(usage) => void`, mirrors
 *   llm-provider-anthropic.mjs's own observational usage hook.
 */
export function createAnthropicEditorialAnalysisProvider(fields = {}) {
  if (!fields.transport) {
    throw new LlmProviderError("createAnthropicEditorialAnalysisProvider requires fields.transport — no transport is selected by default");
  }
  if (!fields.model) {
    throw new LlmProviderError("createAnthropicEditorialAnalysisProvider requires fields.model");
  }

  const { transport, model } = fields;
  const temperature = fields.temperature; // no default
  const maxTokens = fields.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = fields.timeoutMs ?? 15000;

  return {
    name: `anthropic-editorial-${model}`,

    /**
     * Returns a raw JSON string — `JSON.parse()`-able into the Editorial
     * Analysis Result shape — exactly matching
     * createEditorialAnalysisMockProvider()'s own return contract.
     *
     * Throws whatever editorial-analysis-transport-http.mjs /
     * llm-response-validator.mjs throw — every thrown error carries a
     * `.retryable` boolean; editorial-package-generator.mjs's own retry
     * loop decides whether to retry, not this function.
     */
    async analyzeContent(prompt) {
      const request = { model, prompt, temperature, maxTokens, toolName: TOOL_NAME };
      const rawResponse = await transport.send(request, { timeoutMs });
      // slidesJson: this function's own return field name from I019 — the
      // actual value is just "the tool_use block's JSON input as a raw
      // string," equally applicable to an editorial-package payload; see
      // this module's own header comment for why it's reused unrenamed.
      const { slidesJson: analysisJson, usage } = validateLlmTransportResponse(rawResponse, TOOL_NAME);
      fields.onUsage?.(usage);
      return analysisJson;
    },
  };
}

// DC-003-I032 — Anthropic Social Media Provider Adapter. Mirrors
// editorial-analysis-anthropic-provider.mjs's own structure and
// boundaries exactly — implements the Social Media Provider interface
// (social-media-provider.mjs), makes exactly ONE transport call per
// generateSocialMedia() invocation (no internal retry loop — retrying is
// entirely social-media-package-generator.mjs's own withRetry() job).
//
// Reuses llm-response-validator.mjs's validateLlmTransportResponse()
// directly, unmodified — see editorial-analysis-anthropic-provider.mjs's
// own header comment for why (already generic, only its return field's
// name — slidesJson — is carousel-flavoured, destructured and renamed
// locally rather than duplicated).

import { TOOL_NAME } from "./social-media-transport-http.mjs";
import { validateLlmTransportResponse } from "./llm-response-validator.mjs";
import { LlmProviderError } from "./llm-provider-errors.mjs";

// DC-003-I032.4 — raised from the shared 4096 default (still used
// unmodified by I004's llm-provider-anthropic.mjs and I031's own
// editorial-analysis-anthropic-provider.mjs) after I032.3's controlled
// live diagnostic confirmed stop_reason: "max_tokens" with `carousel`
// (the schema's last, and largest, top-level property) missing entirely
// — genuine token-budget exhaustion, not a shape/serialization bug.
// Scoped to this file only: I032's own Anthropic result payload
// (platforms + a full six-slide semantic carousel, each slide carrying
// heading/body/imageGuidance/statistic/quote/keyPoints) is structurally
// larger than I004's or I031's own result shapes, so this provider's
// budget is deliberately independent rather than a shared constant bump.
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Builds an Anthropic-backed Social Media provider, implementing the
 * same { name, generateSocialMedia(prompt, context) } interface
 * createSocialMediaMockProvider() implements.
 *
 * fields.transport — required, the return value of
 *   createSocialMediaHttpTransport(). No implicit default.
 * fields.model — required, the exact model identifier.
 * fields.temperature — no default; omitted unless explicitly passed.
 * fields.maxTokens — default 8192 (DC-003-I032.4; independent of I004/I031's
 *   own 4096 default — see this constant's own header comment above).
 * fields.timeoutMs — per-call timeout, default 15000.
 * fields.onUsage — optional, `(usage) => void`.
 * fields.onStopReason — optional, `(stopReason) => void` (DC-003-I032.3) —
 *   surfaces Anthropic's raw stop_reason for this call so a caller can
 *   attach it to a result-shape failure's own diagnostics (a "max_tokens"
 *   value is evidence the tool-call output was cut off mid-object).
 */
export function createAnthropicSocialMediaProvider(fields = {}) {
  if (!fields.transport) {
    throw new LlmProviderError("createAnthropicSocialMediaProvider requires fields.transport — no transport is selected by default");
  }
  if (!fields.model) {
    throw new LlmProviderError("createAnthropicSocialMediaProvider requires fields.model");
  }

  const { transport, model } = fields;
  const temperature = fields.temperature; // no default
  const maxTokens = fields.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = fields.timeoutMs ?? 15000;

  return {
    name: `anthropic-social-media-${model}`,

    /**
     * Returns a raw JSON string — `JSON.parse()`-able into the Social
     * Media Result shape — exactly matching
     * createSocialMediaMockProvider()'s own return contract.
     */
    async generateSocialMedia(prompt) {
      const request = { model, prompt, temperature, maxTokens, toolName: TOOL_NAME };
      const rawResponse = await transport.send(request, { timeoutMs });
      const { slidesJson: resultJson, usage, stopReason } = validateLlmTransportResponse(rawResponse, TOOL_NAME);
      fields.onUsage?.(usage);
      fields.onStopReason?.(stopReason);
      return resultJson;
    },
  };
}

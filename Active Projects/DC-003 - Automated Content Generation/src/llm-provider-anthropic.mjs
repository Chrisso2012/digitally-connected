// DC-003-I019 — Anthropic LLM Provider Adapter.
//
// Implements the exact provider interface DC-003-I004's
// carousel-generator.mjs already depends on — { name,
// generateCarousel(prompt, context) } returning a raw JSON string — the
// same shape createMockProvider() already implements. Swapping this in
// for the mock provider requires no change to carousel-generator.mjs,
// pipeline-stages.mjs, the Pipeline Orchestrator, the Invocation Adapter,
// the n8n Adapter, the Content Request Command, or the Content Asset
// Repository — confirmed during this milestone's own pre-flight
// inspection, not assumed.
//
// The adapter's responsibilities, and only these (per the approved I019
// brief): accept the existing deterministic prompt unchanged, call the
// provider API via the injected transport, request structured output,
// parse/normalize the response into the existing Carousel Content shape
// (a raw JSON string carrying { slides: [...] }), and classify failures
// safely. It does NOT build prompts (carousel-prompt-builder.mjs,
// unchanged), map Templated payloads, render, persist Finished
// Carousels, interpret Content Assets directly, or change pipeline
// sequencing — none of that code exists here.
//
// Makes exactly ONE transport call per generateCarousel() invocation — no
// internal retry loop. Retrying is entirely carousel-generator.mjs's own
// existing withRetry() wrapper's job (unmodified in its own retry
// mechanics — only its provider-error classification was extended, see
// that module's header comment) — a second, adapter-internal retry loop
// here would risk exactly the kind of attempt-count multiplication the
// DC-003-I006 live-verification incident already taught this codebase to
// avoid.

import { TOOL_NAME } from "./llm-transport-http.mjs";
import { validateLlmTransportResponse } from "./llm-response-validator.mjs";
import { LlmProviderError } from "./llm-provider-errors.mjs";

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Builds an Anthropic-backed LLM provider, implementing the same
 * { name, generateCarousel(prompt, context) } interface
 * createMockProvider() implements.
 *
 * fields.transport — required, { name, send(request, { timeoutMs }) }.
 *   No implicit default — a caller must explicitly choose one (the mock
 *   transport, or the real HTTP transport), the same "no automated or
 *   careless script can ever accidentally reach a real endpoint" design
 *   DC-003-I006's renderer.mjs already established.
 * fields.model — required, the exact model identifier (e.g.
 *   "claude-sonnet-5"). Always from configuration (llm-provider-config.mjs,
 *   ultimately LLM_MODEL) or an explicit override — never hardcoded here.
 * fields.temperature — DC-003-I019.3: no default. Omitted from the request
 *   entirely unless the caller explicitly passes one — see
 *   llm-transport-http.mjs's header comment for why (the Live Verification
 *   Gate's third live attempt was rejected with HTTP 400
 *   invalid_request_error: "`temperature` is deprecated for this model").
 *   An explicit override is still honored, for a future model that does
 *   accept it.
 * fields.maxTokens — default 4096.
 * fields.timeoutMs — per-call timeout passed to the transport, default
 *   15000.
 */
export function createAnthropicProvider(fields = {}) {
  if (!fields.transport) {
    throw new LlmProviderError("createAnthropicProvider requires fields.transport — no transport is selected by default");
  }
  if (!fields.model) {
    throw new LlmProviderError("createAnthropicProvider requires fields.model");
  }

  const { transport, model } = fields;
  const temperature = fields.temperature; // no default — see fields.temperature above
  const maxTokens = fields.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = fields.timeoutMs ?? 15000;

  return {
    name: `anthropic-${model}`,

    /**
     * Generates carousel copy for one deterministic prompt (built entirely
     * by carousel-prompt-builder.mjs, unchanged, before this function is
     * ever called). `context.topicPackage` is accepted for interface
     * parity with createMockProvider() but is not read here — the prompt
     * itself already carries everything this adapter needs; re-reading
     * the Topic Package would risk this adapter making its own generation
     * decisions independent of the prompt, which is exactly the "adapter
     * must not build prompts" boundary the brief draws.
     *
     * Returns a raw JSON string — `JSON.parse()`-able into
     * `{ slides: [...] }` — exactly matching createMockProvider()'s own
     * return contract, so carousel-content-validator.mjs (unchanged)
     * validates it identically regardless of which provider produced it.
     *
     * Throws whatever llm-transport-http.mjs / llm-response-validator.mjs
     * throw — every thrown error carries a `.retryable` boolean;
     * carousel-generator.mjs's own retry loop is what actually decides
     * whether to retry, not this function.
     */
    async generateCarousel(prompt) {
      const request = { model, prompt, temperature, maxTokens, toolName: TOOL_NAME };
      const rawResponse = await transport.send(request, { timeoutMs });
      const { slidesJson } = validateLlmTransportResponse(rawResponse, TOOL_NAME);
      return slidesJson;
    },
  };
}

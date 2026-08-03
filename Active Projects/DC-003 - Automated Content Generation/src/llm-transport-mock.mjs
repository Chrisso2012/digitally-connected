// DC-003-I019 — mock LLM transport. The ONLY transport automated tests
// use — no network dependency, fully deterministic, configurable to
// simulate every failure mode the adapter needs to handle. Never used
// outside tests/CLI local verification; the real endpoint is
// llm-transport-http.mjs. Mirrors DC-003-I006's
// renderer-transport-mock.mjs exactly.
//
// Returns the same raw Anthropic Messages API response shape the real
// HTTP transport would — a `tool_use` content block — so this mock
// exercises llm-response-validator.mjs's normalization boundary the same
// way the real transport does.

import { LlmAuthenticationError, LlmRateLimitError, LlmTimeoutError, LlmTransportError } from "./llm-provider-errors.mjs";

const DEFAULT_SLIDES = {
  slides: [
    { slide_type: "cover", content: { eyebrow_text: "MOCK", headline_text: "Mock headline", body_text: "Mock body" } },
    { slide_type: "content", content: { eyebrow_text: "MOCK", headline_text: "Mock headline", body_text: "Mock body", list_items: ["One", "Two", "Three"] } },
    { slide_type: "statistic", content: { eyebrow_text: "MOCK", stat_value: "42%", supporting_stat_text: "Mock stat text", stat_caption: "Mock caption" } },
    { slide_type: "quote", content: { quote_text: "Mock quote", attribution_name: "Mock person", attribution_role: "Mock role" } },
    { slide_type: "infographic", content: { eyebrow_text: "MOCK", headline_text: "Mock headline", steps: [
      { title: "Step one", description: "Mock" },
      { title: "Step two", description: "Mock" },
      { title: "Step three", description: "Mock" },
      { title: "Step four", description: "Mock" },
    ] } },
    { slide_type: "cta", content: { eyebrow_text: "MOCK", headline_text: "Mock headline", body_text: "Mock body", button_label: "Mock CTA" } },
  ],
};

/**
 * options.mode — "success" (default) | "timeout" | "transport-error" |
 *   "auth-error" | "rate-limit" | "malformed" | "refused" | "wrong-tool"
 * options.failuresBeforeSuccess — simulate `options.transientMode`
 *   (default "transport-error") for the first N calls, then behave per
 *   `mode` — used for retry-success tests.
 * options.slides — override the returned slides object (used by tests
 *   that need specific content).
 */
export function createMockLlmTransport(options = {}) {
  let calls = 0;
  const mode = options.mode ?? "success";
  const failuresBeforeSuccess = options.failuresBeforeSuccess ?? 0;

  return {
    name: "mock-llm-transport",
    callCount: () => calls,
    async send(request, sendOptions = {}) {
      calls += 1;
      const inTransientPhase = calls <= failuresBeforeSuccess;
      const effectiveMode = inTransientPhase ? options.transientMode ?? "transport-error" : mode;

      if (effectiveMode === "timeout") {
        throw new LlmTimeoutError(
          `mock LLM transport timed out after ${sendOptions.timeoutMs ?? "?"}ms`,
          sendOptions.timeoutMs ?? null
        );
      }
      if (effectiveMode === "transport-error") {
        throw new LlmTransportError("mock LLM transport network failure", new Error("ECONNRESET (simulated)"));
      }
      if (effectiveMode === "auth-error") {
        throw new LlmAuthenticationError("mock LLM transport rejected credentials (401, simulated)");
      }
      if (effectiveMode === "rate-limit") {
        throw new LlmRateLimitError("mock LLM transport reported a rate limit (429, simulated)", 1000);
      }
      if (effectiveMode === "malformed") {
        return { unexpected: "shape", no: "content array" };
      }
      if (effectiveMode === "refused") {
        return { id: "msg_mock_refused", type: "message", role: "assistant", content: [], model: request.model, stop_reason: "refusal" };
      }
      if (effectiveMode === "wrong-tool") {
        return {
          id: "msg_mock_wrongtool",
          type: "message",
          role: "assistant",
          content: [{ type: "tool_use", id: "tool_mock", name: "some_other_tool", input: {} }],
          model: request.model,
          stop_reason: "tool_use",
        };
      }

      return {
        id: `msg_mock_${String(calls).padStart(4, "0")}`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: `tool_mock_${String(calls).padStart(4, "0")}`,
            name: request.toolName,
            input: options.slides ?? DEFAULT_SLIDES,
          },
        ],
        model: request.model,
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    },
  };
}

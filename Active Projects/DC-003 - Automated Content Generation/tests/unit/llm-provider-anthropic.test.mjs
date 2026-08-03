import test from "node:test";
import assert from "node:assert/strict";
import { createAnthropicProvider } from "../../src/llm-provider-anthropic.mjs";
import { createMockLlmTransport } from "../../src/llm-transport-mock.mjs";
import { TOOL_NAME } from "../../src/llm-transport-http.mjs";
import {
  LlmProviderError,
  LlmAuthenticationError,
  LlmRateLimitError,
  LlmTimeoutError,
  LlmTransportError,
  LlmMalformedResponseError,
  LlmProviderRejectedError,
} from "../../src/llm-provider-errors.mjs";

// --- Construction preconditions ------------------------------------------

test("createAnthropicProvider requires a transport", () => {
  assert.throws(() => createAnthropicProvider({ model: "claude-sonnet-5" }), LlmProviderError);
});

test("createAnthropicProvider requires a model", () => {
  assert.throws(() => createAnthropicProvider({ transport: createMockLlmTransport() }), LlmProviderError);
});

test("provider.name includes the configured model", () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport(), model: "claude-sonnet-5" });
  assert.equal(provider.name, "anthropic-claude-sonnet-5");
});

// --- Successful structured response ---------------------------------------

test("a successful structured response returns a raw JSON string matching the mock provider's own contract", async () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport(), model: "claude-sonnet-5" });
  const result = await provider.generateCarousel("a deterministic prompt", { topicPackage: {} });
  assert.equal(typeof result, "string");
  const parsed = JSON.parse(result);
  assert.equal(Array.isArray(parsed.slides), true);
  assert.equal(parsed.slides.length, 6);
});

test("calls the transport exactly once per generateCarousel() invocation — no internal retry", async () => {
  const transport = createMockLlmTransport();
  const provider = createAnthropicProvider({ transport, model: "claude-sonnet-5" });
  await provider.generateCarousel("prompt", {});
  assert.equal(transport.callCount(), 1);
});

// --- Request construction --------------------------------------------------

test("request construction: model, temperature, maxTokens, prompt and toolName are all passed through to the transport", async () => {
  let observedRequest = null;
  const spyTransport = {
    name: "spy",
    async send(request) {
      observedRequest = request;
      return {
        content: [{ type: "tool_use", name: request.toolName, input: { slides: [] } }],
        stop_reason: "tool_use",
      };
    },
  };
  const provider = createAnthropicProvider({
    transport: spyTransport,
    model: "claude-test-model",
    temperature: 0,
    maxTokens: 1234,
    timeoutMs: 9999,
  });
  await provider.generateCarousel("the exact deterministic prompt text", {});
  assert.equal(observedRequest.model, "claude-test-model");
  assert.equal(observedRequest.temperature, 0);
  assert.equal(observedRequest.maxTokens, 1234);
  assert.equal(observedRequest.prompt, "the exact deterministic prompt text");
  assert.equal(observedRequest.toolName, TOOL_NAME);
});

test("timeoutMs is passed through to the transport's send() options, never hardcoded inside the adapter", async () => {
  let observedTimeout = null;
  const spyTransport = {
    name: "spy",
    async send(request, options) {
      observedTimeout = options.timeoutMs;
      return { content: [{ type: "tool_use", name: request.toolName, input: { slides: [] } }], stop_reason: "tool_use" };
    },
  };
  const provider = createAnthropicProvider({ transport: spyTransport, model: "claude-sonnet-5", timeoutMs: 4242 });
  await provider.generateCarousel("prompt", {});
  assert.equal(observedTimeout, 4242);
});

test("defaults: temperature 0 and maxTokens 4096 are used when not overridden", async () => {
  let observedRequest = null;
  const spyTransport = {
    name: "spy",
    async send(request) {
      observedRequest = request;
      return { content: [{ type: "tool_use", name: request.toolName, input: { slides: [] } }], stop_reason: "tool_use" };
    },
  };
  const provider = createAnthropicProvider({ transport: spyTransport, model: "claude-sonnet-5" });
  await provider.generateCarousel("prompt", {});
  assert.equal(observedRequest.temperature, 0);
  assert.equal(observedRequest.maxTokens, 4096);
});

// --- Failure modes, routed through the mock transport, each carrying the
// error type and .retryable classification carousel-generator.mjs's retry
// loop depends on ------------------------------------------------------

test("authentication failure surfaces as LlmAuthenticationError with retryable: false", async () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport({ mode: "auth-error" }), model: "claude-sonnet-5" });
  await assert.rejects(() => provider.generateCarousel("prompt", {}), (error) => {
    assert.ok(error instanceof LlmAuthenticationError);
    assert.equal(error.retryable, false);
    return true;
  });
});

test("timeout surfaces as LlmTimeoutError with retryable: true", async () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport({ mode: "timeout" }), model: "claude-sonnet-5" });
  await assert.rejects(() => provider.generateCarousel("prompt", {}), (error) => {
    assert.ok(error instanceof LlmTimeoutError);
    assert.equal(error.retryable, true);
    return true;
  });
});

test("rate limit surfaces as LlmRateLimitError with retryable: true", async () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport({ mode: "rate-limit" }), model: "claude-sonnet-5" });
  await assert.rejects(() => provider.generateCarousel("prompt", {}), (error) => {
    assert.ok(error instanceof LlmRateLimitError);
    assert.equal(error.retryable, true);
    return true;
  });
});

test("transport failure surfaces as LlmTransportError with retryable: true", async () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport({ mode: "transport-error" }), model: "claude-sonnet-5" });
  await assert.rejects(() => provider.generateCarousel("prompt", {}), (error) => {
    assert.ok(error instanceof LlmTransportError);
    assert.equal(error.retryable, true);
    return true;
  });
});

test("malformed response surfaces as LlmMalformedResponseError with retryable: false", async () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport({ mode: "malformed" }), model: "claude-sonnet-5" });
  await assert.rejects(() => provider.generateCarousel("prompt", {}), (error) => {
    assert.ok(error instanceof LlmMalformedResponseError);
    assert.equal(error.retryable, false);
    return true;
  });
});

test("provider refusal surfaces as LlmProviderRejectedError with retryable: false", async () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport({ mode: "refused" }), model: "claude-sonnet-5" });
  await assert.rejects(() => provider.generateCarousel("prompt", {}), (error) => {
    assert.ok(error instanceof LlmProviderRejectedError);
    assert.equal(error.retryable, false);
    return true;
  });
});

test("a wrong-tool response is treated as malformed (LlmMalformedResponseError), not silently accepted", async () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport({ mode: "wrong-tool" }), model: "claude-sonnet-5" });
  await assert.rejects(() => provider.generateCarousel("prompt", {}), LlmMalformedResponseError);
});

// --- Secret-safe diagnostics -------------------------------------------

test("thrown errors never mention the prompt text", async () => {
  const secretPrompt = "SECRET_PROMPT_MARKER_zx91";
  const provider = createAnthropicProvider({ transport: createMockLlmTransport({ mode: "malformed" }), model: "claude-sonnet-5" });
  try {
    await provider.generateCarousel(secretPrompt, {});
    assert.fail("expected to throw");
  } catch (error) {
    assert.doesNotMatch(error.message, new RegExp(secretPrompt));
    assert.doesNotMatch(JSON.stringify(error), new RegExp(secretPrompt));
  }
});

// --- Interface parity: context.topicPackage is accepted but never read ---

test("generateCarousel does not throw when context.topicPackage is entirely absent", async () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport(), model: "claude-sonnet-5" });
  const result = await provider.generateCarousel("prompt");
  assert.equal(typeof result, "string");
});

test("generateCarousel's output is identical regardless of what context.topicPackage contains — the adapter never reads it", async () => {
  const provider = createAnthropicProvider({ transport: createMockLlmTransport(), model: "claude-sonnet-5" });
  const resultA = await provider.generateCarousel("prompt", { topicPackage: { topic_id: "topic_A" } });
  const resultB = await provider.generateCarousel("prompt", { topicPackage: { topic_id: "topic_B_totally_different" } });
  assert.equal(resultA, resultB);
});

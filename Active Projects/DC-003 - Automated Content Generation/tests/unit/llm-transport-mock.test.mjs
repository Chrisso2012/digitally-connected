import test from "node:test";
import assert from "node:assert/strict";
import { createMockLlmTransport } from "../../src/llm-transport-mock.mjs";
import { LlmAuthenticationError, LlmRateLimitError, LlmTimeoutError, LlmTransportError } from "../../src/llm-provider-errors.mjs";

const REQUEST = { model: "claude-sonnet-5", prompt: "test prompt", temperature: 0, maxTokens: 4096, toolName: "return_carousel_slides" };

test("default mode resolves with a well-formed tool_use response matching the requested tool name", async () => {
  const transport = createMockLlmTransport();
  const response = await transport.send(REQUEST, { timeoutMs: 15000 });
  assert.equal(response.stop_reason, "tool_use");
  assert.equal(response.content[0].type, "tool_use");
  assert.equal(response.content[0].name, REQUEST.toolName);
  assert.equal(typeof response.content[0].input, "object");
  assert.equal(response.content[0].input.slides.length, 6);
});

test("timeout mode throws LlmTimeoutError", async () => {
  const transport = createMockLlmTransport({ mode: "timeout" });
  await assert.rejects(() => transport.send(REQUEST, { timeoutMs: 5000 }), LlmTimeoutError);
});

test("transport-error mode throws LlmTransportError", async () => {
  const transport = createMockLlmTransport({ mode: "transport-error" });
  await assert.rejects(() => transport.send(REQUEST, {}), LlmTransportError);
});

test("auth-error mode throws LlmAuthenticationError", async () => {
  const transport = createMockLlmTransport({ mode: "auth-error" });
  await assert.rejects(() => transport.send(REQUEST, {}), LlmAuthenticationError);
});

test("rate-limit mode throws LlmRateLimitError", async () => {
  const transport = createMockLlmTransport({ mode: "rate-limit" });
  await assert.rejects(() => transport.send(REQUEST, {}), LlmRateLimitError);
});

test("malformed mode resolves with a shape that has no usable content array", async () => {
  const transport = createMockLlmTransport({ mode: "malformed" });
  const response = await transport.send(REQUEST, {});
  assert.equal(Array.isArray(response.content), false);
});

test("refused mode resolves with stop_reason: refusal and empty content", async () => {
  const transport = createMockLlmTransport({ mode: "refused" });
  const response = await transport.send(REQUEST, {});
  assert.equal(response.stop_reason, "refusal");
  assert.deepEqual(response.content, []);
});

test("wrong-tool mode resolves with a tool_use block under a different tool name", async () => {
  const transport = createMockLlmTransport({ mode: "wrong-tool" });
  const response = await transport.send(REQUEST, {});
  assert.equal(response.content[0].type, "tool_use");
  assert.notEqual(response.content[0].name, REQUEST.toolName);
});

test("failuresBeforeSuccess simulates N transient failures then succeeds", async () => {
  const transport = createMockLlmTransport({ failuresBeforeSuccess: 2 });
  await assert.rejects(() => transport.send(REQUEST, {}), LlmTransportError);
  await assert.rejects(() => transport.send(REQUEST, {}), LlmTransportError);
  const response = await transport.send(REQUEST, {});
  assert.equal(response.stop_reason, "tool_use");
  assert.equal(transport.callCount(), 3);
});

test("callCount tracks the number of send() invocations", async () => {
  const transport = createMockLlmTransport();
  await transport.send(REQUEST, {});
  await transport.send(REQUEST, {});
  assert.equal(transport.callCount(), 2);
});

test("options.slides overrides the default returned slides", async () => {
  const customSlides = { slides: [{ slide_type: "cover", content: { headline_text: "Custom" } }] };
  const transport = createMockLlmTransport({ slides: customSlides });
  const response = await transport.send(REQUEST, {});
  assert.deepEqual(response.content[0].input, customSlides);
});

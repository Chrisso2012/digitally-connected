import test from "node:test";
import assert from "node:assert/strict";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { AuthenticationError, TimeoutError, TransportError } from "../../src/renderer-errors.mjs";

const REQUEST = { templateId: "748d17c5-c58e-48eb-9f12-434252a6d17f", layers: {}, format: "png" };

test("default mode resolves with a well-formed completed response", async () => {
  const transport = createMockTransport();
  const response = await transport.send(REQUEST, { timeoutMs: 15000 });
  assert.equal(response.status, "completed");
  assert.equal(typeof response.id, "string");
  assert.equal(typeof response.url, "string");
});

test("timeout mode throws TimeoutError", async () => {
  const transport = createMockTransport({ mode: "timeout" });
  await assert.rejects(() => transport.send(REQUEST, { timeoutMs: 5000 }), TimeoutError);
});

test("transport-error mode throws TransportError", async () => {
  const transport = createMockTransport({ mode: "transport-error" });
  await assert.rejects(() => transport.send(REQUEST, {}), TransportError);
});

test("auth-error mode throws AuthenticationError", async () => {
  const transport = createMockTransport({ mode: "auth-error" });
  await assert.rejects(() => transport.send(REQUEST, {}), AuthenticationError);
});

test("malformed mode resolves with a shape that has no id or status", async () => {
  const transport = createMockTransport({ mode: "malformed" });
  const response = await transport.send(REQUEST, {});
  assert.equal("id" in response, false);
  assert.equal("status" in response, false);
});

test("rejected mode resolves with a well-formed failed response", async () => {
  const transport = createMockTransport({ mode: "rejected" });
  const response = await transport.send(REQUEST, {});
  assert.equal(response.status, "failed");
  assert.equal(typeof response.id, "string");
});

test("failuresBeforeSuccess simulates N transient failures then succeeds", async () => {
  const transport = createMockTransport({ failuresBeforeSuccess: 2 });
  await assert.rejects(() => transport.send(REQUEST, {}), TransportError);
  await assert.rejects(() => transport.send(REQUEST, {}), TransportError);
  const response = await transport.send(REQUEST, {});
  assert.equal(response.status, "completed");
  assert.equal(transport.callCount(), 3);
});

test("callCount tracks the number of send() invocations", async () => {
  const transport = createMockTransport();
  await transport.send(REQUEST, {});
  await transport.send(REQUEST, {});
  assert.equal(transport.callCount(), 2);
});

// Unit tests for llm-transport-http.mjs. Like the rest of this codebase's
// automated suite, these NEVER reach the network: global.fetch is stubbed
// per-test with a deterministic fake and restored immediately afterward
// (see withStubFetch below). No test in this file makes a real HTTP
// request or requires network access.

import test from "node:test";
import assert from "node:assert/strict";
import { createHttpTransport, TOOL_NAME } from "../../src/llm-transport-http.mjs";
import {
  LlmConfigurationError,
  LlmAuthenticationError,
  LlmRateLimitError,
  LlmTransportError,
  LlmTimeoutError,
} from "../../src/llm-provider-errors.mjs";

const REQUEST = { model: "claude-sonnet-5", prompt: "test prompt", temperature: 0, maxTokens: 4096, toolName: TOOL_NAME };

async function withStubFetch(stubFetch, run) {
  const original = global.fetch;
  global.fetch = stubFetch;
  try {
    await run();
  } finally {
    global.fetch = original;
  }
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

// --- Configuration precondition -------------------------------------------

test("createHttpTransport throws LlmConfigurationError when apiKey is missing — no fetch is ever called", () => {
  let fetchCalled = false;
  const original = global.fetch;
  global.fetch = async () => {
    fetchCalled = true;
  };
  try {
    assert.throws(() => createHttpTransport({}), LlmConfigurationError);
    assert.throws(() => createHttpTransport({ apiKey: null }), LlmConfigurationError);
    assert.throws(() => createHttpTransport({ apiKey: "" }), LlmConfigurationError);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = original;
  }
});

test("TOOL_NAME is the exact tool name forced via tool_choice", () => {
  assert.equal(TOOL_NAME, "return_carousel_slides");
});

// --- Request construction --------------------------------------------------

test("POSTs to <baseUrl>/messages with the required headers and a tool-forcing structured-output body", () =>
  withStubFetch(
    async (url, init) => {
      assert.equal(url, "https://example.test/v1/messages");
      assert.equal(init.method, "POST");
      assert.equal(init.headers["x-api-key"], "sk-test-fake-key");
      assert.equal(init.headers["anthropic-version"], "2023-06-01");
      const body = JSON.parse(init.body);
      assert.equal(body.model, REQUEST.model);
      assert.equal(body.temperature, REQUEST.temperature);
      assert.equal(body.max_tokens, REQUEST.maxTokens);
      assert.equal(body.messages[0].content, REQUEST.prompt);
      assert.equal(body.tool_choice.type, "tool");
      assert.equal(body.tool_choice.name, TOOL_NAME);
      assert.equal(body.tools[0].name, TOOL_NAME);
      return jsonResponse(200, { content: [], stop_reason: "tool_use" });
    },
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key", baseUrl: "https://example.test/v1" });
      const result = await transport.send(REQUEST, { timeoutMs: 5000 });
      assert.deepEqual(result, { content: [], stop_reason: "tool_use" });
    }
  ));

test("a trailing slash on baseUrl does not produce a double slash in the request URL", () =>
  withStubFetch(
    async (url) => {
      assert.equal(url, "https://example.test/v1/messages");
      return jsonResponse(200, { ok: true });
    },
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key", baseUrl: "https://example.test/v1/" });
      await transport.send(REQUEST, {});
    }
  ));

// --- Error classification ---------------------------------------------

test("HTTP 401 surfaces as LlmAuthenticationError", () =>
  withStubFetch(
    async () => jsonResponse(401, { error: "unauthorized" }),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), LlmAuthenticationError);
    }
  ));

test("HTTP 403 surfaces as LlmAuthenticationError", () =>
  withStubFetch(
    async () => jsonResponse(403, {}),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), LlmAuthenticationError);
    }
  ));

test("HTTP 429 surfaces as LlmRateLimitError, reading retry-after when present", () =>
  withStubFetch(
    async () => jsonResponse(429, {}, { "retry-after": "2" }),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), (error) => {
        assert.ok(error instanceof LlmRateLimitError);
        assert.equal(error.retryAfterMs, 2000);
        return true;
      });
    }
  ));

test("HTTP 429 with no retry-after header still throws LlmRateLimitError, with retryAfterMs null", () =>
  withStubFetch(
    async () => jsonResponse(429, {}),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), (error) => {
        assert.ok(error instanceof LlmRateLimitError);
        assert.equal(error.retryAfterMs, null);
        return true;
      });
    }
  ));

test("HTTP 5xx surfaces as LlmTransportError", () =>
  withStubFetch(
    async () => jsonResponse(503, {}),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), LlmTransportError);
    }
  ));

test("another non-ok status (e.g. 400) surfaces as LlmTransportError", () =>
  withStubFetch(
    async () => jsonResponse(400, {}),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), LlmTransportError);
    }
  ));

test("a fetch rejection (network failure) surfaces as LlmTransportError", () =>
  withStubFetch(
    async () => {
      throw new Error("ECONNRESET simulated");
    },
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), LlmTransportError);
    }
  ));

test("an AbortError (timeout) surfaces as LlmTimeoutError carrying the configured timeoutMs", () =>
  withStubFetch(
    async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    },
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, { timeoutMs: 1234 }), (error) => {
        assert.ok(error instanceof LlmTimeoutError);
        assert.equal(error.timeoutMs, 1234);
        return true;
      });
    }
  ));

test("a response body that is not valid JSON surfaces as LlmTransportError", () =>
  withStubFetch(
    async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), LlmTransportError);
    }
  ));

// --- Secret-safe diagnostics -------------------------------------------

test("no thrown error ever includes the API key", () =>
  withStubFetch(
    async () => jsonResponse(401, {}),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-SUPER-SECRET-KEY-12345" });
      try {
        await transport.send(REQUEST, {});
        assert.fail("expected to throw");
      } catch (error) {
        assert.doesNotMatch(error.message, /sk-SUPER-SECRET-KEY-12345/);
        assert.doesNotMatch(JSON.stringify(error), /sk-SUPER-SECRET-KEY-12345/);
      }
    }
  ));

test("no thrown error ever includes the raw response body", () =>
  withStubFetch(
    async () => jsonResponse(500, { internal: "raw-body-marker-must-not-leak" }),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      try {
        await transport.send(REQUEST, {});
        assert.fail("expected to throw");
      } catch (error) {
        assert.doesNotMatch(error.message, /raw-body-marker-must-not-leak/);
      }
    }
  ));

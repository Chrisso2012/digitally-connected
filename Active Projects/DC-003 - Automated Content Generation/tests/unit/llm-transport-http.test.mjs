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
  LlmClientError,
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
    text: async () => JSON.stringify(body),
  };
}

// A response double for the safe-diagnostics tests, where the caller needs
// precise control over the raw body text and content-type independent of
// whatever `body` would JSON.stringify to (e.g. deliberately non-JSON text,
// or deliberately malformed JSON).
function rawResponse(status, bodyText, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => {
      throw new SyntaxError("rawResponse test double: json() should not be called on a non-ok response");
    },
    text: async () => bodyText,
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

// --- DC-003-I019.3: `temperature` omission (the Live Verification Gate's
// third live attempt was rejected — HTTP 400 invalid_request_error:
// "`temperature` is deprecated for this model" — because this transport
// used to send `temperature: 0` unconditionally). -------------------------

test("the request body omits \"temperature\" entirely when request.temperature is undefined", () =>
  withStubFetch(
    async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal("temperature" in body, false, "temperature must be absent from the body, not present as null/0");
      return jsonResponse(200, { content: [], stop_reason: "tool_use" });
    },
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      const requestWithoutTemperature = { model: "claude-sonnet-5", prompt: "test prompt", maxTokens: 4096, toolName: TOOL_NAME };
      await transport.send(requestWithoutTemperature, {});
    }
  ));

test("all other required fields remain present in the body when temperature is omitted", () =>
  withStubFetch(
    async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.model, "claude-sonnet-5");
      assert.equal(body.max_tokens, 4096);
      assert.equal(body.messages[0].role, "user");
      assert.equal(body.messages[0].content, "test prompt");
      return jsonResponse(200, { content: [], stop_reason: "tool_use" });
    },
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      const requestWithoutTemperature = { model: "claude-sonnet-5", prompt: "test prompt", maxTokens: 4096, toolName: TOOL_NAME };
      await transport.send(requestWithoutTemperature, {});
    }
  ));

test("structured tool output is still forced (tools + tool_choice) when temperature is omitted", () =>
  withStubFetch(
    async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.tool_choice.type, "tool");
      assert.equal(body.tool_choice.name, TOOL_NAME);
      assert.equal(body.tools.length, 1);
      assert.equal(body.tools[0].name, TOOL_NAME);
      assert.ok(body.tools[0].input_schema, "input_schema must still be present");
      return jsonResponse(200, { content: [], stop_reason: "tool_use" });
    },
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      const requestWithoutTemperature = { model: "claude-sonnet-5", prompt: "test prompt", maxTokens: 4096, toolName: TOOL_NAME };
      await transport.send(requestWithoutTemperature, {});
    }
  ));

test("an explicit temperature is still included in the body (opt-in override preserved)", () =>
  withStubFetch(
    async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.temperature, 0.7);
      return jsonResponse(200, { content: [], stop_reason: "tool_use" });
    },
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      const requestWithTemperature = { model: "claude-sonnet-5", prompt: "test prompt", temperature: 0.7, maxTokens: 4096, toolName: TOOL_NAME };
      await transport.send(requestWithTemperature, {});
    }
  ));

test("existing error classification is unaffected by temperature omission — HTTP 400 still surfaces LlmClientError with a safe diagnostic", () =>
  withStubFetch(
    async () =>
      rawResponse(400, JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "some other 400" } }), {
        "content-type": "application/json",
      }),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      const requestWithoutTemperature = { model: "claude-sonnet-5", prompt: "test prompt", maxTokens: 4096, toolName: TOOL_NAME };
      await assert.rejects(() => transport.send(requestWithoutTemperature, {}), (error) => {
        assert.ok(error instanceof LlmClientError);
        assert.equal(error.retryable, false);
        assert.equal(error.diagnostic.errorType, "invalid_request_error");
        return true;
      });
    }
  ));

test("existing retry behaviour is unaffected — timeout/5xx/429/401 classification is unchanged regardless of temperature", () =>
  withStubFetch(
    async () => jsonResponse(503, {}),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      const requestWithoutTemperature = { model: "claude-sonnet-5", prompt: "test prompt", maxTokens: 4096, toolName: TOOL_NAME };
      await assert.rejects(() => transport.send(requestWithoutTemperature, {}), (error) => {
        assert.ok(error instanceof LlmTransportError);
        assert.equal(error.retryable, true);
        return true;
      });
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

test("HTTP 400 surfaces as LlmClientError, not LlmTransportError, and is not retryable", () =>
  withStubFetch(
    async () => rawResponse(400, "", {}),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), (error) => {
        assert.ok(error instanceof LlmClientError);
        assert.equal(error.retryable, false);
        return true;
      });
    }
  ));

test("HTTP 400 with an Anthropic invalid_request_error body surfaces a full safe diagnostic", () =>
  withStubFetch(
    async () =>
      rawResponse(
        400,
        JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "model: field required" } }),
        { "content-type": "application/json", "request-id": "req_live_test_1" }
      ),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), (error) => {
        assert.ok(error instanceof LlmClientError);
        assert.deepEqual(error.diagnostic, {
          status: 400,
          errorType: "invalid_request_error",
          requestId: "req_live_test_1",
          message: "model: field required",
        });
        return true;
      });
    }
  ));

test("HTTP 400 with malformed JSON degrades to a minimal diagnostic rather than throwing a parse error", () =>
  withStubFetch(
    async () => rawResponse(400, "{ not valid json", { "content-type": "application/json" }),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), (error) => {
        assert.ok(error instanceof LlmClientError);
        assert.equal(error.diagnostic.status, 400);
        assert.equal(error.diagnostic.errorType, null);
        assert.equal(error.diagnostic.message, null);
        return true;
      });
    }
  ));

test("HTTP 400 with a non-JSON content-type never has its body parsed", () =>
  withStubFetch(
    async () => rawResponse(400, "<html>Bad Request: internal-detail-marker</html>", { "content-type": "text/html" }),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), (error) => {
        assert.ok(error instanceof LlmClientError);
        assert.equal(error.diagnostic.errorType, null);
        assert.equal(error.diagnostic.message, null);
        assert.doesNotMatch(JSON.stringify(error), /internal-detail-marker/);
        return true;
      });
    }
  ));

test("HTTP 400 request-id header is propagated into the diagnostic; absent yields null", () =>
  withStubFetch(
    async () => rawResponse(400, "", { "content-type": "application/json" }),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), (error) => {
        assert.equal(error.diagnostic.requestId, null);
        return true;
      });
    }
  ));

test("exactly one fetch call occurs for an HTTP 400 response", () => {
  let callCount = 0;
  return withStubFetch(
    async () => {
      callCount += 1;
      return rawResponse(400, "", {});
    },
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      await assert.rejects(() => transport.send(REQUEST, {}), LlmClientError);
      assert.equal(callCount, 1, "the HTTP transport must never internally retry a rejected request");
    }
  );
});

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

test("no LlmClientError (HTTP 400 path) ever includes the raw response body outside the sanitised message field", () =>
  withStubFetch(
    async () =>
      rawResponse(
        400,
        JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "short safe message" },
          extra_raw_field: "RAW_BODY_MARKER_MUST_NOT_LEAK",
        }),
        { "content-type": "application/json" }
      ),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      try {
        await transport.send(REQUEST, {});
        assert.fail("expected to throw");
      } catch (error) {
        assert.ok(error instanceof LlmClientError);
        assert.doesNotMatch(JSON.stringify(error), /RAW_BODY_MARKER_MUST_NOT_LEAK/);
        assert.doesNotMatch(error.message, /RAW_BODY_MARKER_MUST_NOT_LEAK/);
      }
    }
  ));

test("no thrown error ever includes the authorization header value", () =>
  withStubFetch(
    async () => rawResponse(400, "", {}),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key-header-marker" });
      try {
        await transport.send(REQUEST, {});
        assert.fail("expected to throw");
      } catch (error) {
        assert.doesNotMatch(JSON.stringify(error), /sk-test-fake-key-header-marker/);
      }
    }
  ));

test("no thrown error ever includes the request prompt", () =>
  withStubFetch(
    async () => rawResponse(400, "", {}),
    async () => {
      const transport = createHttpTransport({ apiKey: "sk-test-fake-key" });
      const request = { ...REQUEST, prompt: "SECRET_PROMPT_CONTENT_MARKER" };
      try {
        await transport.send(request, {});
        assert.fail("expected to throw");
      } catch (error) {
        assert.doesNotMatch(JSON.stringify(error), /SECRET_PROMPT_CONTENT_MARKER/);
      }
    }
  ));

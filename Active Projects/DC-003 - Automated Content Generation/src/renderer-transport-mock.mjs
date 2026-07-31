// DC-003-I006 — mock transport. The ONLY transport automated tests use —
// no network dependency, fully deterministic, configurable to simulate
// every failure mode the renderer needs to handle. Never used outside
// tests/CLI local verification; the real endpoint is renderer-transport-http.mjs.

import { AuthenticationError, TimeoutError, TransportError } from "./renderer-errors.mjs";

/**
 * options.mode — "success" (default) | "timeout" | "transport-error" |
 *   "auth-error" | "malformed" | "rejected"
 * options.failuresBeforeSuccess — simulate `options.transientMode` (default
 *   "transport-error") for the first N calls, then behave per `mode` —
 *   used for retry-success tests.
 * options.renderId — override the returned render id.
 */
export function createMockTransport(options = {}) {
  let calls = 0;
  const mode = options.mode ?? "success";
  const failuresBeforeSuccess = options.failuresBeforeSuccess ?? 0;

  return {
    name: "mock-transport",
    callCount: () => calls,
    async send(request, sendOptions = {}) {
      calls += 1;
      const inTransientPhase = calls <= failuresBeforeSuccess;
      const effectiveMode = inTransientPhase ? options.transientMode ?? "transport-error" : mode;

      if (effectiveMode === "timeout") {
        throw new TimeoutError(
          `mock transport timed out after ${sendOptions.timeoutMs ?? "?"}ms`,
          sendOptions.timeoutMs ?? null
        );
      }
      if (effectiveMode === "transport-error") {
        throw new TransportError("mock transport network failure", new Error("ECONNRESET (simulated)"));
      }
      if (effectiveMode === "auth-error") {
        throw new AuthenticationError("mock transport rejected credentials (401, simulated)");
      }
      if (effectiveMode === "malformed") {
        return { unexpected: "shape", no: "id or status field" };
      }
      if (effectiveMode === "rejected") {
        return {
          id: options.renderId ?? "render_mock_0001",
          status: "failed",
          error: "template layer mismatch (simulated)",
        };
      }

      return {
        id: options.renderId ?? `render_mock_${String(calls).padStart(4, "0")}`,
        status: "completed",
        url: `https://mock-templated.local/renders/${options.renderId ?? "mock"}.png`,
      };
    },
  };
}

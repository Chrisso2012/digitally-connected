// DC-003-I006 — HTTP transport. The only place in this codebase that
// speaks HTTP to Templated. Uses Node's built-in global fetch (Node 18+) —
// no new dependency. Never used by automated tests; see
// renderer-transport-mock.mjs for what tests actually run against, and
// README "Live verification procedure" for how this transport gets used.
//
// Endpoint path, request shape, and auth header below are based on
// Templated's public API conventions and the shape already confirmed via
// config/templates.json's layer format — they have NOT been exercised
// against a live request as part of this milestone (see the I006
// "Mock First" constraint). Confirm during live verification.

import { AuthenticationError, TimeoutError, TransportError, ValidationError } from "./renderer-errors.mjs";

/**
 * config: { apiKey, baseUrl }
 */
export function createHttpTransport(config) {
  if (!config?.apiKey) {
    throw new AuthenticationError("TEMPLATED_API_KEY is required to create the HTTP transport");
  }
  const baseUrl = (config.baseUrl ?? "https://api.templated.io/v1").replace(/\/+$/, "");

  return {
    name: "templated-http",
    async send(request, sendOptions = {}) {
      const timeoutMs = sendOptions.timeoutMs ?? 15000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response;
      try {
        response = await fetch(`${baseUrl}/render`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            template: request.templateId,
            layers: request.layers,
            format: request.format,
          }),
          signal: controller.signal,
        });
      } catch (cause) {
        if (cause.name === "AbortError") {
          throw new TimeoutError(`Templated render request timed out after ${timeoutMs}ms`, timeoutMs);
        }
        throw new TransportError(`Templated render request failed: ${cause.message}`, cause);
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError(`Templated rejected the API key (HTTP ${response.status})`);
      }
      if (!response.ok) {
        throw new TransportError(`Templated render request returned HTTP ${response.status}`, null);
      }

      let body;
      try {
        body = await response.json();
      } catch (cause) {
        throw new ValidationError(`Templated response was not valid JSON: ${cause.message}`, []);
      }
      return body;
    },
  };
}

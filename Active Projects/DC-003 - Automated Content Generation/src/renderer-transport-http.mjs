// DC-003-I006 — HTTP transport. The only place in this codebase that
// speaks HTTP to Templated. Uses Node's built-in global fetch (Node 18+) —
// no new dependency. Never used by automated tests; see
// renderer-transport-mock.mjs for what tests actually run against, and
// README "Live verification procedure" for how this transport gets used.
//
// Endpoint (POST https://api.templated.io/v1/render), request body shape
// ({ template, layers, format }), and Authorization: Bearer auth header
// below are CONFIRMED against Templated's official docs
// (https://templated.io/docs/authentication/,
// https://templated.io/docs/renders/create/) during live verification.
// Response shape was also confirmed there and turned out to differ from
// this module's original assumption — see renderer-response-validator.mjs's
// header comment for what changed and why. Not yet exercised against an
// actual live request as of this comment; that is the one remaining step.

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

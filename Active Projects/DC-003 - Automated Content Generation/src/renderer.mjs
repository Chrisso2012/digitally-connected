// DC-003-I006 — Renderer service.
//
// Templated Payload -> Renderer -> RenderResult
//
// Consumes only a validated Templated Payload Object (I005's output).
// Returns only an immutable RenderResult. Never exposes HTTP responses,
// fetch objects, authentication details, or any transport-specific
// structure to its caller — renderer-response-validator.mjs is the only
// place a raw transport response is inspected, and it never leaks past
// that boundary.
//
// Depends only on the transport abstraction, never on HTTP directly — see
// renderer-transport-mock.mjs / renderer-transport-http.mjs. There is no
// implicit default transport: a caller must explicitly choose one, so an
// automated test or a careless script can never accidentally reach a real
// endpoint.
//
// Retries are handled entirely by src/retry.mjs (the generic I004
// primitive, reused here unmodified) — no retry logic lives in this file.
//
// Retryability, hardened after the DC-003-I006 live-verification incident
// (three live calls fired instead of one, because a deterministic response-
// shape mismatch was treated as transient): only TimeoutError and
// TransportError are retried. AuthenticationError, ValidationError, and
// RenderRejected all propagate immediately on the first attempt — each
// represents a failure that will reproduce identically on retry, so
// retrying only wastes calls (and, against a real transport, quota).

import { withRetry } from "./retry.mjs";
import { validateTransportResponse } from "./renderer-response-validator.mjs";
import { createRenderResult } from "./render-result.mjs";
import { RendererError, AuthenticationError, RetryLimitExceeded } from "./renderer-errors.mjs";

function buildRenderRequest(payload) {
  return {
    templateId: payload.template_id,
    layers: payload.layers,
    format: payload.format,
  };
}

/**
 * Renders one Templated Payload Object through the given transport.
 *
 * options.transport — required. { name, send(request, { timeoutMs }) }.
 * options.maxAttempts — retry ceiling, default 3.
 * options.timeoutMs — per-attempt timeout passed to the transport, default
 *   15000. Always comes from configuration (renderer-config.mjs, ultimately
 *   TEMPLATED_REQUEST_TIMEOUT_MS) or an explicit override — never hardcoded
 *   inside a code path with no way to change it.
 * options.now — override the clock (used by tests).
 *
 * Throws AuthenticationError, ValidationError, or RenderRejected
 * immediately, bypassing retry entirely — none of these become a different
 * outcome on a second attempt with the same request. Throws
 * RetryLimitExceeded only if every retryable attempt (timeout or transport
 * failure) is exhausted.
 */
export async function renderTemplatedPayload(payload, options = {}) {
  if (!options.transport) {
    throw new RendererError("renderTemplatedPayload requires options.transport — no transport is selected by default");
  }
  if (!payload?.template_id || !payload?.layers || !payload?.format) {
    throw new RendererError(
      "renderTemplatedPayload requires a Templated Payload Object with template_id, layers, and format"
    );
  }

  const { transport } = options;
  const maxAttempts = options.maxAttempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 15000;
  const now = options.now ?? (() => new Date().toISOString());

  const requestedAt = now();
  const request = buildRenderRequest(payload);

  const outcome = await withRetry(
    async () => {
      let rawResponse;
      try {
        rawResponse = await transport.send(request, { timeoutMs });
      } catch (error) {
        if (error instanceof AuthenticationError) throw error; // non-retryable
        return { ok: false, error };
      }

      // Throws ValidationError or RenderRejected — both non-retryable, so
      // deliberately not caught here; they propagate straight out of
      // withRetry after exactly this one transport call.
      const normalized = validateTransportResponse(rawResponse);
      return { ok: true, normalized };
    },
    { maxAttempts }
  );

  if (!outcome.ok) {
    throw new RetryLimitExceeded(outcome.attempts, maxAttempts);
  }

  const completedAt = now();
  return createRenderResult({
    renderId: outcome.result.normalized.id,
    status: outcome.result.normalized.status,
    imageUrl: outcome.result.normalized.imageUrl,
    templateId: payload.template_id,
    slideType: payload.slide_type,
    provider: transport.name,
    requestedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(requestedAt),
  });
}

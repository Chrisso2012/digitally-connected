// DC-003-I006 — validates a transport's raw response before it's allowed
// anywhere near RenderResult construction. External responses (from any
// transport, mock or HTTP) are never trusted directly — this is the one
// boundary every response, regardless of transport, must cross.
//
// Status inference note (added during live verification, before any live
// call was made): Templated's confirmed, documented synchronous
// create-render response — { id, url, storage_url, width, height, format,
// templateId, templateName, createdAt, externalId } — carries NO explicit
// "status" field. A 200 response with an id and url IS the completion
// signal (renders resolve in ~2s synchronously); there is no separate
// "processing" response shape documented for this endpoint. The mock
// transport still uses an explicit status field (matching the shape a
// future polling/get_render endpoint would need), so both shapes are
// accepted here: explicit status wins when present; otherwise status is
// inferred from whether a url was returned.
//
// Non-retryable, hardened after the DC-003-I006 live-verification incident
// (see README "Live-verification safety rule"): a shape mismatch here is
// deterministic — the same malformed response will recur on every retry of
// the same request, so ValidationError is thrown and never treated as a
// transient failure by renderer.mjs.
//
// Diagnostics never include the raw response body, the API key, or any
// authorization header — each issue carries only a field path, what was
// expected, and a safe type/reason descriptor of what was received (never
// the actual value, except `status`, a short closed-enum string with no
// sensitivity).

import { ValidationError, RenderRejected } from "./renderer-errors.mjs";
import { RENDER_STATUSES } from "./render-result.mjs";

function describeReceived(value) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "string" && value.trim() === "") return "empty string";
  return typeof value;
}

function issue(field, expected, received) {
  return { field, expected, received, message: `${field}: expected ${expected}, received ${received}` };
}

/**
 * Validates and normalizes a raw transport response into
 * { id, status, imageUrl }.
 *
 * Throws ValidationError if the response's shape can't be trusted at all
 * (not an object, missing/invalid id, invalid explicit status) — NOT
 * retried; see the module header for why.
 *
 * Throws RenderRejected if the response is well-formed but reports a
 * terminal "failed" render — also NOT retried, since Templated understood
 * the request and rejected it; retrying the same payload would fail again.
 */
export function validateTransportResponse(rawResponse) {
  if (rawResponse === null || typeof rawResponse !== "object" || Array.isArray(rawResponse)) {
    throw new ValidationError("Transport response is not a JSON object", [
      issue("(root)", "object", Array.isArray(rawResponse) ? "array" : describeReceived(rawResponse)),
    ]);
  }

  const issues = [];
  if (typeof rawResponse.id !== "string" || rawResponse.id.trim() === "") {
    issues.push(issue("id", "non-empty string", describeReceived(rawResponse.id)));
  }
  if (rawResponse.url !== undefined && rawResponse.url !== null && typeof rawResponse.url !== "string") {
    issues.push(issue("url", "string when present", describeReceived(rawResponse.url)));
  }

  const hasExplicitStatus = rawResponse.status !== undefined;
  if (hasExplicitStatus && !RENDER_STATUSES.includes(rawResponse.status)) {
    // status is a short, non-sensitive closed-enum string — safe to show
    // verbatim, unlike the type-only descriptors used for id/url above.
    issues.push(
      issue(
        "status",
        `one of ${RENDER_STATUSES.join(", ")}`,
        typeof rawResponse.status === "string" ? `"${rawResponse.status}"` : describeReceived(rawResponse.status)
      )
    );
  }
  if (issues.length > 0) {
    throw new ValidationError(`Transport response failed validation with ${issues.length} issue(s)`, issues);
  }

  // Infer status only when the transport didn't provide one explicitly —
  // matches Templated's confirmed synchronous create-render shape.
  const hasUrl = typeof rawResponse.url === "string" && rawResponse.url.trim() !== "";
  const status = hasExplicitStatus ? rawResponse.status : hasUrl ? "completed" : "processing";

  if (status === "failed") {
    throw new RenderRejected(
      `Templated rejected the render${rawResponse.error ? `: ${rawResponse.error}` : ""}`,
      rawResponse.id,
      rawResponse.error ?? null
    );
  }

  return { id: rawResponse.id, status, imageUrl: rawResponse.url ?? null };
}

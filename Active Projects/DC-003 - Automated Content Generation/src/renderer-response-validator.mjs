// DC-003-I006 — validates a transport's raw response before it's allowed
// anywhere near RenderResult construction. External responses (from any
// transport, mock or HTTP) are never trusted directly — this is the one
// boundary every response, regardless of transport, must cross.
//
// Provider status contract (corrective pass after the live-verification
// incident): Templated's official docs (https://templated.io/docs/renders/
// — "The render object") state: "The current status of the render: PENDING,
// COMPLETED or FAILED. Initially the status is PENDING." — all three
// documented values are UPPERCASE, and there is no documented PROCESSING
// value. The one authorized live call's response carried `status:
// "COMPLETED"`, matching the docs exactly — the validator, not Templated,
// was wrong (it only accepted lowercase). The earlier note that the
// synchronous create-render response "carries no status field at all" was
// based on that endpoint's own abbreviated example, which happens to omit a
// field the underlying render object always documents — not a sign that
// Templated omits status in practice.
//
// PROVIDER_STATUS_MAP is the one normalization boundary: it validates the
// documented uppercase provider contract and maps it onto this codebase's
// canonical lowercase internal vocabulary (RENDER_STATUSES, render-result.mjs)
// so every downstream consumer (RenderResult, the CLI, future callers) only
// ever sees `pending` / `processing` / `completed` / `failed`, never a
// provider-specific casing. `processing` has no provider-side counterpart —
// it exists purely as this codebase's inference for a response shape with
// neither an explicit status nor a url (what a future polling/get_render
// call might return before completion), never as a value accepted from the
// wire itself. Deliberately not broadened beyond what the docs confirm.
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

// Keys are exactly what Templated documents on the wire (uppercase, no
// PROCESSING). Values are this codebase's canonical internal vocabulary.
const PROVIDER_STATUS_MAP = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
};

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
 * { id, status, imageUrl }. `status` on the returned object is always this
 * codebase's canonical lowercase vocabulary, regardless of the uppercase
 * casing Templated sends on the wire — see PROVIDER_STATUS_MAP above.
 *
 * Throws ValidationError if the response's shape can't be trusted at all
 * (not an object, missing/invalid id, invalid/undocumented explicit status)
 * — NOT retried; see the module header for why.
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
  if (hasExplicitStatus && !(rawResponse.status in PROVIDER_STATUS_MAP)) {
    // status is a short, non-sensitive closed-enum string — safe to show
    // verbatim, unlike the type-only descriptors used for id/url above.
    issues.push(
      issue(
        "status",
        `one of ${Object.keys(PROVIDER_STATUS_MAP).join(", ")} (Templated's documented provider contract)`,
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
  const status = hasExplicitStatus ? PROVIDER_STATUS_MAP[rawResponse.status] : hasUrl ? "completed" : "processing";

  if (status === "failed") {
    throw new RenderRejected(
      `Templated rejected the render${rawResponse.error ? `: ${rawResponse.error}` : ""}`,
      rawResponse.id,
      rawResponse.error ?? null
    );
  }

  return { id: rawResponse.id, status, imageUrl: rawResponse.url ?? null };
}

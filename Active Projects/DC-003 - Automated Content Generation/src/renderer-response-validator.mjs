// DC-003-I006 — validates a transport's raw response before it's allowed
// anywhere near RenderResult construction. External responses (from any
// transport, mock or HTTP) are never trusted directly — this is the one
// boundary every response, regardless of transport, must cross.

import { ValidationError, RenderRejected } from "./renderer-errors.mjs";
import { RENDER_STATUSES } from "./render-result.mjs";

/**
 * Validates and normalizes a raw transport response into
 * { id, status, imageUrl }.
 *
 * Throws ValidationError if the response's shape can't be trusted at all
 * (not an object, missing/invalid id or status) — this is retryable, since
 * a malformed response could be transient.
 *
 * Throws RenderRejected if the response is well-formed but reports a
 * terminal "failed" render — this is NOT retryable, since Templated
 * understood the request and rejected it; retrying the same payload would
 * fail again.
 */
export function validateTransportResponse(rawResponse) {
  if (rawResponse === null || typeof rawResponse !== "object" || Array.isArray(rawResponse)) {
    throw new ValidationError("Transport response is not a JSON object", []);
  }

  const issues = [];
  if (typeof rawResponse.id !== "string" || rawResponse.id.trim() === "") {
    issues.push({ field: "id", message: "must be a non-empty string" });
  }
  if (!RENDER_STATUSES.includes(rawResponse.status)) {
    issues.push({
      field: "status",
      message: `must be one of ${RENDER_STATUSES.join(", ")}, got ${JSON.stringify(rawResponse.status)}`,
    });
  }
  if (rawResponse.url !== undefined && rawResponse.url !== null && typeof rawResponse.url !== "string") {
    issues.push({ field: "url", message: "must be a string when present" });
  }
  if (issues.length > 0) {
    throw new ValidationError(`Transport response failed validation with ${issues.length} issue(s)`, issues);
  }

  if (rawResponse.status === "failed") {
    throw new RenderRejected(
      `Templated rejected the render${rawResponse.error ? `: ${rawResponse.error}` : ""}`,
      rawResponse.id,
      rawResponse.error ?? null
    );
  }

  return { id: rawResponse.id, status: rawResponse.status, imageUrl: rawResponse.url ?? null };
}

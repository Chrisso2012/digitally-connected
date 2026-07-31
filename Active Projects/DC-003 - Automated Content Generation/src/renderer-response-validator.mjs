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

import { ValidationError, RenderRejected } from "./renderer-errors.mjs";
import { RENDER_STATUSES } from "./render-result.mjs";

/**
 * Validates and normalizes a raw transport response into
 * { id, status, imageUrl }.
 *
 * Throws ValidationError if the response's shape can't be trusted at all
 * (not an object, missing/invalid id, invalid explicit status) — this is
 * retryable, since a malformed response could be transient.
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
  if (rawResponse.url !== undefined && rawResponse.url !== null && typeof rawResponse.url !== "string") {
    issues.push({ field: "url", message: "must be a string when present" });
  }

  const hasExplicitStatus = rawResponse.status !== undefined;
  if (hasExplicitStatus && !RENDER_STATUSES.includes(rawResponse.status)) {
    issues.push({
      field: "status",
      message: `must be one of ${RENDER_STATUSES.join(", ")}, got ${JSON.stringify(rawResponse.status)}`,
    });
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

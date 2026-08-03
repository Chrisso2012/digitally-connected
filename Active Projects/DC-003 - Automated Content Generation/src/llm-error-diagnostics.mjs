// DC-003-I019.1 — safe, secret-free diagnostics for a rejected Anthropic
// HTTP response. Built after the I019 Live Verification Gate's first live
// attempt failed with an undiagnosable HTTP 400: llm-transport-http.mjs
// deliberately never read the response body on a non-ok status, so the
// only signal available was the bare status code. See README "Live
// Verification Gate incident (DC-003-I019.1)" for the full account.
//
// This module's one job: turn a rejected response into a small, bounded
// object — { status, errorType, requestId, message } — safe to log, print,
// or hand to a human, without ever exposing the raw response body, the API
// key, an authorization header, the request payload/prompt, tool
// input/output content, or a stack trace. Every field except `status` may
// be `null` when the body doesn't match the expected shape; this module
// never throws and never guesses at an unfamiliar shape — anything it
// doesn't recognize degrades to a minimal diagnostic rather than risking a
// misparse of something sensitive.
//
// Body parsing only happens when the response's own `content-type` header
// declares JSON — a non-JSON content-type (or no header at all) is treated
// as opaque and never parsed, matching Anthropic's own documented error
// envelope (https://docs.anthropic.com/en/api/errors): `{ type: "error",
// error: { type, message } }`.

const MAX_MESSAGE_LENGTH = 300;

// Defense in depth: Anthropic's own error messages are not expected to
// contain a credential, but this redaction runs regardless, in case a
// proxy, gateway, or future API version ever echoes something secret-like
// back in an error body. Matches long bearer-style tokens and Anthropic-
// style API key prefixes; deliberately broad rather than trying to
// enumerate every provider's key format.
const SECRET_LIKE_PATTERN = /sk-[A-Za-z0-9_-]{10,}|bearer\s+[A-Za-z0-9._-]{10,}|[A-Za-z0-9_-]{32,}/gi;

function redact(text) {
  return text.replace(SECRET_LIKE_PATTERN, "[REDACTED]");
}

function sanitizeMessage(message) {
  if (typeof message !== "string" || message.trim() === "") {
    return null;
  }
  const redacted = redact(message);
  return redacted.length > MAX_MESSAGE_LENGTH ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…` : redacted;
}

function extractRequestId(response) {
  return response.headers.get("request-id") ?? response.headers.get("anthropic-request-id") ?? null;
}

function isJsonContentType(response) {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("application/json");
}

/**
 * Builds a safe diagnostic object from a rejected Anthropic response.
 *
 * `response` — the fetch Response (or a test double exposing `.status` and
 *   `.headers.get(name)`); only its status and headers are read here.
 * `bodyText` — the response body already read as text by the caller. This
 *   module never reads the response stream itself — the caller decides
 *   exactly when and whether a body is read, and remains the only place a
 *   raw body value exists, however briefly, before this function reduces
 *   it to the bounded shape below.
 *
 * Returns `{ status, errorType, requestId, message }`. `errorType` and
 * `message` are `null` whenever the content-type isn't JSON, the body
 * isn't valid JSON, or the parsed body doesn't match Anthropic's
 * documented `{ type: "error", error: { type, message } }` shape —
 * malformed or unexpected input always degrades to a minimal diagnostic,
 * it never throws.
 */
export function buildSafeDiagnostic(response, bodyText) {
  const status = response.status;
  const requestId = extractRequestId(response);
  const minimal = { status, errorType: null, requestId, message: null };

  if (!isJsonContentType(response) || typeof bodyText !== "string" || bodyText.trim() === "") {
    return minimal;
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return minimal;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return minimal;
  }

  const errorField = parsed.error;
  if (errorField === null || typeof errorField !== "object" || Array.isArray(errorField)) {
    return minimal;
  }

  const errorType = typeof errorField.type === "string" && errorField.type.trim() !== "" ? errorField.type : null;
  return { status, errorType, requestId, message: sanitizeMessage(errorField.message) };
}

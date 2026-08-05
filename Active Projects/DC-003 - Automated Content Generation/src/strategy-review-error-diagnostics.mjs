// DC-003-I029.3 — safe, secret-free diagnostics for a rejected OpenAI
// response. Mirrors llm-error-diagnostics.mjs's own discipline (I019.1)
// exactly, adapted to OpenAI's own documented error envelope
// (`{ error: { message, type, param, code } }`) and request-id header
// (`x-request-id`). Never exposes the raw response body, API key,
// authorization header, request payload/instruction, or a stack trace.

const MAX_MESSAGE_LENGTH = 300;

// Defense in depth — OpenAI keys are shaped "sk-...", but this redaction
// runs regardless in case a proxy/gateway ever echoes something
// secret-like back in an error body.
const SECRET_LIKE_PATTERN = /sk-[A-Za-z0-9_-]{10,}|bearer\s+[A-Za-z0-9._-]{10,}|[A-Za-z0-9_-]{32,}/gi;

function redact(text) {
  return text.replace(SECRET_LIKE_PATTERN, "[REDACTED]");
}

function sanitizeMessage(message) {
  if (typeof message !== "string" || message.trim() === "") return null;
  const redacted = redact(message);
  return redacted.length > MAX_MESSAGE_LENGTH ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…` : redacted;
}

function isJsonContentType(response) {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("application/json");
}

/**
 * Builds a safe diagnostic object from a rejected OpenAI response.
 * `bodyText` must already have been read by the caller as text — this
 * module never reads the response stream itself. Never throws; anything
 * unrecognized degrades to a minimal diagnostic rather than risking a
 * misparse of something sensitive.
 */
export function buildOpenAiSafeDiagnostic(response, bodyText) {
  const status = response.status;
  const requestId = response.headers.get("x-request-id") ?? null;
  const minimal = { status, errorType: null, code: null, requestId, message: null };

  if (!isJsonContentType(response) || typeof bodyText !== "string" || bodyText.trim() === "") {
    return minimal;
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return minimal;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return minimal;

  const errorField = parsed.error;
  if (errorField === null || typeof errorField !== "object" || Array.isArray(errorField)) return minimal;

  const errorType = typeof errorField.type === "string" && errorField.type.trim() !== "" ? errorField.type : null;
  const code = typeof errorField.code === "string" && errorField.code.trim() !== "" ? errorField.code : null;
  return { status, errorType, code, requestId, message: sanitizeMessage(errorField.message) };
}

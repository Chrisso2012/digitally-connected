// DC-003-I022 — structured errors for the Production Asset Publisher
// Adapter/Service. Mirrors production-asset-export-errors.mjs's own
// discipline exactly: every message here is written on the assumption it
// may be shown to an external caller (a CLI user) — none of them ever
// interpolate a raw filesystem path, a raw Node error message, a stack
// trace, an access token/refresh token/client secret, or a raw HTTP
// response body. Only already-public identifiers (carousel_id, a
// filename) are ever named.

/**
 * A caller handed executeProductionAssetPublish() something that doesn't
 * implement the Publisher Adapter shape: { name: string,
 * publishPackage(assetPackagePath, options) }.
 */
export class InvalidPublisherAdapterError extends Error {
  constructor() {
    super("A Production Asset Publisher adapter must be shaped { name: string, publishPackage(assetPackagePath, options) }");
    this.name = "InvalidPublisherAdapterError";
  }
}

/**
 * `assetPackagePath` does not point at a completed I021 export: either the
 * directory doesn't exist, or its own metadata.json is missing / not
 * valid JSON / missing required fields. This service never publishes a
 * partial or non-existent package.
 */
export class InvalidAssetPackageError extends Error {
  constructor(assetPackagePath, reason) {
    super(`"${assetPackagePath}" is not a completed Production Asset Package — ${reason}`);
    this.name = "InvalidAssetPackageError";
  }
}

/**
 * Required configuration (client ID/secret, refresh token, root folder
 * ID) is missing — thrown at adapter construction time, before any
 * request is ever attempted. Never retryable: the same missing
 * configuration will be missing again immediately.
 */
export class PublisherConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PublisherConfigurationError";
  }
}

/**
 * Google rejected the credentials — a failed OAuth2 token refresh, or the
 * Drive API itself returning HTTP 401/403. Never retryable: the same
 * credentials will be rejected again identically.
 */
export class PublisherAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PublisherAuthenticationError";
  }
}

/**
 * A network-level failure, or a Drive API 5xx response — transient by
 * nature.
 */
export class PublisherTransportError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "PublisherTransportError";
  }
}

/**
 * The request did not complete within the configured timeout.
 */
export class PublisherTimeoutError extends Error {
  constructor(message, timeoutMs) {
    super(message);
    this.name = "PublisherTimeoutError";
    this.timeoutMs = timeoutMs ?? null;
  }
}

/**
 * Google Drive rejected the request itself — an HTTP 4xx response other
 * than 401/403/429. A request-construction problem, deterministic, so
 * never retried. Carries a `diagnostic` object ({ status, reason, message,
 * requestId }) built the same safe way DC-003-I019.1's
 * llm-error-diagnostics.mjs already established for Anthropic — never the
 * raw response body, headers, or access token.
 */
export class PublisherClientError extends Error {
  constructor(message, diagnostic = null) {
    super(message);
    this.name = "PublisherClientError";
    this.diagnostic = diagnostic;
  }
}

/**
 * Google Drive reported a rate limit (HTTP 429).
 */
export class PublisherRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "PublisherRateLimitError";
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

/**
 * The campaign folder already contains one or more of this package's
 * filenames, and `--replace` was not supplied. Per Strategy Office's own
 * "fail by default unless --replace" recommendation — never a silent
 * overwrite, never an automatic "(2)" rename.
 */
export class DuplicatePackageError extends Error {
  constructor(carouselId, existingFilenames) {
    super(`A package for "${carouselId}" already exists in the destination Drive folder (${existingFilenames.length} matching file(s)) — pass --replace to overwrite it`);
    this.name = "DuplicatePackageError";
    this.carouselId = carouselId;
    this.existingFilenames = existingFilenames;
  }
}

/**
 * One specific file failed to upload — the filename is named (already
 * public, part of the package's own known structure); never the raw
 * response body.
 */
export class PublisherUploadError extends Error {
  constructor(filename, reason, cause) {
    super(`Failed to upload "${filename}" — ${reason}`, { cause });
    this.name = "PublisherUploadError";
    this.filename = filename;
  }
}

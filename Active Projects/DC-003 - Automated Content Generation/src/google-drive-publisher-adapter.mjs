// DC-003-I022 — Google Drive Publisher Adapter: the one
// production-asset-publisher-adapter.mjs implementation this milestone
// ships. Uploads an already-completed I021 export package (six PNGs +
// metadata.json, read from a local directory) into a configured Google
// Drive folder. Uses Node's built-in global fetch (Node 18+) — no new
// dependency, no `googleapis` SDK — the same choice DC-003-I006/I019/I021
// already made for their own HTTP integrations.
//
// Authentication: a standard OAuth2 refresh-token exchange
// (google-drive-publisher-config.mjs's clientId/clientSecret/
// refreshToken) against Google's token endpoint, then Bearer-token calls
// against the Drive API v3 (https://developers.google.com/drive/api/v3/reference).
// Endpoint shapes below are built directly from Google's published API
// reference — like DC-003-I006's renderer-transport-http.mjs before its
// own first live call, they are NOT yet exercised against a real request
// as of this milestone's delivery; see README "Google Drive Publisher —
// Live Verification Gate" for the exact procedure once approved.
//
// Folder structure (per Strategy Office's own recommendation, "Open
// Questions for Strategy Office" in the I022 brief): one campaign
// subfolder per carousel_id, created directly under the configured
// GOOGLE_DRIVE_ROOT_FOLDER_ID — `<root>/<carousel_id>/`. No human-readable
// naming (e.g. the article title) is introduced here — deliberately
// deferred to a future Content Lineage enhancement, once Finished
// Carousel Objects legitimately carry a source asset ID and title (see
// README "Article title — not currently on the Finished Carousel Object"
// under I021 for why that data isn't available yet).
//
// Duplicate handling: before uploading, this adapter lists the campaign
// folder's existing files. If any of the seven expected filenames already
// exist there and `options.replace` is not `true`, it throws
// DuplicatePackageError immediately — no upload of any kind is attempted.
// With `options.replace: true`, an existing file with a matching name is
// updated in place (its Drive fileId is reused, only its content changes)
// rather than a new, duplicate file being created — "replace," not
// "duplicate-then-orphan-the-old-one."
//
// Never modifies the LOCAL asset package: every file is only ever read
// (readFileSync), never written to, moved, or deleted — review criterion
// 5 ("Existing packages are never modified during publishing").
//
// Stops immediately on the first upload failure — matches the
// stop-on-first-failure discipline every other adapter in this codebase
// already follows (I006's renderer, I021's export adapter).

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { withRetry } from "./retry.mjs";
import {
  PublisherConfigurationError,
  PublisherAuthenticationError,
  PublisherTransportError,
  PublisherTimeoutError,
  PublisherClientError,
  PublisherRateLimitError,
  DuplicatePackageError,
  PublisherUploadError,
} from "./production-asset-publisher-errors.mjs";

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const MIME_TYPES_BY_EXTENSION = { ".png": "image/png", ".json": "application/json" };

const MAX_MESSAGE_LENGTH = 300;
// Defense in depth, same discipline DC-003-I019.1's llm-error-diagnostics.mjs
// already established: Google's own error messages aren't expected to
// contain a credential, but this redaction runs regardless.
const SECRET_LIKE_PATTERN = /ya29\.[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{32,}/gi;

function redact(text) {
  return text.replace(SECRET_LIKE_PATTERN, "[REDACTED]");
}

function sanitizeMessage(message) {
  if (typeof message !== "string" || message.trim() === "") return null;
  const redacted = redact(message);
  return redacted.length > MAX_MESSAGE_LENGTH ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…` : redacted;
}

// Builds a safe diagnostic from a rejected Drive API response — same
// "only parse JSON when the content-type says so, degrade to a minimal
// diagnostic on anything unexpected, never throw" discipline
// DC-003-I019.1's buildSafeDiagnostic() already established for Anthropic.
// Google's documented error envelope
// (https://developers.google.com/drive/api/guides/handle-errors) is
// `{ error: { code, message, errors: [{ reason, message }] } }`.
function buildSafeDriveDiagnostic(response, bodyText) {
  const status = response.status;
  const minimal = { status, reason: null, message: null };

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json") || typeof bodyText !== "string" || bodyText.trim() === "") {
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

  const firstDetail = Array.isArray(errorField.errors) && errorField.errors.length > 0 ? errorField.errors[0] : null;
  const reason = firstDetail && typeof firstDetail.reason === "string" ? firstDetail.reason : null;
  const message = typeof errorField.message === "string" ? errorField.message : firstDetail?.message;

  return { status, reason, message: sanitizeMessage(message) };
}

async function readErrorBodyText(response) {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

// One low-level HTTP call against a Drive (or OAuth token) endpoint,
// classifying the response into this module's own error hierarchy. Never
// retried here — retry, where it happens at all in this adapter, is the
// caller's own explicit choice (see uploadOrReplaceFile() below), matching
// production-asset-export-adapter.mjs's own "adapter makes one attempt;
// retry is the caller's decision" precedent.
async function sendRequest(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (cause) {
    if (cause.name === "AbortError") {
      throw new PublisherTimeoutError(`Google Drive request timed out after ${timeoutMs}ms`, timeoutMs);
    }
    throw new PublisherTransportError(`Google Drive request failed: ${cause.message}`, cause);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new PublisherAuthenticationError(`Google Drive rejected the credentials (HTTP ${response.status})`);
  }
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    throw new PublisherRateLimitError("Google Drive reported a rate limit (HTTP 429)", retryAfterHeader ? Number(retryAfterHeader) * 1000 : null);
  }
  if (response.status >= 500) {
    throw new PublisherTransportError(`Google Drive returned a server error (HTTP ${response.status})`, null);
  }
  if (!response.ok) {
    const bodyText = await readErrorBodyText(response);
    const diagnostic = buildSafeDriveDiagnostic(response, bodyText);
    throw new PublisherClientError(`Google Drive rejected the request (HTTP ${response.status})`, diagnostic);
  }

  return response;
}

async function refreshAccessToken(config) {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new PublisherConfigurationError(
      "Google Drive publishing requires GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN"
    );
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await sendRequest(
    config.tokenUrl,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() },
    config.requestTimeoutMs
  );

  let parsed;
  try {
    parsed = await response.json();
  } catch (cause) {
    throw new PublisherTransportError(`Google token response was not valid JSON: ${cause.message}`, cause);
  }
  if (typeof parsed.access_token !== "string" || parsed.access_token.trim() === "") {
    throw new PublisherAuthenticationError("Google token response did not include an access_token");
  }
  return parsed.access_token;
}

function driveHeaders(accessToken, extra = {}) {
  return { authorization: `Bearer ${accessToken}`, ...extra };
}

function escapeDriveQueryValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFolder(config, accessToken, parentId, name) {
  const query = `'${escapeDriveQueryValue(parentId)}' in parents and name = '${escapeDriveQueryValue(name)}' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`;
  const url = `${config.apiBaseUrl}/drive/v3/files?${new URLSearchParams({ q: query, fields: "files(id,name)" })}`;
  const response = await sendRequest(url, { method: "GET", headers: driveHeaders(accessToken) }, config.requestTimeoutMs);
  const parsed = await response.json();
  const match = Array.isArray(parsed.files) ? parsed.files.find((f) => f.name === name) : null;
  return match?.id ?? null;
}

async function createFolder(config, accessToken, parentId, name) {
  const response = await sendRequest(
    `${config.apiBaseUrl}/drive/v3/files?${new URLSearchParams({ fields: "id,name,webViewLink" })}`,
    {
      method: "POST",
      headers: driveHeaders(accessToken, { "content-type": "application/json" }),
      body: JSON.stringify({ name, mimeType: DRIVE_FOLDER_MIME_TYPE, parents: [parentId] }),
    },
    config.requestTimeoutMs
  );
  const parsed = await response.json();
  return parsed.id;
}

async function findOrCreateCampaignFolder(config, accessToken, carouselId) {
  const existingId = await findFolder(config, accessToken, config.rootFolderId, carouselId);
  if (existingId) return existingId;
  return createFolder(config, accessToken, config.rootFolderId, carouselId);
}

async function listFilesInFolder(config, accessToken, folderId) {
  const query = `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`;
  const url = `${config.apiBaseUrl}/drive/v3/files?${new URLSearchParams({ q: query, fields: "files(id,name)" })}`;
  const response = await sendRequest(url, { method: "GET", headers: driveHeaders(accessToken) }, config.requestTimeoutMs);
  const parsed = await response.json();
  return Array.isArray(parsed.files) ? parsed.files : [];
}

function buildMultipartBody(boundary, metadata, fileBuffer, mimeType) {
  const head = Buffer.from(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`,
    "utf-8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf-8");
  return Buffer.concat([head, fileBuffer, tail]);
}

async function createFile(config, accessToken, folderId, filename, fileBuffer, mimeType) {
  const boundary = `dc003_i022_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const body = buildMultipartBody(boundary, { name: filename, parents: [folderId] }, fileBuffer, mimeType);
  const response = await sendRequest(
    `${config.apiBaseUrl}/upload/drive/v3/files?${new URLSearchParams({ uploadType: "multipart", fields: "id,name" })}`,
    { method: "POST", headers: driveHeaders(accessToken, { "content-type": `multipart/related; boundary=${boundary}` }), body },
    config.requestTimeoutMs
  );
  const parsed = await response.json();
  return parsed.id;
}

async function updateFileMedia(config, accessToken, fileId, fileBuffer, mimeType) {
  const response = await sendRequest(
    `${config.apiBaseUrl}/upload/drive/v3/files/${encodeURIComponent(fileId)}?${new URLSearchParams({ uploadType: "media", fields: "id,name" })}`,
    { method: "PATCH", headers: driveHeaders(accessToken, { "content-type": mimeType }), body: fileBuffer },
    config.requestTimeoutMs
  );
  const parsed = await response.json();
  return parsed.id;
}

// Retryable only for the genuinely transient cases (timeout, transport,
// rate limit) — an auth/client/duplicate failure is deterministic and
// propagates immediately, bypassing retry, the same reasoning
// DC-003-I006/I019 already established for their own retry loops.
async function uploadOrReplaceFile(config, accessToken, { folderId, filename, fileBuffer, mimeType, existingFileId, maxAttempts }) {
  const outcome = await withRetry(
    async () => {
      try {
        const fileId = existingFileId
          ? await updateFileMedia(config, accessToken, existingFileId, fileBuffer, mimeType)
          : await createFile(config, accessToken, folderId, filename, fileBuffer, mimeType);
        return { ok: true, fileId };
      } catch (error) {
        if (error?.name === "PublisherAuthenticationError" || error?.name === "PublisherClientError") {
          throw error; // non-retryable
        }
        return { ok: false, error };
      }
    },
    { maxAttempts: maxAttempts ?? 1 }
  );

  if (!outcome.ok) {
    const lastAttempt = outcome.attempts[outcome.attempts.length - 1];
    throw new PublisherUploadError(filename, lastAttempt?.error?.message ?? "upload failed with no further detail", lastAttempt?.error);
  }
  return outcome.result.fileId;
}

function mimeTypeFor(filename) {
  return MIME_TYPES_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Builds the Google Drive Publisher Adapter.
 *
 * config — required, the return value of loadGoogleDrivePublisherConfig().
 *   Missing clientId/clientSecret/refreshToken throws
 *   PublisherConfigurationError at the first publishPackage() call (not at
 *   construction — mirrors createHttpTransport()'s own "fail fast, but
 *   only once a call is actually attempted" contract is a deliberate
 *   choice here since a mock-mode caller may construct this adapter but
 *   never invoke it).
 *
 * Returns { name, publishPackage }.
 */
export function createGoogleDrivePublisherAdapter(config) {
  return {
    name: "google-drive-publisher-adapter",

    /**
     * Publishes one already-completed I021 export package.
     *
     * assetPackagePath — required, a local directory containing
     *   metadata.json and the package's PNG files. Validating that this
     *   directory represents a genuinely completed export is the
     *   service's job (production-asset-publisher-service.mjs), not this
     *   adapter's — this function trusts it and reads metadata.json
     *   directly for the carousel_id it needs.
     * options.replace — boolean, default false. See this module's own
     *   header comment for duplicate-handling behaviour.
     * options.maxAttempts — attempt ceiling per file upload; default 1
     *   (no retry) — the caller (the CLI) is responsible for raising this
     *   only via an explicit override, never a config default, matching
     *   the DC-003-I006/I019 live-verification safety pattern.
     *
     * Never modifies any file already on the local filesystem — every
     * local file is only ever read.
     *
     * Throws PublisherConfigurationError if required config is missing.
     * Throws DuplicatePackageError if the destination already has
     * matching files and `options.replace` isn't true. Throws
     * PublisherUploadError on the first file that fails to upload — no
     * later file is attempted.
     */
    async publishPackage(assetPackagePath, options = {}) {
      // All required configuration is checked before any request of any
      // kind is made — the same "fail fast, zero network calls on
      // misconfiguration" discipline every live-capable CLI in this
      // codebase already follows (I006/I019/I020's own --live gates).
      if (!config.clientId || !config.clientSecret || !config.refreshToken) {
        throw new PublisherConfigurationError(
          "Google Drive publishing requires GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN"
        );
      }
      if (!config.rootFolderId) {
        throw new PublisherConfigurationError("Google Drive publishing requires GOOGLE_DRIVE_ROOT_FOLDER_ID");
      }

      const metadataPath = path.join(assetPackagePath, "metadata.json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
      const carouselId = metadata.carousel_id;

      const accessToken = await refreshAccessToken(config);
      const folderId = await findOrCreateCampaignFolder(config, accessToken, carouselId);

      const localFilenames = readdirSync(assetPackagePath).sort();
      const existingDriveFiles = await listFilesInFolder(config, accessToken, folderId);
      const existingByName = new Map(existingDriveFiles.map((f) => [f.name, f.id]));

      const matchingExisting = localFilenames.filter((name) => existingByName.has(name));
      if (matchingExisting.length > 0 && options.replace !== true) {
        throw new DuplicatePackageError(carouselId, matchingExisting);
      }

      let filesUploaded = 0;
      for (const filename of localFilenames) {
        const fileBuffer = readFileSync(path.join(assetPackagePath, filename));
        await uploadOrReplaceFile(config, accessToken, {
          folderId,
          filename,
          fileBuffer,
          mimeType: mimeTypeFor(filename),
          existingFileId: existingByName.get(filename) ?? null,
          maxAttempts: options.maxAttempts,
        });
        filesUploaded += 1;
      }

      return {
        status: "completed",
        publisher: "google-drive",
        packageId: carouselId,
        folderId,
        folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
        filesUploaded,
      };
    },
  };
}

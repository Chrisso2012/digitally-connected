// DC-003-I030 — Google Docs Content Source Adapter: the first (and, for
// this milestone, only) real implementation of the Content Source Adapter
// contract (content-source-adapter.mjs). Never used by automated tests or
// the CLI's default mode — see content-source-mock-adapter.mjs for what
// tests actually run against. Building and structurally verifying this
// adapter is in scope for DC-003-I030; actually exercising it against a
// real Google Doc is not (no live external calls occur anywhere in this
// milestone's own test suite or default CLI path) — mirrors this
// codebase's own established "mock now, live-verification-gate later,
// separately authorised" convention (DC-003-I029.2's Claude Code Runner,
// DC-003-I019's Anthropic LLM transport).
//
// Investigation findings this adapter is built on (see README
// "Investigation" for the full write-up):
//   - Retrieval method: Google Drive API v3's own `files.export` endpoint
//     with mimeType=text/plain — simpler than parsing the Docs API v1's
//     structured paragraph/run JSON, and sufficient since this milestone
//     needs only the plain article body, not formatting/images/tables.
//   - Authentication: a Google Cloud Service Account (JWT Bearer flow via
//     google-service-account-auth.mjs) — fully non-interactive, no
//     browser consent screen, matching this codebase's absolute "no
//     interactive login" boundary. The target document must be shared
//     with the service account's own email (view access) before it is
//     ingestable.
//   - Stable identifier: the Drive file ID (extracted from a full share
//     URL if one is supplied, or accepted bare) — never the full URL,
//     which can carry a title slug/query string that changes without the
//     underlying document changing.
//   - Metadata: `files.get` with an explicit `fields` mask returns name,
//     createdTime, modifiedTime, owners, and headRevisionId — no extra
//     Drive Revisions API call needed for this milestone's purposes.
//   - Revision/version signal: `headRevisionId` uniquely identifies the
//     document's current revision at fetch time; recorded in metadata,
//     not used for fingerprinting (source_fingerprint is a hash of the
//     retrieved body text itself — see content-ingestion-service.mjs —
//     which is a stronger signal than a revision ID string and needs no
//     extra API call).

import {
  ContentSourceNotFoundError,
  ContentSourceAuthenticationError,
  ContentSourceRateLimitError,
  ContentSourceTransportError,
  ContentSourceConfigurationError,
} from "./content-source-errors.mjs";
import { fetchGoogleServiceAccountAccessToken } from "./google-service-account-auth.mjs";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const METADATA_FIELDS = "name,createdTime,modifiedTime,owners,headRevisionId,webViewLink";
// A Drive file ID is a URL-safe base64-ish token, in practice always
// well over 10 characters — this pattern accepts both a bare ID and one
// extracted from a share URL below.
const BARE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const URL_ID_PATTERN = /\/d\/([A-Za-z0-9_-]{10,})/;

/**
 * Normalises a caller-supplied source reference (a bare Google Doc ID, or
 * a full https://docs.google.com/document/d/<ID>/... share URL) to the
 * stable Drive file ID. Throws ContentSourceConfigurationError for
 * anything that matches neither shape — a caller-input problem, not a
 * transport one.
 */
export function extractGoogleDocId(sourceReference) {
  if (typeof sourceReference === "string") {
    const urlMatch = sourceReference.match(URL_ID_PATTERN);
    if (urlMatch) return urlMatch[1];
    if (BARE_ID_PATTERN.test(sourceReference)) return sourceReference;
  }
  throw new ContentSourceConfigurationError(
    `"${sourceReference}" is not a recognisable Google Doc reference — expected a bare Document ID or a docs.google.com share URL`
  );
}

async function driveApiGet(url, accessToken, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (cause) {
    throw new ContentSourceTransportError(`Google Drive request failed: ${cause.message}`, cause);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ContentSourceAuthenticationError(`Google Drive rejected the request (HTTP ${response.status}) — is the document shared with the service account?`);
  }
  if (response.status === 404) {
    throw new ContentSourceNotFoundError(url);
  }
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    throw new ContentSourceRateLimitError("Google Drive reported a rate limit (HTTP 429)", retryAfterHeader ? Number(retryAfterHeader) * 1000 : null);
  }
  if (!response.ok) {
    throw new ContentSourceTransportError(`Google Drive returned HTTP ${response.status}`);
  }
  return response;
}

/**
 * config.clientEmail / config.privateKey — from loadGoogleDocsSourceConfig().
 * options.fetchImpl — override fetch (used by tests).
 * options.now — override the clock (used by tests, passed through to auth).
 */
export function createGoogleDocsSourceAdapter(config, options = {}) {
  if (!config?.configured) {
    throw new ContentSourceConfigurationError("Google Docs source adapter requires GOOGLE_SERVICE_ACCOUNT_JSON to be configured");
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "google-docs",

    async fetch({ sourceReference }) {
      const fileId = extractGoogleDocId(sourceReference);

      const { accessToken } = await fetchGoogleServiceAccountAccessToken(
        { clientEmail: config.clientEmail, privateKey: config.privateKey, scopes: [DRIVE_SCOPE] },
        { fetchImpl, now: options.now }
      );

      const metaResponse = await driveApiGet(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${METADATA_FIELDS}`,
        accessToken,
        fetchImpl
      );
      let meta;
      try {
        meta = await metaResponse.json();
      } catch (cause) {
        throw new ContentSourceTransportError(`Google Drive metadata response was not valid JSON: ${cause.message}`, cause);
      }

      const bodyResponse = await driveApiGet(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`,
        accessToken,
        fetchImpl
      );
      const body = await bodyResponse.text();

      return {
        title: meta.name,
        body,
        metadata: {
          author: meta.owners?.[0]?.emailAddress ?? null,
          source_created_at: meta.createdTime ?? null,
          source_modified_at: meta.modifiedTime ?? null,
          source_revision_id: meta.headRevisionId ?? null,
          source_url: meta.webViewLink ?? null,
        },
        sourceIdentifier: fileId,
      };
    },
  };
}

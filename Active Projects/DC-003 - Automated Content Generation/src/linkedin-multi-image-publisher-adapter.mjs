// DC-003-I027 — LinkedIn Multi-Image Publisher Adapter: the one
// social-publisher-adapter.mjs implementation this milestone ships for
// LinkedIn. Publishes a six-slide Finished Carousel as a native LinkedIn
// multi-image post via LinkedIn's current versioned REST API (Images API
// + Posts API). Built directly from LinkedIn's published API reference
// (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
// and .../posts-api) — like every other HTTP integration in this
// codebase before its own first live call, this has NOT been exercised
// against a real request as of this milestone's delivery. No live
// LinkedIn request is authorised during implementation — see README
// "Live-verification approval gates".
//
// Binary-upload strategy: unlike Instagram, LinkedIn's own API does not
// fetch images from an arbitrary URL — it requires the actual binary
// bytes to be uploaded through its own two-step process (initialize, then
// PUT the bytes to the returned upload URL). This adapter therefore reads
// the six approved PNG files directly from the completed Production
// Asset Package (`assetPackagePath`, an I021 export directory) — per the
// I027 brief's own instruction. No Templated CDN access, no re-rendering.
//
// Canonical filenames read (matching local-production-asset-export-adapter.mjs's
// own established naming convention exactly, derived from
// `finishedCarousel.slides` sorted by `slide_number` — never trusting
// directory-listing order): 01-cover.png, 02-content.png,
// 03-statistic.png, 04-quote.png, 05-infographic.png, 06-cta.png.
//
// Member vs. organisation publishing: `config.authorUrn` is the one,
// explicit, caller-configured value — `urn:li:person:<id>` or
// `urn:li:organization:<id>`. This adapter never infers or silently
// chooses between them; an unrecognised URN shape fails configuration
// validation before any request is made.
//
// Request budget for one successful publish: 6 images × (1 initializeUpload
// + 1 binary PUT) = 12 requests, + 1 POST /rest/posts to create the
// multi-image post = 13 requests total. No polling, no retries.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LinkedInConfigurationError,
  LinkedInAuthenticationError,
  LinkedInTransportError,
  LinkedInTimeoutError,
  LinkedInClientError,
  LinkedInRateLimitError,
  LinkedInImageUploadError,
  LinkedInPostCreationError,
} from "./linkedin-publisher-errors.mjs";

const MAX_MESSAGE_LENGTH = 300;
const SECRET_LIKE_PATTERN = /[A-Za-z0-9_-]{32,}/g;

function redact(text) {
  return text.replace(SECRET_LIKE_PATTERN, "[REDACTED]");
}

function sanitizeMessage(message) {
  if (typeof message !== "string" || message.trim() === "") return null;
  const redacted = redact(message);
  return redacted.length > MAX_MESSAGE_LENGTH ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…` : redacted;
}

// LinkedIn's own documented error envelope: { message, status,
// serviceErrorCode } (varies slightly by endpoint generation, but a
// top-level "message" string is consistently present).
function buildSafeDiagnostic(response, bodyText) {
  const status = response.status;
  const minimal = { status, message: null };

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

  return { status, message: sanitizeMessage(parsed.message) };
}

async function readErrorBodyText(response) {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

function linkedInHeaders(config, extra = {}) {
  return {
    authorization: `Bearer ${config.accessToken}`,
    "linkedin-version": config.apiVersion,
    "x-restli-protocol-version": "2.0.0",
    ...extra,
  };
}

async function sendRequest(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (cause) {
    if (cause.name === "AbortError") {
      throw new LinkedInTimeoutError(`LinkedIn request timed out after ${timeoutMs}ms`, timeoutMs);
    }
    throw new LinkedInTransportError(`LinkedIn request failed: ${cause.message}`, cause);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new LinkedInAuthenticationError(`LinkedIn rejected the credentials (HTTP ${response.status})`);
  }
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    throw new LinkedInRateLimitError("LinkedIn reported a rate limit (HTTP 429)", retryAfterHeader ? Number(retryAfterHeader) * 1000 : null);
  }
  if (response.status >= 500) {
    throw new LinkedInTransportError(`LinkedIn returned a server error (HTTP ${response.status})`, null);
  }
  if (!response.ok) {
    const bodyText = await readErrorBodyText(response);
    const diagnostic = buildSafeDiagnostic(response, bodyText);
    throw new LinkedInClientError(`LinkedIn rejected the request (HTTP ${response.status})`, diagnostic);
  }

  return response;
}

function orderedSlides(finishedCarousel) {
  return [...finishedCarousel.slides].sort((a, b) => a.slide_number - b.slide_number);
}

// LinkedIn's own documented permalink shape for a share/UGC post URN —
// pure string construction, never an extra API call (keeping the
// live-verification request budget minimal, per this file's own header
// comment). Returns null for any URN shape this isn't confidently true
// for, rather than guessing.
function derivePostUrl(postId) {
  if (typeof postId === "string" && (postId.startsWith("urn:li:share:") || postId.startsWith("urn:li:ugcPost:"))) {
    return `https://www.linkedin.com/feed/update/${postId}/`;
  }
  return null;
}

function canonicalFilename(slide) {
  return `${String(slide.slide_number).padStart(2, "0")}-${slide.slide_type}.png`;
}

async function initializeUpload(config, timeoutMs) {
  const url = `${config.apiBaseUrl}/rest/images?action=initializeUpload`;
  const response = await sendRequest(
    url,
    {
      method: "POST",
      headers: linkedInHeaders(config, { "content-type": "application/json" }),
      body: JSON.stringify({ initializeUploadRequest: { owner: config.authorUrn } }),
    },
    timeoutMs
  );
  const parsed = await response.json();
  const uploadUrl = parsed?.value?.uploadUrl;
  const imageUrn = parsed?.value?.image;
  if (typeof uploadUrl !== "string" || uploadUrl.trim() === "" || typeof imageUrn !== "string" || imageUrn.trim() === "") {
    throw new Error("initializeUpload response did not include both uploadUrl and image");
  }
  return { uploadUrl, imageUrn };
}

async function uploadImageBytes(config, uploadUrl, bytes, timeoutMs) {
  await sendRequest(uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${config.accessToken}` }, body: bytes }, timeoutMs);
}

async function uploadOneImage(config, assetPackagePath, slide, timeoutMs) {
  let bytes;
  try {
    bytes = readFileSync(path.join(assetPackagePath, canonicalFilename(slide)));
  } catch (cause) {
    throw new LinkedInImageUploadError(slide.slide_type, "the local package file could not be read", cause);
  }

  let uploadUrl;
  let imageUrn;
  try {
    ({ uploadUrl, imageUrn } = await initializeUpload(config, timeoutMs));
  } catch (cause) {
    if (cause.name === "LinkedInAuthenticationError" || cause.name === "LinkedInRateLimitError") throw cause;
    throw new LinkedInImageUploadError(slide.slide_type, "initializeUpload failed", cause);
  }

  try {
    await uploadImageBytes(config, uploadUrl, bytes, timeoutMs);
  } catch (cause) {
    if (cause.name === "LinkedInAuthenticationError" || cause.name === "LinkedInRateLimitError") throw cause;
    throw new LinkedInImageUploadError(slide.slide_type, "binary upload failed", cause);
  }

  return imageUrn;
}

async function createPost(config, imageUrns, commentary, timeoutMs) {
  const url = `${config.apiBaseUrl}/rest/posts`;
  const body = {
    author: config.authorUrn,
    commentary,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { multiImage: { images: imageUrns.map((id) => ({ id })) } },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  let response;
  try {
    response = await sendRequest(url, { method: "POST", headers: linkedInHeaders(config, { "content-type": "application/json" }), body: JSON.stringify(body) }, timeoutMs);
  } catch (cause) {
    throw new LinkedInPostCreationError(cause.message ?? "request failed", cause);
  }

  const postId = response.headers.get("x-restli-id") ?? response.headers.get("x-linkedin-id");
  if (typeof postId !== "string" || postId.trim() === "") {
    throw new LinkedInPostCreationError("no post identifier was returned");
  }
  return postId;
}

/**
 * Builds the LinkedIn Multi-Image Publisher Adapter.
 *
 * config — required, the return value of loadLinkedInPublisherConfig().
 *   Missing accessToken/authorUrn/apiVersion, or an authorUrn that
 *   doesn't match `urn:li:person:...` / `urn:li:organization:...`, throws
 *   LinkedInConfigurationError at the first publish() call.
 *
 * Returns { name, provider, publish({ manifest, finishedCarousel, assetPackagePath }) }.
 */
export function createLinkedInMultiImagePublisherAdapter(config) {
  return {
    name: "linkedin-multi-image-publisher-adapter",
    provider: "linkedin",
    // Safe, non-secret author identifier — available synchronously so
    // the service can duplicate-check before any request. Empty string
    // (not null/undefined) when unconfigured/malformed — the real
    // LinkedInConfigurationError fail-fast still happens inside
    // publish() itself.
    destination: typeof config.authorUrn === "string" ? config.authorUrn : "",

    /**
     * Publishes one approved, six-slide Finished Carousel as a LinkedIn
     * multi-image post, using the manifest's approved commentary.
     *
     * Throws LinkedInConfigurationError if required config is missing or
     * malformed. Throws LinkedInImageUploadError on the first image
     * upload failure — stops immediately, uploads no later image, creates
     * no post. Throws LinkedInPostCreationError if the final post-creation
     * call fails after all six images uploaded successfully.
     *
     * Returns { postId, postUrl, publishedAt, itemCount }.
     */
    async publish({ manifest, finishedCarousel, assetPackagePath }) {
      if (typeof config.accessToken !== "string" || config.accessToken.trim() === "") {
        throw new LinkedInConfigurationError("LinkedIn publishing requires LINKEDIN_ACCESS_TOKEN");
      }
      if (typeof config.authorUrn !== "string" || !/^urn:li:(person|organization):.+$/.test(config.authorUrn)) {
        throw new LinkedInConfigurationError(
          'LinkedIn publishing requires LINKEDIN_AUTHOR_URN to be an explicit "urn:li:person:<id>" or "urn:li:organization:<id>" value'
        );
      }
      if (typeof config.apiVersion !== "string" || config.apiVersion.trim() === "") {
        throw new LinkedInConfigurationError("LinkedIn publishing requires LINKEDIN_API_VERSION (LinkedIn's own dated version header value)");
      }

      const slides = orderedSlides(finishedCarousel);
      const commentary = manifest.destinations.linkedin.commentary;

      const imageUrns = [];
      for (const slide of slides) {
        // eslint-disable-next-line no-await-in-loop -- images must upload
        // strictly in canonical slide order, one at a time; an upload
        // failure must stop before any later image is attempted.
        const urn = await uploadOneImage(config, assetPackagePath, slide, config.requestTimeoutMs);
        imageUrns.push(urn);
      }

      const postId = await createPost(config, imageUrns, commentary, config.requestTimeoutMs);

      return {
        postId,
        postUrl: derivePostUrl(postId),
        publishedAt: new Date().toISOString(),
        itemCount: slides.length,
      };
    },
  };
}

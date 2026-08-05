// DC-003-I027 — Instagram Carousel Publisher Adapter: the one
// social-publisher-adapter.mjs implementation this milestone ships for
// Instagram. Publishes a six-slide Finished Carousel as a native
// Instagram carousel post via Meta's documented Content Publishing
// process (Graph API). Built directly from Meta's published API
// reference (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing) —
// like DC-003-I006's renderer-transport-http.mjs and DC-003-I022's
// google-drive-publisher-adapter.mjs before their own first live calls,
// this has NOT been exercised against a real request as of this
// milestone's delivery. No live Instagram request is authorised during
// implementation — see README "Live-verification approval gates".
//
// Public-URL strategy: Instagram's own container-creation call fetches
// the image itself from a URL you supply — it does not accept a direct
// binary upload for feed/carousel posts. This adapter therefore reads
// `finishedCarousel.slides[].image_url` (Templated's own public CDN,
// already confirmed unauthenticated — see README "Templated API note")
// directly, per the I027 brief's own instruction: "Do not download and
// re-upload the images where public CDN URLs are accepted." No local
// file I/O anywhere in this adapter.
//
// Canonical slide order (cover, content, statistic, quote, infographic,
// cta) is preserved by iterating `finishedCarousel.slides` sorted by
// `slide_number` — the same defensive "never trust array order" discipline
// carousel-payload-mapper.mjs and local-production-asset-export-adapter.mjs
// already established for this codebase.
//
// Request budget for one successful publish: 6 child-container creations
// + 1 parent carousel-container creation + 1 media_publish call = 8
// requests total. No polling, no permalink-fetch call (a permalink would
// require one additional GET per publish — deliberately not made, to keep
// the live-verification budget minimal; `postUrl` is null unless the
// publish response itself happens to include one).

import {
  InstagramConfigurationError,
  InstagramAuthenticationError,
  InstagramTransportError,
  InstagramTimeoutError,
  InstagramClientError,
  InstagramRateLimitError,
  InstagramContainerError,
  InstagramPublishError,
} from "./instagram-publisher-errors.mjs";

const MAX_MESSAGE_LENGTH = 300;
// Defense in depth, same discipline DC-003-I019.1/I022 already
// established: an access token accidentally echoed into an error
// message is redacted regardless of source.
const SECRET_LIKE_PATTERN = /EA[A-Za-z0-9]{20,}|[A-Za-z0-9_-]{40,}/g;

function redact(text) {
  return text.replace(SECRET_LIKE_PATTERN, "[REDACTED]");
}

function sanitizeMessage(message) {
  if (typeof message !== "string" || message.trim() === "") return null;
  const redacted = redact(message);
  return redacted.length > MAX_MESSAGE_LENGTH ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…` : redacted;
}

// Graph API's own documented error envelope:
// { error: { message, type, code, error_subcode, fbtrace_id } }
function buildSafeDiagnostic(response, bodyText) {
  const status = response.status;
  const minimal = { status, errorType: null, message: null };

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

  return {
    status,
    errorType: typeof errorField.type === "string" ? errorField.type : null,
    message: sanitizeMessage(errorField.message),
  };
}

async function readErrorBodyText(response) {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

async function sendRequest(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (cause) {
    if (cause.name === "AbortError") {
      throw new InstagramTimeoutError(`Instagram request timed out after ${timeoutMs}ms`, timeoutMs);
    }
    throw new InstagramTransportError(`Instagram request failed: ${cause.message}`, cause);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new InstagramAuthenticationError(`Instagram rejected the credentials (HTTP ${response.status})`);
  }
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    throw new InstagramRateLimitError("Instagram reported a rate limit (HTTP 429)", retryAfterHeader ? Number(retryAfterHeader) * 1000 : null);
  }
  if (response.status >= 500) {
    throw new InstagramTransportError(`Instagram returned a server error (HTTP ${response.status})`, null);
  }
  if (!response.ok) {
    const bodyText = await readErrorBodyText(response);
    const diagnostic = buildSafeDiagnostic(response, bodyText);
    throw new InstagramClientError(`Instagram rejected the request (HTTP ${response.status})`, diagnostic);
  }

  return response;
}

function orderedSlides(finishedCarousel) {
  return [...finishedCarousel.slides].sort((a, b) => a.slide_number - b.slide_number);
}

async function createChildContainer(config, slide, timeoutMs) {
  const url = `${config.apiBaseUrl}/${config.apiVersion}/${config.userId}/media`;
  const body = new URLSearchParams({
    image_url: slide.image_url,
    is_carousel_item: "true",
    access_token: config.accessToken,
  });
  if (slide.altText) body.set("alt_text", slide.altText);

  let response;
  try {
    response = await sendRequest(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }, timeoutMs);
  } catch (cause) {
    if (cause.name === "InstagramAuthenticationError" || cause.name === "InstagramRateLimitError") throw cause;
    throw new InstagramContainerError(slide.slide_type, cause.message ?? "request failed", cause);
  }
  const parsed = await response.json();
  if (typeof parsed.id !== "string" || parsed.id.trim() === "") {
    throw new InstagramContainerError(slide.slide_type, "no container id was returned");
  }
  return parsed.id;
}

async function createParentContainer(config, childIds, caption, timeoutMs) {
  const url = `${config.apiBaseUrl}/${config.apiVersion}/${config.userId}/media`;
  const body = new URLSearchParams({
    media_type: "CAROUSEL",
    caption,
    children: childIds.join(","),
    access_token: config.accessToken,
  });

  const response = await sendRequest(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }, timeoutMs);
  const parsed = await response.json();
  if (typeof parsed.id !== "string" || parsed.id.trim() === "") {
    throw new InstagramPublishError("no parent carousel container id was returned");
  }
  return parsed.id;
}

async function publishContainer(config, containerId, timeoutMs) {
  const url = `${config.apiBaseUrl}/${config.apiVersion}/${config.userId}/media_publish`;
  const body = new URLSearchParams({ creation_id: containerId, access_token: config.accessToken });

  const response = await sendRequest(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }, timeoutMs);
  const parsed = await response.json();
  if (typeof parsed.id !== "string" || parsed.id.trim() === "") {
    throw new InstagramPublishError("no published media id was returned");
  }
  return { id: parsed.id, permalink: typeof parsed.permalink === "string" ? parsed.permalink : null };
}

/**
 * Builds the Instagram Carousel Publisher Adapter.
 *
 * config — required, the return value of loadInstagramPublisherConfig().
 *   Missing accessToken/userId throws InstagramConfigurationError at the
 *   first publish() call (not at construction — mirrors every other
 *   adapter's own "fail fast, but only once a call is actually attempted"
 *   contract in this codebase, since a mock-mode caller may construct
 *   this adapter but never invoke it).
 *
 * Returns { name, provider, publish({ manifest, finishedCarousel }) }.
 */
export function createInstagramCarouselPublisherAdapter(config) {
  return {
    name: "instagram-carousel-publisher-adapter",
    provider: "instagram",
    // Safe, non-secret account identifier — available synchronously so
    // the service can duplicate-check before any request. Empty string
    // (not null/undefined) when unconfigured — the real
    // InstagramConfigurationError fail-fast still happens inside
    // publish() itself.
    destination: typeof config.userId === "string" ? config.userId : "",

    /**
     * Publishes one approved, six-slide Finished Carousel as an Instagram
     * carousel post, using the manifest's approved caption/alt text.
     *
     * Throws InstagramConfigurationError if required config is missing.
     * Throws InstagramContainerError if a child container creation fails
     * (stops immediately — no later child is attempted). Throws
     * InstagramPublishError if the parent container or the final publish
     * call fails.
     *
     * Returns { postId, postUrl, publishedAt, itemCount }.
     */
    async publish({ manifest, finishedCarousel }) {
      if (typeof config.accessToken !== "string" || config.accessToken.trim() === "") {
        throw new InstagramConfigurationError("Instagram publishing requires INSTAGRAM_ACCESS_TOKEN");
      }
      if (typeof config.userId !== "string" || config.userId.trim() === "") {
        throw new InstagramConfigurationError("Instagram publishing requires INSTAGRAM_USER_ID");
      }

      const slides = orderedSlides(finishedCarousel);
      const caption = manifest.destinations.instagram.caption;
      const altText = manifest.destinations.instagram.alt_text;

      const childIds = [];
      for (const slide of slides) {
        // eslint-disable-next-line no-await-in-loop -- containers must be
        // created strictly in canonical slide order, one at a time; Instagram
        // has no batch-create endpoint for carousel item containers.
        const id = await createChildContainer(config, { ...slide, altText }, config.requestTimeoutMs);
        childIds.push(id);
      }

      const parentId = await createParentContainer(config, childIds, caption, config.requestTimeoutMs);
      const published = await publishContainer(config, parentId, config.requestTimeoutMs);

      return {
        postId: published.id,
        postUrl: published.permalink,
        publishedAt: new Date().toISOString(),
        itemCount: slides.length,
      };
    },
  };
}

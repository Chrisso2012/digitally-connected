// Unit tests for instagram-carousel-publisher-adapter.mjs (DC-003-I027).
// global.fetch is stubbed for every test — no real network anywhere in
// this file, matching this codebase's established discipline for every
// HTTP-integration adapter test (google-drive-publisher-adapter.test.mjs,
// llm-transport-http.test.mjs).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createInstagramCarouselPublisherAdapter } from "../../src/instagram-carousel-publisher-adapter.mjs";
import {
  InstagramConfigurationError,
  InstagramAuthenticationError,
  InstagramRateLimitError,
  InstagramContainerError,
  InstagramClientError,
} from "../../src/instagram-publisher-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

function loadFreshCarousel() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
}

function buildConfig(overrides = {}) {
  return {
    accessToken: "fake-token-not-real",
    userId: "17800000000000001",
    apiBaseUrl: "https://graph.example.test",
    apiVersion: "v21.0",
    requestTimeoutMs: 5000,
    ...overrides,
  };
}

function buildManifest(overrides = {}) {
  return {
    destinations: {
      instagram: { enabled: true, caption: "Approved caption — never leak me", alt_text: "Approved alt text" },
      linkedin: { enabled: false, commentary: null },
    },
    ...overrides,
  };
}

function withStubbedFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// --- configuration --------------------------------------------------------

test("requires INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID before any request", () =>
  withStubbedFetch(
    () => {
      throw new Error("fetch must never be called");
    },
    async () => {
      const adapter = createInstagramCarouselPublisherAdapter(buildConfig({ accessToken: null }));
      await assert.rejects(() => adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel() }), InstagramConfigurationError);

      const adapter2 = createInstagramCarouselPublisherAdapter(buildConfig({ userId: null }));
      await assert.rejects(() => adapter2.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel() }), InstagramConfigurationError);
    }
  ));

test("destination is the configured userId, available synchronously", () => {
  const adapter = createInstagramCarouselPublisherAdapter(buildConfig({ userId: "17800000000000099" }));
  assert.equal(adapter.destination, "17800000000000099");
});

// --- successful publish: canonical ordering -------------------------------

test("creates six child containers in canonical slide order, then the parent container, then publishes", () =>
  withStubbedFetch(
    (url, init, callNumber) => {
      if (callNumber <= 6) {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("is_carousel_item"), "true");
        assert.ok(body.get("image_url").length > 0);
        return jsonResponse(200, { id: `child_${callNumber}` });
      }
      if (callNumber === 7) {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("media_type"), "CAROUSEL");
        assert.equal(body.get("children"), "child_1,child_2,child_3,child_4,child_5,child_6");
        assert.equal(body.get("caption"), "Approved caption — never leak me");
        return jsonResponse(200, { id: "parent_container_id" });
      }
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("creation_id"), "parent_container_id");
      return jsonResponse(200, { id: "published_media_id_1", permalink: "https://instagram.com/p/abc123" });
    },
    async (calls) => {
      const adapter = createInstagramCarouselPublisherAdapter(buildConfig());
      const result = await adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel() });

      assert.equal(calls.length, 8, "6 child containers + 1 parent + 1 publish = 8 requests");
      assert.equal(result.postId, "published_media_id_1");
      assert.equal(result.postUrl, "https://instagram.com/p/abc123");
      assert.equal(result.itemCount, 6);
    }
  ));

test("child containers are created in slide_number order even when the carousel's own slides array is out of order", () =>
  withStubbedFetch(
    (url, init, callNumber) => {
      if (callNumber <= 6) return jsonResponse(200, { id: `child_${callNumber}` });
      if (callNumber === 7) return jsonResponse(200, { id: "parent_container_id" });
      return jsonResponse(200, { id: "published_id" });
    },
    async (calls) => {
      const carousel = loadFreshCarousel();
      carousel.slides = [...carousel.slides].reverse(); // deliberately scrambled
      const adapter = createInstagramCarouselPublisherAdapter(buildConfig());
      await adapter.publish({ manifest: buildManifest(), finishedCarousel: carousel });

      const firstSixUrls = calls.slice(0, 6).map((c) => new URLSearchParams(c.init.body).get("image_url"));
      const expectedOrder = [...loadFreshCarousel().slides].sort((a, b) => a.slide_number - b.slide_number).map((s) => s.image_url);
      assert.deepEqual(firstSixUrls, expectedOrder);
    }
  ));

// --- failure handling ------------------------------------------------------

test("a child container failure stops immediately — no further children, no parent container, no publish", () =>
  withStubbedFetch(
    (url, init, callNumber) => {
      if (callNumber === 1) return jsonResponse(200, { id: "child_1" });
      if (callNumber === 2) return jsonResponse(400, { error: { message: "bad image url", type: "OAuthException" } });
      throw new Error("must not be called after the second child fails");
    },
    async (calls) => {
      const adapter = createInstagramCarouselPublisherAdapter(buildConfig());
      await assert.rejects(() => adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel() }), InstagramContainerError);
      assert.equal(calls.length, 2);
    }
  ));

test("HTTP 401/403 throws InstagramAuthenticationError", () =>
  withStubbedFetch(
    () => jsonResponse(401, {}),
    async () => {
      const adapter = createInstagramCarouselPublisherAdapter(buildConfig());
      await assert.rejects(() => adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel() }), InstagramAuthenticationError);
    }
  ));

test("HTTP 429 throws InstagramRateLimitError", () =>
  withStubbedFetch(
    () => ({ ...jsonResponse(429, {}), headers: { get: (name) => (name.toLowerCase() === "retry-after" ? "30" : null) } }),
    async () => {
      const adapter = createInstagramCarouselPublisherAdapter(buildConfig());
      await assert.rejects(() => adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel() }), InstagramRateLimitError);
    }
  ));

// --- safe diagnostics: never leak a caption, token, or raw response -------

test("a client error's diagnostic never contains the access token or the caption", () =>
  withStubbedFetch(
    () => jsonResponse(400, { error: { message: "Invalid parameter", type: "OAuthException" } }),
    async () => {
      const adapter = createInstagramCarouselPublisherAdapter(buildConfig({ accessToken: "EAABSECRETTOKENVALUE1234567890" }));
      try {
        await adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel() });
        assert.fail("expected InstagramContainerError");
      } catch (error) {
        const serialized = JSON.stringify(error) + error.message + JSON.stringify(error.cause?.diagnostic ?? {});
        assert.doesNotMatch(serialized, /EAABSECRETTOKENVALUE1234567890/);
        assert.doesNotMatch(serialized, /Approved caption/);
      }
    }
  ));

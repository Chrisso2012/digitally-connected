// Unit tests for linkedin-multi-image-publisher-adapter.mjs (DC-003-I027).
// global.fetch is stubbed for every test — no real network. Reads six
// real (fake-content) PNG files from a real temp directory, matching the
// canonical filenames local-production-asset-export-adapter.mjs (I021)
// already establishes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLinkedInMultiImagePublisherAdapter } from "../../src/linkedin-multi-image-publisher-adapter.mjs";
import {
  LinkedInConfigurationError,
  LinkedInAuthenticationError,
  LinkedInImageUploadError,
  LinkedInPostCreationError,
} from "../../src/linkedin-publisher-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

function loadFreshCarousel() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
}

async function withAssetPackage(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-linkedin-adapter-"));
  try {
    for (const name of ["01-cover.png", "02-content.png", "03-statistic.png", "04-quote.png", "05-infographic.png", "06-cta.png"]) {
      writeFileSync(path.join(dir, name), Buffer.from(`fake-bytes-${name}`));
    }
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildConfig(overrides = {}) {
  return {
    accessToken: "fake-token-not-real",
    authorUrn: "urn:li:person:abc123",
    apiBaseUrl: "https://api.example.test",
    apiVersion: "202401",
    requestTimeoutMs: 5000,
    ...overrides,
  };
}

function buildManifest(overrides = {}) {
  return {
    destinations: {
      instagram: { enabled: false, caption: null, alt_text: null },
      linkedin: { enabled: true, commentary: "Approved commentary — never leak me" },
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

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function plainResponse(status, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => ({}),
    text: async () => "",
  };
}

// --- configuration --------------------------------------------------------

test("requires LINKEDIN_ACCESS_TOKEN / a valid LINKEDIN_AUTHOR_URN / LINKEDIN_API_VERSION before any request", () =>
  withAssetPackage((assetPackagePath) =>
    withStubbedFetch(
      () => {
        throw new Error("fetch must never be called");
      },
      async () => {
        await assert.rejects(
          () => createLinkedInMultiImagePublisherAdapter(buildConfig({ accessToken: null })).publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel(), assetPackagePath }),
          LinkedInConfigurationError
        );
        await assert.rejects(
          () => createLinkedInMultiImagePublisherAdapter(buildConfig({ authorUrn: "not-a-valid-urn" })).publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel(), assetPackagePath }),
          LinkedInConfigurationError
        );
        await assert.rejects(
          () => createLinkedInMultiImagePublisherAdapter(buildConfig({ apiVersion: null })).publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel(), assetPackagePath }),
          LinkedInConfigurationError
        );
      }
    )
  ));

test("destination is the configured authorUrn, available synchronously — member and organisation both explicit", () => {
  const memberAdapter = createLinkedInMultiImagePublisherAdapter(buildConfig({ authorUrn: "urn:li:person:member1" }));
  assert.equal(memberAdapter.destination, "urn:li:person:member1");

  const orgAdapter = createLinkedInMultiImagePublisherAdapter(buildConfig({ authorUrn: "urn:li:organization:org1" }));
  assert.equal(orgAdapter.destination, "urn:li:organization:org1");
});

// --- successful publish: canonical six-image upload ordering -------------

test("uploads six images in canonical slide order (initialize + PUT per image), then creates one multi-image post", () =>
  withAssetPackage((assetPackagePath) =>
    withStubbedFetch(
      (url, init, callNumber) => {
        // 6 images x (initialize + upload) = 12 calls, then 1 post-create call.
        const imageIndex = Math.ceil(callNumber / 2);
        if (callNumber <= 12 && callNumber % 2 === 1) {
          // initializeUpload
          const body = JSON.parse(init.body);
          assert.equal(body.initializeUploadRequest.owner, "urn:li:person:abc123");
          return jsonResponse(200, { value: { uploadUrl: `https://upload.example.test/${imageIndex}`, image: `urn:li:image:img${imageIndex}` } });
        }
        if (callNumber <= 12) {
          // binary PUT
          assert.equal(init.method, "PUT");
          assert.ok(Buffer.isBuffer(init.body) || init.body instanceof Uint8Array);
          return plainResponse(201);
        }
        // final post creation
        const body = JSON.parse(init.body);
        assert.equal(body.author, "urn:li:person:abc123");
        assert.equal(body.commentary, "Approved commentary — never leak me");
        assert.deepEqual(
          body.content.multiImage.images.map((i) => i.id),
          ["urn:li:image:img1", "urn:li:image:img2", "urn:li:image:img3", "urn:li:image:img4", "urn:li:image:img5", "urn:li:image:img6"]
        );
        return jsonResponse(201, {}, { "x-restli-id": "urn:li:share:9000000000000000000" });
      },
      async (calls) => {
        const adapter = createLinkedInMultiImagePublisherAdapter(buildConfig());
        const result = await adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel(), assetPackagePath });

        assert.equal(calls.length, 13, "6 x (initialize + upload) + 1 post-create = 13 requests");
        assert.equal(result.postId, "urn:li:share:9000000000000000000");
        assert.equal(result.postUrl, "https://www.linkedin.com/feed/update/urn:li:share:9000000000000000000/");
        assert.equal(result.itemCount, 6);
      }
    )
  ));

// --- failure handling: stop immediately, no later uploads, no post -------

test("an image upload failure stops immediately — no later images uploaded, no post created", () =>
  withAssetPackage((assetPackagePath) =>
    withStubbedFetch(
      (url, init, callNumber) => {
        if (callNumber === 1) return jsonResponse(200, { value: { uploadUrl: "https://upload.example.test/1", image: "urn:li:image:img1" } });
        if (callNumber === 2) return plainResponse(201); // first image uploads fine
        if (callNumber === 3) return jsonResponse(400, { message: "second image initialize failed" }); // second image fails
        throw new Error("must not be called after the second image's upload fails");
      },
      async (calls) => {
        const adapter = createLinkedInMultiImagePublisherAdapter(buildConfig());
        await assert.rejects(
          () => adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel(), assetPackagePath }),
          LinkedInImageUploadError
        );
        assert.equal(calls.length, 3);
      }
    )
  ));

test("a post-creation failure after all six images upload throws LinkedInPostCreationError", () =>
  withAssetPackage((assetPackagePath) =>
    withStubbedFetch(
      (url, init, callNumber) => {
        if (callNumber <= 12 && callNumber % 2 === 1) return jsonResponse(200, { value: { uploadUrl: `https://upload.example.test/${callNumber}`, image: `urn:li:image:img${callNumber}` } });
        if (callNumber <= 12) return plainResponse(201);
        return jsonResponse(400, { message: "post creation rejected" });
      },
      async () => {
        const adapter = createLinkedInMultiImagePublisherAdapter(buildConfig());
        await assert.rejects(
          () => adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel(), assetPackagePath }),
          LinkedInPostCreationError
        );
      }
    )
  ));

test("HTTP 401/403 throws LinkedInAuthenticationError", () =>
  withAssetPackage((assetPackagePath) =>
    withStubbedFetch(
      () => jsonResponse(403, {}),
      async () => {
        const adapter = createLinkedInMultiImagePublisherAdapter(buildConfig());
        await assert.rejects(() => adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel(), assetPackagePath }), LinkedInAuthenticationError);
      }
    )
  ));

// --- safe diagnostics: never leak a token or commentary --------------------

test("a client error's diagnostic never contains the access token or the commentary", () =>
  withAssetPackage((assetPackagePath) =>
    withStubbedFetch(
      (url, init, callNumber) => {
        if (callNumber === 1) return jsonResponse(400, { message: "initialize rejected" });
        throw new Error("must not be called");
      },
      async () => {
        const adapter = createLinkedInMultiImagePublisherAdapter(buildConfig({ accessToken: "supersecrettoken1234567890abcdef" }));
        try {
          await adapter.publish({ manifest: buildManifest(), finishedCarousel: loadFreshCarousel(), assetPackagePath });
          assert.fail("expected LinkedInImageUploadError");
        } catch (error) {
          const serialized = JSON.stringify(error) + error.message + JSON.stringify(error.cause?.diagnostic ?? {});
          assert.doesNotMatch(serialized, /supersecrettoken1234567890abcdef/);
          assert.doesNotMatch(serialized, /Approved commentary/);
        }
      }
    )
  ));

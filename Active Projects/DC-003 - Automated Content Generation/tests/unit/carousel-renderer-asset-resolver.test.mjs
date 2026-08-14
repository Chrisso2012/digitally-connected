// DC-003-I035 — regression coverage for carousel-renderer-asset-resolver.mjs:
// the local-file, base64-embedding convention for CCP `image.asset_reference`,
// and its fail-closed behaviour on any unresolvable reference. Never
// substitutes another image, never fetches from the network.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveImageAsset } from "../../src/carousel-renderer-asset-resolver.mjs";
import { CarouselAssetResolutionError } from "../../src/carousel-renderer-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_ROOT_DIR = path.join(__dirname, "..", "fixtures", "carousel-renderer-assets");

function image(overrides = {}) {
  return { mode: "none", asset_reference: null, direction: null, ...overrides };
}

test("resolveImageAsset returns null for mode:none without touching the filesystem", () => {
  const result = resolveImageAsset(image(), 3, "/nonexistent/root/that/is/never/read");
  assert.equal(result, null);
});

test("resolveImageAsset resolves a mode:provided fixture to a base64 data URI", () => {
  const result = resolveImageAsset(image({ mode: "provided", asset_reference: "test-photo-a.png" }), 1, ASSETS_ROOT_DIR);
  assert.match(result, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
});

test("resolveImageAsset hard-fails on a missing asset", () => {
  assert.throws(
    () => resolveImageAsset(image({ mode: "provided", asset_reference: "does-not-exist.png" }), 2, ASSETS_ROOT_DIR),
    CarouselAssetResolutionError
  );
});

test("resolveImageAsset rejects path traversal outside the assets root", () => {
  assert.throws(
    () => resolveImageAsset(image({ mode: "provided", asset_reference: "../../../etc/passwd" }), 4, ASSETS_ROOT_DIR),
    CarouselAssetResolutionError
  );
});

test("resolveImageAsset rejects an absolute path", () => {
  assert.throws(
    () => resolveImageAsset(image({ mode: "provided", asset_reference: path.join(ASSETS_ROOT_DIR, "test-photo-a.png") }), 5, ASSETS_ROOT_DIR),
    CarouselAssetResolutionError
  );
});

test("resolveImageAsset rejects an unsupported file extension", () => {
  assert.throws(
    () => resolveImageAsset(image({ mode: "provided", asset_reference: "test-photo-a.gif" }), 6, ASSETS_ROOT_DIR),
    CarouselAssetResolutionError
  );
});

// DC-003-I035 — CLI round-trip coverage for
// tests/validation/render-carousel-content-package.mjs. Mirrors
// carousel-content-package-cli.test.mjs's own "spawnSync via
// process.execPath" pattern. Requires a system Chromium binary (see
// README "HTML Carousel Renderer").

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCarouselContentPackage } from "../../src/carousel-content-package.mjs";
import { createCarouselContentPackageStore } from "../../src/carousel-content-package-store.mjs";
import { createLocalJsonCarouselContentPackageStoreAdapter } from "../../src/local-json-carousel-content-package-store-adapter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "render-carousel-content-package.mjs");
const ASSETS_ROOT_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "carousel-renderer-assets");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

const INDUSTRY_SERIES = "Real Estate Industry Series";

function image(overrides = {}) {
  return { mode: "none", asset_reference: null, direction: null, ...overrides };
}

function buildFields() {
  return {
    sourceArticleTitle: "The Myth of the Dead Database",
    sourceArticleReference: "cowork://articles/myth-dead-database",
    industryName: "Real Estate",
    industrySeries: INDUSTRY_SERIES,
    carouselTitle: "The Myth of the Dead Database",
    approvedBy: "chris@digitallyconnected.net",
    approvedAt: "2026-08-11T09:00:00.000Z",
    schemaVersion: "1.0",
    slides: [
      { slide_number: 1, role: "cover", template: "cover_black", industry_series: INDUSTRY_SERIES, headline: "H1", supporting_line: "S1", image: image({ mode: "provided", asset_reference: "test-photo-a.png" }) },
      { slide_number: 2, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES, headline: "H2", body: "B2", image: image(), image_layout: "none", emphasis_instructions: [] },
      { slide_number: 3, role: "content", template: "content_orange", industry_series: INDUSTRY_SERIES, headline: "H3", body: "B3", image: image(), image_layout: "none", emphasis_instructions: [] },
      { slide_number: 4, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES, headline: "H4", body: "B4", image: image(), image_layout: "none", emphasis_instructions: [] },
      { slide_number: 5, role: "content", template: "content_orange", industry_series: INDUSTRY_SERIES, headline: "H5", body: "B5", image: image(), image_layout: "none", emphasis_instructions: [] },
      { slide_number: 6, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES, headline: "H6", body: "B6", image: image(), image_layout: "none", emphasis_instructions: [] },
      { slide_number: 7, role: "close", template: "close_black", industry_series: INDUSTRY_SERIES, headline: "H7", body: "B7", soft_cta: "CTA", image: image({ mode: "provided", asset_reference: "test-photo-a.png" }), emphasis_instructions: [] },
    ],
  };
}

async function withTempDirs(fn) {
  const parent = mkdtempSync(path.join(tmpdir(), "dc003-render-cli-"));
  try {
    return await fn(parent);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

test("render CLI renders a stored, approved CCP to 7 PNGs and prints a success summary", async () => {
  await withTempDirs(async (parent) => {
    const ccpStoreDirectory = path.join(parent, "ccp-store");
    const outputDir = path.join(parent, "output");
    const store = createCarouselContentPackageStore({ adapter: createLocalJsonCarouselContentPackageStoreAdapter({ storageDir: ccpStoreDirectory }) });
    const ccp = createCarouselContentPackage(buildFields(), { idGenerator: () => "ccp_clirendertest00001" });
    store.save(ccp);

    const result = runCli("render", ccp.carousel_content_package_id, ccpStoreDirectory, ASSETS_ROOT_DIR, outputDir);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Carousel rendered OK/);
    assert.match(result.stdout, /\[slide 1\] cover_black/);
    assert.match(result.stdout, /\[slide 7\] close_black/);

    const files = readdirSync(outputDir).sort();
    assert.deepEqual(files, [
      "render-metadata.json",
      "slide_01.png", "slide_02.png", "slide_03.png", "slide_04.png",
      "slide_05.png", "slide_06.png", "slide_07.png",
    ]);
  });
});

test("render CLI exits with a usage error when required arguments are missing", () => {
  const result = runCli("render", "ccp_someid");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("render CLI fails cleanly for an unknown Carousel Content Package id", async () => {
  await withTempDirs(async (parent) => {
    const ccpStoreDirectory = path.join(parent, "ccp-store");
    const outputDir = path.join(parent, "output");
    const result = runCli("render", "ccp_doesnotexist00001", ccpStoreDirectory, ASSETS_ROOT_DIR, outputDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL/);
  });
});

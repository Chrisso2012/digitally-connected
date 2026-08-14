// DC-003-I035 — end-to-end regression coverage for the HTML Carousel
// Renderer: a real Chromium (playwright-core) render of an approved
// Carousel Content Package into 7 x 1080x1350 PNGs. Requires a system
// Chromium binary (see README "HTML Carousel Renderer" — canonical
// verification runs `apk add --no-cache chromium font-noto` first;
// override the binary location via CHROMIUM_EXECUTABLE_PATH if needed).
//
// No network, no Anthropic, no Google Docs, no Templated call is ever
// made by this renderer — guarded here by a static source-import check in
// addition to every render test simply never configuring any such
// credential/endpoint.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCarouselContentPackage } from "../../src/carousel-content-package.mjs";
import { createCarouselRenderer, RENDERER_NAME, RENDERER_VERSION } from "../../src/carousel-renderer.mjs";
import {
  InvalidCarouselRendererInputError,
  CarouselAssetResolutionError,
  CarouselCapacityValidationError,
} from "../../src/carousel-renderer-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const ASSETS_ROOT_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "carousel-renderer-assets");
const EXPECTED_TEMPLATES = ["cover_black", "content_white", "content_orange", "content_white", "content_orange", "content_white", "close_black"];

const INDUSTRY_SERIES = "Real Estate Industry Series";

function image(overrides = {}) {
  return { mode: "none", asset_reference: null, direction: null, ...overrides };
}

function buildFields(overrides = {}) {
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
      {
        slide_number: 1, role: "cover", template: "cover_black", industry_series: INDUSTRY_SERIES,
        headline: "The Myth of the Dead Database",
        supporting_line: "Why timing, not interest, is the real reason old enquiries go quiet.",
        image: image({ mode: "provided", asset_reference: "test-photo-a.png" }),
      },
      {
        slide_number: 2, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES,
        headline: "Every Enquiry Already Cost You Something",
        body: "Marketing spend, staff time and trust were already paid for the moment someone reached out.",
        image: image({ mode: "provided", asset_reference: "test-photo-b.png" }), image_layout: "corner", emphasis_instructions: [],
      },
      {
        slide_number: 3, role: "content", template: "content_orange", industry_series: INDUSTRY_SERIES,
        headline: "Speed Wins New Leads, Not Old Ones",
        body: "Agencies that respond within 24 hours convert far more often than those that don't.",
        image: image(), image_layout: "none", emphasis_instructions: [],
      },
      {
        slide_number: 4, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES,
        headline: "A CRM Is Not a Filing Cabinet",
        body: "Owning a database and actively working it are two different things.",
        image: image(), image_layout: "none", emphasis_instructions: [],
      },
      {
        slide_number: 5, role: "content", template: "content_orange", industry_series: INDUSTRY_SERIES,
        headline: "Ready vs. Not Ready Yet",
        body: "The old lens was interested or not. The better lens is ready or not ready yet.",
        image: image(), image_layout: "none",
        emphasis_instructions: [{ phrase: "ready or not ready yet", style: "highlight" }, { phrase: "interested or not", style: "strike" }],
      },
      {
        slide_number: 6, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES,
        headline: "Reopen the Conversation",
        body: "A stalled enquiry from someone who already knows your agency isn't a cold approach.",
        image: image({ mode: "provided", asset_reference: "test-photo-b.png" }), image_layout: "strip", emphasis_instructions: [],
      },
      {
        slide_number: 7, role: "close", template: "close_black", industry_series: INDUSTRY_SERIES,
        headline: "One Question Reopens the Conversation",
        body: "Ask every old enquiry: has anything changed since we last spoke?",
        soft_cta: "See what is already in your CRM.",
        image: image({ mode: "provided", asset_reference: "test-photo-a.png" }), emphasis_instructions: [],
      },
    ],
    ...overrides,
  };
}

let idCounter = 0;
function buildCcp(fieldOverrides = {}) {
  idCounter += 1;
  return createCarouselContentPackage(buildFields(fieldOverrides), { idGenerator: () => `ccp_rendertest${String(idCounter).padStart(8, "0")}` });
}

async function withTempOutputDir(fn) {
  const parent = mkdtempSync(path.join(tmpdir(), "dc003-carousel-renderer-"));
  const outputDir = path.join(parent, "output");
  try {
    return await fn(outputDir);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

function readPngDimensions(filePath) {
  const buffer = readFileSync(filePath);
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, "not a PNG file (bad signature)");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("no source file in the renderer imports Templated, Anthropic, or Google Docs integrations", () => {
  const rendererFiles = [
    "carousel-renderer.mjs",
    "carousel-renderer-templates.mjs",
    "carousel-renderer-asset-resolver.mjs",
    "carousel-renderer-emphasis-html.mjs",
    "carousel-renderer-capacity.mjs",
    "carousel-renderer-config.mjs",
    "carousel-renderer-brand.mjs",
  ];
  const importSpecifierPattern = /from\s+["']([^"']+)["']/g;
  for (const file of rendererFiles) {
    const source = readFileSync(path.join(PROJECT_ROOT, "src", file), "utf-8");
    for (const match of source.matchAll(importSpecifierPattern)) {
      const specifier = match[1];
      assert.doesNotMatch(specifier.toLowerCase(), /templated|anthropic|google/, `${file} must not import a Templated/Anthropic/Google Docs module (found "${specifier}")`);
    }
  }
});

test("renderCarousel produces exactly 7 correctly-templated, correctly-dimensioned PNGs plus render metadata", async () => {
  await withTempOutputDir(async (outputDir) => {
    const renderer = createCarouselRenderer({ assetsRootDir: ASSETS_ROOT_DIR });
    const ccp = buildCcp();
    const result = await renderer.renderCarousel(ccp, outputDir);

    assert.equal(result.carouselContentPackageId, ccp.carousel_content_package_id);
    assert.equal(result.renderer.name, RENDERER_NAME);
    assert.equal(result.renderer.version, RENDERER_VERSION);
    assert.equal(result.files.length, 7);
    assert.deepEqual(result.files.map((f) => f.template), EXPECTED_TEMPLATES);

    const filesOnDisk = readdirSync(outputDir).sort();
    assert.deepEqual(filesOnDisk, [
      "render-metadata.json",
      "slide_01.png", "slide_02.png", "slide_03.png", "slide_04.png",
      "slide_05.png", "slide_06.png", "slide_07.png",
    ]);

    for (const file of result.files) {
      const dims = readPngDimensions(path.join(outputDir, file.fileName));
      assert.deepEqual(dims, { width: 1080, height: 1350 }, `${file.fileName} must be exactly 1080x1350`);
    }

    const metadata = JSON.parse(readFileSync(path.join(outputDir, "render-metadata.json"), "utf-8"));
    assert.equal(metadata.carousel_content_package_id, ccp.carousel_content_package_id);
    assert.equal(metadata.output_files.length, 7);
    assert.equal(metadata.renderer.name, RENDERER_NAME);
  });
});

test("renderCarousel hard-fails on a missing image asset and never creates the output directory", async () => {
  await withTempOutputDir(async (outputDir) => {
    const renderer = createCarouselRenderer({ assetsRootDir: ASSETS_ROOT_DIR });
    const ccp = buildCcp({
      slides: buildFields().slides.map((slide) =>
        slide.slide_number === 1 ? { ...slide, image: image({ mode: "provided", asset_reference: "does-not-exist.png" }) } : slide
      ),
    });

    await assert.rejects(() => renderer.renderCarousel(ccp, outputDir), CarouselAssetResolutionError);
    assert.equal(existsSync(outputDir), false, "a failed render must never promote/create the output directory");
  });
});

test("renderCarousel hard-fails on overflowing copy (capacity validation) and never creates the output directory", async () => {
  await withTempOutputDir(async (outputDir) => {
    const renderer = createCarouselRenderer({ assetsRootDir: ASSETS_ROOT_DIR });
    const overflowingHeadline = "This Headline Is Deliberately Written To Be Far Too Long To Physically Fit Inside Its Fixed Bounded Container No Matter How It Wraps Across Lines";
    const ccp = buildCcp({
      slides: buildFields().slides.map((slide) =>
        slide.slide_number === 1 ? { ...slide, headline: overflowingHeadline } : slide
      ),
    });

    await assert.rejects(() => renderer.renderCarousel(ccp, outputDir), CarouselCapacityValidationError);
    assert.equal(existsSync(outputDir), false, "a failed render must never promote/create the output directory");
  });
});

test("renderCarousel rejects an outputDir that already exists", async () => {
  await withTempOutputDir(async (outputDir) => {
    const renderer = createCarouselRenderer({ assetsRootDir: ASSETS_ROOT_DIR });
    const ccp = buildCcp();
    await renderer.renderCarousel(ccp, outputDir);
    await assert.rejects(() => renderer.renderCarousel(buildCcp(), outputDir), InvalidCarouselRendererInputError);
  });
});

test("createCarouselRenderer requires assetsRootDir", () => {
  assert.throws(() => createCarouselRenderer({}), InvalidCarouselRendererInputError);
});

test("renderCarousel rejects a Carousel Content Package without exactly 7 slides", async () => {
  await withTempOutputDir(async (outputDir) => {
    const renderer = createCarouselRenderer({ assetsRootDir: ASSETS_ROOT_DIR });
    await assert.rejects(() => renderer.renderCarousel({ slides: [] }, outputDir), InvalidCarouselRendererInputError);
  });
});

test("repeat renders of the same Carousel Content Package are byte-identical (SHA-256) across all 7 slides", async () => {
  const parent = mkdtempSync(path.join(tmpdir(), "dc003-carousel-renderer-determinism-"));
  try {
    const outputDirA = path.join(parent, "run-a");
    const outputDirB = path.join(parent, "run-b");
    const renderer = createCarouselRenderer({ assetsRootDir: ASSETS_ROOT_DIR });

    // Same source CCP fields, independently constructed, each with a fixed
    // id generator — mirrors two genuinely separate render invocations of
    // "the same approved package" rather than reusing one in-memory object.
    const ccpA = createCarouselContentPackage(buildFields(), { idGenerator: () => "ccp_determinism0000001" });
    const ccpB = createCarouselContentPackage(buildFields(), { idGenerator: () => "ccp_determinism0000001" });

    const resultA = await renderer.renderCarousel(ccpA, outputDirA);
    const resultB = await renderer.renderCarousel(ccpB, outputDirB);

    assert.equal(resultA.files.length, 7);
    assert.equal(resultB.files.length, 7);

    for (let i = 0; i < resultA.files.length; i++) {
      const fileName = resultA.files[i].fileName;
      const hashA = createHash("sha256").update(readFileSync(path.join(outputDirA, fileName))).digest("hex");
      const hashB = createHash("sha256").update(readFileSync(path.join(outputDirB, fileName))).digest("hex");
      assert.equal(hashA, hashB, `${fileName} must render byte-identical PNGs across repeat renders`);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// DC-003-I035 — HTML Carousel Renderer orchestration: Approved Carousel
// Content Package -> HTML/CSS -> Chromium (Playwright) -> 7 x 1080x1350
// PNGs. Composition only — every actual decision (copy, template
// selection, image presence, emphasis) already lives in the approved
// CCP; this module mechanically executes it. No copy is ever written,
// rewritten, shortened, or reinterpreted here.
//
// Architecture, proven against carousel-poc's own three phases:
//   - fixed 420x525 CSS canvas, deviceScaleFactor = 1080/420 (never
//     redesigned at 1080px width — see carousel-renderer-brand.mjs);
//   - one isolated page per slide, full-page screenshot (never an
//     element screenshot — avoids the sub-pixel clip-rect edge-bleed
//     the POC's own README documents);
//   - document.fonts.ready + a fixed settle delay before every
//     screenshot;
//   - images embedded as base64 data URIs (carousel-renderer-asset-resolver.mjs)
//     so each rendered page is fully self-contained.
//
// Atomicity: renders into a temporary staging directory (a sibling of
// the requested output directory, for same-filesystem atomic rename)
// and only promotes it — via a single fs.renameSync — once all 7 slides
// have rendered, passed capacity validation, and been dimension-verified.
// A failure at any point leaves the real output directory untouched and
// cleans up the staging directory.

import { chromium } from "playwright-core";
import { mkdtempSync, rmSync, existsSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveImageAsset } from "./carousel-renderer-asset-resolver.mjs";
import { buildSlideHtml } from "./carousel-renderer-templates.mjs";
import { checkPageCapacity } from "./carousel-renderer-capacity.mjs";
import { resolveChromiumExecutablePath } from "./carousel-renderer-config.mjs";
import { CANVAS_WIDTH_CSS_PX, CANVAS_HEIGHT_CSS_PX, DEVICE_SCALE_FACTOR, OUTPUT_WIDTH_PX, OUTPUT_HEIGHT_PX } from "./carousel-renderer-brand.mjs";
import { InvalidCarouselRendererInputError, CarouselRenderIncompleteError } from "./carousel-renderer-errors.mjs";

export const RENDERER_NAME = "html-carousel-renderer-v1";
export const RENDERER_VERSION = "1.0.0";

const SLIDE_COUNT = 7;
const FONT_SETTLE_DELAY_MS = 150; // same fixed safeguard the proven POC used after document.fonts.ready

function readPngDimensions(buffer) {
  // PNG IHDR chunk: width at byte 16, height at byte 20, big-endian.
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function slideFileName(slideNumber) {
  return `slide_${String(slideNumber).padStart(2, "0")}.png`;
}

/**
 * Creates an HTML Carousel Renderer bound to one Chromium executable and
 * one assets root directory.
 *
 * options.chromiumExecutablePath — override the resolved Chromium binary
 *   path (used by tests); defaults to resolveChromiumExecutablePath().
 * options.assetsRootDir — required. The one directory every slide's
 *   `image.asset_reference` is resolved against (carousel-renderer-asset-resolver.mjs)
 *   — never guessed, never defaulted, mirrors this codebase's own
 *   "storage directories are always explicit" convention.
 */
export function createCarouselRenderer({ chromiumExecutablePath, assetsRootDir } = {}) {
  if (typeof assetsRootDir !== "string" || assetsRootDir.trim() === "") {
    throw new InvalidCarouselRendererInputError("createCarouselRenderer requires options.assetsRootDir (a non-empty string)");
  }
  const executablePath = chromiumExecutablePath ?? resolveChromiumExecutablePath();

  /**
   * Renders one approved Carousel Content Package to 7 PNG files plus a
   * small render-metadata.json, atomically, into `outputDir`.
   *
   * carouselContentPackage — an already-validated CCP record (e.g. from
   *   carousel-content-package-store.mjs's own get()).
   * outputDir — required. Must not already exist (this renderer never
   *   overwrites a prior output set — mirrors this codebase's own
   *   store "never overwrite" discipline).
   *
   * Returns { carouselContentPackageId, outputDir, files, renderedAt,
   *   renderer: { name, version } }.
   *
   * Throws InvalidCarouselRendererInputError for a malformed CCP or an
   * outputDir that already exists. Throws CarouselAssetResolutionError /
   * CarouselCapacityValidationError / CarouselRenderIncompleteError on
   * the corresponding production failure — in every case, the real
   * outputDir is left untouched and any staging directory is removed.
   */
  async function renderCarousel(carouselContentPackage, outputDir) {
    if (!carouselContentPackage || !Array.isArray(carouselContentPackage.slides) || carouselContentPackage.slides.length !== SLIDE_COUNT) {
      throw new InvalidCarouselRendererInputError("renderCarousel requires a Carousel Content Package with exactly 7 slides");
    }
    if (typeof outputDir !== "string" || outputDir.trim() === "") {
      throw new InvalidCarouselRendererInputError("renderCarousel requires a non-empty outputDir");
    }
    if (existsSync(outputDir)) {
      throw new InvalidCarouselRendererInputError(`outputDir "${outputDir}" already exists — this renderer never overwrites a prior output set`);
    }

    const parentDir = path.dirname(path.resolve(outputDir));
    const stagingDir = mkdtempSync(path.join(parentDir, ".carousel-render-staging-"));

    let browser;
    try {
      browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-setuid-sandbox"] });

      const files = [];
      for (const slide of carouselContentPackage.slides) {
        const imageDataUri = resolveImageAsset(slide.image, slide.slide_number, assetsRootDir);
        const html = buildSlideHtml(slide, { imageDataUri });

        const page = await browser.newPage({
          viewport: { width: CANVAS_WIDTH_CSS_PX, height: CANVAS_HEIGHT_CSS_PX },
          deviceScaleFactor: DEVICE_SCALE_FACTOR,
        });
        try {
          await page.setContent(html, { waitUntil: "load" });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(FONT_SETTLE_DELAY_MS);

          await checkPageCapacity(page, { slideNumber: slide.slide_number, template: slide.template });

          const fileName = slideFileName(slide.slide_number);
          const filePath = path.join(stagingDir, fileName);
          const buffer = await page.screenshot({ path: filePath });

          const dimensions = readPngDimensions(buffer);
          if (dimensions.width !== OUTPUT_WIDTH_PX || dimensions.height !== OUTPUT_HEIGHT_PX) {
            throw new CarouselRenderIncompleteError(
              `slide ${slide.slide_number} rendered at ${dimensions.width}x${dimensions.height}, expected ${OUTPUT_WIDTH_PX}x${OUTPUT_HEIGHT_PX}`
            );
          }

          files.push({ slideNumber: slide.slide_number, template: slide.template, fileName, width: dimensions.width, height: dimensions.height });
        } finally {
          await page.close();
        }
      }

      if (files.length !== SLIDE_COUNT) {
        throw new CarouselRenderIncompleteError(`only ${files.length}/${SLIDE_COUNT} slides rendered`);
      }

      const renderedAt = new Date().toISOString();
      const metadata = {
        carousel_content_package_id: carouselContentPackage.carousel_content_package_id,
        output_files: files.map((f) => ({ slide_number: f.slideNumber, template: f.template, file_name: f.fileName, width: f.width, height: f.height })),
        rendered_at: renderedAt,
        renderer: { name: RENDERER_NAME, version: RENDERER_VERSION },
      };
      writeFileSync(path.join(stagingDir, "render-metadata.json"), JSON.stringify(metadata, null, 2));

      // Atomic promotion — single rename, same filesystem (staging is a
      // sibling of outputDir), all-or-nothing.
      renameSync(stagingDir, outputDir);

      return {
        carouselContentPackageId: carouselContentPackage.carousel_content_package_id,
        outputDir,
        files,
        renderedAt,
        renderer: { name: RENDERER_NAME, version: RENDERER_VERSION },
      };
    } catch (error) {
      if (existsSync(stagingDir)) {
        rmSync(stagingDir, { recursive: true, force: true });
      }
      throw error;
    } finally {
      if (browser) await browser.close();
    }
  }

  return { renderCarousel };
}

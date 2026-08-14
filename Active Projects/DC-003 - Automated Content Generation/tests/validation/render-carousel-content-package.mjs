// DC-003-I035 — CLI for the HTML Carousel Renderer: renders one already
// -approved, already-stored Carousel Content Package to 7 PNGs + render
// metadata. No network, no Anthropic, no Google Docs, no Templated — a
// real local Chromium render only.
//
// Usage:
//   node tests/validation/render-carousel-content-package.mjs render <carouselContentPackageId> <ccpStoreDirectory> <assetsRootDir> <outputDir>
//
//   or: npm run render:html-carousel -- render <carouselContentPackageId> <ccpStoreDirectory> <assetsRootDir> <outputDir>
//
// Requires a real Chromium binary — see README "HTML Carousel Renderer"
// for the canonical `apk add --no-cache chromium` setup this CLI expects
// (override via CHROMIUM_EXECUTABLE_PATH if the binary lives elsewhere).

import { createCarouselContentPackageStore } from "../../src/carousel-content-package-store.mjs";
import { createLocalJsonCarouselContentPackageStoreAdapter } from "../../src/local-json-carousel-content-package-store-adapter.mjs";
import { createCarouselRenderer } from "../../src/carousel-renderer.mjs";
import {
  InvalidCarouselRendererInputError,
  CarouselAssetResolutionError,
  CarouselCapacityValidationError,
  CarouselRenderIncompleteError,
} from "../../src/carousel-renderer-errors.mjs";
import {
  InvalidCarouselContentPackageIdentifierError,
  CarouselContentPackageNotFoundError,
  CorruptedCarouselContentPackageError,
} from "../../src/carousel-content-package-errors.mjs";

const KNOWN_ERRORS = [
  InvalidCarouselRendererInputError,
  CarouselAssetResolutionError,
  CarouselCapacityValidationError,
  CarouselRenderIncompleteError,
  InvalidCarouselContentPackageIdentifierError,
  CarouselContentPackageNotFoundError,
  CorruptedCarouselContentPackageError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error(
    "  node tests/validation/render-carousel-content-package.mjs render <carouselContentPackageId> <ccpStoreDirectory> <assetsRootDir> <outputDir>"
  );
  process.exit(1);
}

const [subcommand, ...rest] = process.argv.slice(2);

if (!subcommand) usageAndExit();

try {
  if (subcommand === "render") {
    const [carouselContentPackageId, ccpStoreDirectory, assetsRootDir, outputDir] = rest;
    if (!carouselContentPackageId || !ccpStoreDirectory || !assetsRootDir || !outputDir) usageAndExit();

    const ccpStore = createCarouselContentPackageStore({ adapter: createLocalJsonCarouselContentPackageStoreAdapter({ storageDir: ccpStoreDirectory }) });
    const carouselContentPackage = ccpStore.get(carouselContentPackageId);

    const renderer = createCarouselRenderer({ assetsRootDir });
    const result = await renderer.renderCarousel(carouselContentPackage, outputDir);

    console.log("Carousel rendered OK");
    console.log(`  carousel_content_package_id: ${result.carouselContentPackageId}`);
    console.log(`  output_dir:                  ${result.outputDir}`);
    console.log(`  rendered_at:                 ${result.renderedAt}`);
    console.log(`  renderer:                    ${result.renderer.name} v${result.renderer.version}`);
    for (const file of result.files) {
      console.log(`    [slide ${file.slideNumber}] ${file.template.padEnd(14)} ${file.fileName} (${file.width}x${file.height})`);
    }
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (KNOWN_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

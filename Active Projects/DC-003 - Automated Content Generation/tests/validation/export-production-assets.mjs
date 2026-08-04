// DC-003-I021 — CLI for the Production Asset Export Service: loads an
// approved, completed Finished Carousel from the I015 Finished Carousel
// Store and exports it to the local filesystem — six ordered PNGs plus
// metadata.json. Local filesystem only; no cloud upload (out of scope for
// I021 — see README "Production Asset Export").
//
// Usage:
//   node tests/validation/export-production-assets.mjs <carouselId> <storeDirectory> <destination>
//   or: npm run export:assets -- <carouselId> <storeDirectory> <destination>
//
// `storeDirectory` is a required, explicit argument — no default, no env
// var — matching every other storage-directory-taking CLI in this
// repository (I015's `store`, I016's `content:request`, I020's
// `production:live`). The brief's own example
// (`npm run export:assets -- car_9c026a104e3745c3 /exports`) omits it;
// this CLI adds it as the required middle argument instead of hardcoding
// or defaulting a store location, per repository evidence (every other
// CLI in this codebase treats "which store" as something a caller must
// always say explicitly).
//
// Downloads real image bytes from each slide's own `image_url` (a public
// CDN link — no credentials involved) — this is the one network activity
// this CLI performs; it is not a credentialed provider call and needs no
// live-verification gate the way Anthropic/Templated API calls do.
// Re-running against an already-exported carousel makes zero network
// requests (see local-production-asset-export-adapter.mjs's own
// idempotency behaviour).

import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createLocalProductionAssetExportAdapter } from "../../src/local-production-asset-export-adapter.mjs";
import { executeProductionAssetExport } from "../../src/production-asset-export-service.mjs";
import {
  InvalidExportAdapterError,
  InvalidFinishedCarouselForExportError,
  CarouselNotEligibleForExportError,
  InvalidExportDestinationError,
  SlideDownloadError,
  ExportPersistenceError,
} from "../../src/production-asset-export-errors.mjs";
import {
  InvalidCarouselIdentifierError,
  CarouselNotFoundError,
  CorruptedCarouselError,
  CarouselPersistenceError,
} from "../../src/finished-carousel-store-errors.mjs";

const [carouselId, storeDirectory, destination] = process.argv.slice(2);

function usageAndExit() {
  console.error("Usage: node tests/validation/export-production-assets.mjs <carouselId> <storeDirectory> <destination>");
  console.error("Example: node tests/validation/export-production-assets.mjs car_9c026a104e3745c3 ./output/finished-carousels /exports");
  process.exit(1);
}

if (!carouselId || !storeDirectory || !destination) usageAndExit();

try {
  const carouselStore = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: storeDirectory }) });
  const finishedCarousel = carouselStore.get(carouselId);

  const adapter = createLocalProductionAssetExportAdapter();
  const result = await executeProductionAssetExport(finishedCarousel, destination, { adapter });

  console.log(result.alreadyExported ? "Export already complete (no download performed)" : "Export complete");
  console.log(`  status:          ${result.status}`);
  console.log(`  asset package ID: ${result.assetPackageId}`);
  console.log(`  export path:     ${result.exportPath}`);
  console.log(`  slide count:     ${result.slideCount}`);
  console.log(`  files exported:  ${result.filesExported}`);
  console.log(`  already exported: ${result.alreadyExported}`);

  process.exit(0);
} catch (error) {
  if (
    error instanceof InvalidCarouselIdentifierError ||
    error instanceof CarouselNotFoundError ||
    error instanceof CorruptedCarouselError ||
    error instanceof CarouselPersistenceError ||
    error instanceof InvalidExportAdapterError ||
    error instanceof InvalidFinishedCarouselForExportError ||
    error instanceof CarouselNotEligibleForExportError ||
    error instanceof InvalidExportDestinationError ||
    error instanceof SlideDownloadError ||
    error instanceof ExportPersistenceError
  ) {
    // Safe, structured diagnostics only — every error class listed above
    // already constructs a message with no raw filesystem path, no raw
    // HTTP response body, and no stack trace (see
    // production-asset-export-errors.mjs / finished-carousel-store-errors.mjs).
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

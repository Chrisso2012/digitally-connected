// DC-003-I026 — CLI for the Windows Production Asset Export Service:
// delivers an already-approved, completed carousel to BOTH the durable
// Docker archive (via I021, unmodified) and a Windows-visible delivery
// folder bind-mounted into this container. Uses the configured archive/
// Windows-delivery roots (see windows-production-export-config.mjs) so a
// caller never has to type a raw Docker path.
//
// Usage:
//   node tests/validation/export-production-assets-windows.mjs <carouselId> <finishedCarouselStoreDirectory> [--replace]
//   or: npm run export:windows -- <carouselId> <finishedCarouselStoreDirectory> [--replace]
//
// This CLI never generates, renders, approves, or publishes anything — it
// only loads an already-stored, already-approved Finished Carousel (I015,
// unchanged) and delivers its already-rendered assets. No network calls
// beyond whatever I021's own idempotent archive step itself may need on a
// genuinely first-ever export (image downloads from Templated's CDN,
// exactly as I021 already documents) — a re-run against an
// already-archived carousel makes zero network requests, per I021's own
// existing idempotency guarantee.

import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import {
  InvalidCarouselStoreAdapterError,
  InvalidCarouselIdentifierError,
  CarouselNotFoundError,
  CorruptedCarouselError,
  CarouselPersistenceError,
} from "../../src/finished-carousel-store-errors.mjs";
import { createLocalProductionAssetExportAdapter } from "../../src/local-production-asset-export-adapter.mjs";
import {
  InvalidExportAdapterError,
  InvalidFinishedCarouselForExportError,
  CarouselNotEligibleForExportError,
  InvalidExportDestinationError,
  SlideDownloadError,
  ExportPersistenceError,
} from "../../src/production-asset-export-errors.mjs";
import { loadWindowsProductionExportConfig } from "../../src/windows-production-export-config.mjs";
import { executeWindowsProductionExport } from "../../src/windows-production-export-service.mjs";
import {
  WindowsDeliveryConflictError,
  WindowsDeliveryPartialPackageError,
  WindowsDeliveryPersistenceError,
  WindowsDeliveryVerificationError,
} from "../../src/windows-production-export-errors.mjs";

const KNOWN_ERRORS = [
  InvalidCarouselStoreAdapterError,
  InvalidCarouselIdentifierError,
  CarouselNotFoundError,
  CorruptedCarouselError,
  CarouselPersistenceError,
  InvalidExportAdapterError,
  InvalidFinishedCarouselForExportError,
  CarouselNotEligibleForExportError,
  InvalidExportDestinationError,
  SlideDownloadError,
  ExportPersistenceError,
  WindowsDeliveryConflictError,
  WindowsDeliveryPartialPackageError,
  WindowsDeliveryPersistenceError,
  WindowsDeliveryVerificationError,
];

function usageAndExit() {
  console.error("Usage: node tests/validation/export-production-assets-windows.mjs <carouselId> <finishedCarouselStoreDirectory> [--replace]");
  console.error("Example: node tests/validation/export-production-assets-windows.mjs car_9c026a104e3745c3 /home/node/.n8n/dc003/finished-carousels");
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const replace = rawArgs.includes("--replace");
const [carouselId, finishedCarouselStoreDirectory] = rawArgs.filter((arg) => !arg.startsWith("--"));

if (!carouselId || !finishedCarouselStoreDirectory) usageAndExit();

try {
  const { archiveRoot, windowsDeliveryRoot } = loadWindowsProductionExportConfig();

  const finishedCarouselStore = createFinishedCarouselStore({
    adapter: createLocalJsonCarouselStoreAdapter({ storageDir: finishedCarouselStoreDirectory }),
  });
  const archiveAdapter = createLocalProductionAssetExportAdapter();

  const result = await executeWindowsProductionExport(
    { carouselId },
    { finishedCarouselStore, archiveAdapter, archiveRoot, windowsDeliveryRoot, replace }
  );

  console.log("Windows Production Asset Export complete");
  console.log(`  carousel ID:          ${result.carouselId}`);
  console.log(`  asset package ID:     ${result.assetPackageId}`);
  console.log(`  archive status:       ${result.archive.status}`);
  console.log(`  windows delivery:     ${result.windowsDelivery.status}`);
  console.log(`  files copied:         ${result.windowsDelivery.filesCopied}`);
  console.log(`  integrity verified:   ${result.verifiedIdentical}`);
  console.log(`  windows folder:       ${windowsDeliveryRoot}/${result.carouselId}`);
  console.log("  (the path above is the container-visible mount point — see README for the real Windows folder it maps to)");

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

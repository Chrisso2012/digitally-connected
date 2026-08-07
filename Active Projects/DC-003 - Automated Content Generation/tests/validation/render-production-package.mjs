// DC-003-I034 — CLI for the Carousel Rendering Engine: renders one
// Production Package into one persisted Finished Carousel. Mock transport
// by default (no network, deterministic) — the ONLY mode automated tests
// use; pass --live to use the real Templated HTTP transport instead
// (requires TEMPLATED_API_KEY — see README "Live Request Safety").
// Consumes ONLY a Production Package record by ID — never reads Social
// Media Package, Editorial Package, Ingested Content, Google Docs, or a
// raw article — per the explicit architectural boundary set before this
// milestone began.
//
// Usage:
//   node tests/validation/render-production-package.mjs <productionPackageId> <productionPackageStoreDirectory> <finishedCarouselStoreDirectory> [--live] [--live-max-attempts=N]
//
//   or: npm run render-production-package -- <productionPackageId> <productionPackageStoreDirectory> <finishedCarouselStoreDirectory> [--live]
//
// DC-003-I006's own Live Verification Gate safety rule applies
// identically here: --live defaults to exactly one attempt PER SLIDE,
// independent of TEMPLATED_RENDER_MAX_ATTEMPTS, unless
// --live-max-attempts=N is explicitly given. A full 6-slide --live run
// therefore sends AT MOST 6 real Templated requests by default (one per
// slide, no retries) — see README "Live Request Safety" for the exact
// request-budget report required before any real run is authorised.
//
// Asset export (I021/I026) is deliberately NOT composed into this CLI:
// production-asset-export-service.mjs requires
// finishedCarousel.approval.approved === true, and a carousel this CLI
// just rendered is never yet approved (no auto-approval exists anywhere
// in this codebase) — composing export here would be dead code in every
// real invocation. Export remains the documented next operational step
// (see README "Asset export").

import { createProductionPackageStore } from "../../src/production-package-store.mjs";
import { createLocalJsonProductionPackageStoreAdapter } from "../../src/local-json-production-package-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { renderProductionPackage } from "../../src/carousel-rendering-engine.mjs";
import { createTemplatedRendererAdapter } from "../../src/templated-renderer-adapter.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { createHttpTransport } from "../../src/renderer-transport-http.mjs";
import { loadRendererConfig, resolveLiveMaxAttempts } from "../../src/renderer-config.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { DuplicateRenderError } from "../../src/carousel-rendering-engine-errors.mjs";
import { RendererError } from "../../src/renderer-errors.mjs";
import { FinishedCarouselCompositionError, FinishedCarouselValidationError } from "../../src/finished-carousel-errors.mjs";
import {
  InvalidProductionPackageStoreAdapterError,
  InvalidProductionPackageIdentifierError,
  ProductionPackageNotFoundError,
  CorruptedProductionPackageError,
  ProductionPackagePersistenceError,
  InvalidRendererAdapterError,
  RequiredRendererMappingMissingError,
  InvalidTemplateMappingError,
} from "../../src/production-package-errors.mjs";
import {
  InvalidFinishedCarouselError,
  InvalidCarouselIdentifierError,
  CarouselAlreadyExistsError,
  CorruptedCarouselError,
  CarouselPersistenceError,
} from "../../src/finished-carousel-store-errors.mjs";

const KNOWN_ERRORS = [
  PipelineConfigurationError,
  DuplicateRenderError,
  RendererError,
  FinishedCarouselCompositionError,
  FinishedCarouselValidationError,
  InvalidProductionPackageStoreAdapterError,
  InvalidProductionPackageIdentifierError,
  ProductionPackageNotFoundError,
  CorruptedProductionPackageError,
  ProductionPackagePersistenceError,
  InvalidRendererAdapterError,
  RequiredRendererMappingMissingError,
  InvalidTemplateMappingError,
  InvalidFinishedCarouselError,
  InvalidCarouselIdentifierError,
  CarouselAlreadyExistsError,
  CorruptedCarouselError,
  CarouselPersistenceError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error(
    "  node tests/validation/render-production-package.mjs <productionPackageId> <productionPackageStoreDirectory> <finishedCarouselStoreDirectory> [--live] [--live-max-attempts=N]"
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const isLive = args.includes("--live");
const liveMaxAttemptsArg = args.find((arg) => arg.startsWith("--live-max-attempts="));
const liveMaxAttemptsValue = liveMaxAttemptsArg ? liveMaxAttemptsArg.split("=")[1] : undefined;
const positional = args.filter((arg) => !arg.startsWith("--"));
const [productionPackageId, productionPackageStoreDirectory, finishedCarouselStoreDirectory] = positional;

if (!productionPackageId || !productionPackageStoreDirectory || !finishedCarouselStoreDirectory) usageAndExit();

try {
  const productionPackageStore = createProductionPackageStore({ adapter: createLocalJsonProductionPackageStoreAdapter({ storageDir: productionPackageStoreDirectory }) });
  const finishedCarouselStore = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: finishedCarouselStoreDirectory }) });
  const rendererAdapter = createTemplatedRendererAdapter();

  const config = loadRendererConfig();
  let transport;
  let maxAttempts;

  if (isLive) {
    if (!config.apiKey) {
      console.error("FAIL  --live requires TEMPLATED_API_KEY to be set in the environment");
      process.exit(1);
    }
    maxAttempts = resolveLiveMaxAttempts(liveMaxAttemptsValue); // throws RangeError on a bad override
    console.log(`Rendering LIVE via Templated (${config.baseUrl}) — this performs up to 6 real API calls (one per slide).`);
    console.log(
      `  maxAttempts per slide: ${maxAttempts}${liveMaxAttemptsValue ? " (explicit --live-max-attempts override)" : " (safe default, independent of TEMPLATED_RENDER_MAX_ATTEMPTS)"}`
    );
    transport = createHttpTransport(config);
  } else {
    maxAttempts = config.maxAttempts;
    transport = createMockTransport();
  }

  const finishedCarousel = await renderProductionPackage(productionPackageId, {
    productionPackageStore,
    finishedCarouselStore,
    rendererAdapter,
    transport,
    maxAttempts,
    timeoutMs: config.requestTimeoutMs,
  });

  console.log("Finished Carousel rendered OK");
  console.log(`  carousel_id:              ${finishedCarousel.carousel_id}`);
  console.log(`  production_package_id:    ${finishedCarousel.production_package_id}`);
  console.log(`  overall_status:           ${finishedCarousel.overall_status}`);
  console.log(`  slides:                   ${finishedCarousel.metadata.completed_slides}/${finishedCarousel.metadata.total_slides} completed`);
  console.log(`  total_duration_ms:        ${finishedCarousel.metadata.total_duration_ms}`);
  console.log(`  execution_id:             ${finishedCarousel.execution_metadata.execution_id}`);
  console.log(`  provider:                 ${finishedCarousel.execution_metadata.provider}`);
  for (const slide of finishedCarousel.slides) {
    console.log(`    [slide ${slide.slide_number}] ${slide.slide_type} — ${slide.status} — ${slide.image_url}`);
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

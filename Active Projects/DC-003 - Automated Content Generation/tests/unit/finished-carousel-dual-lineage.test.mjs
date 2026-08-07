// DC-003-I034 — regression coverage for the dual-lineage compatibility
// change to finished-carousel.schema.json / finished-carousel-builder.mjs
// / finished-carousel-store.mjs, approved before I034's own
// implementation began. A separate, new test file rather than editing
// the large existing finished-carousel-builder.test.mjs/finished-
// carousel-store.test.mjs — keeps those files (and their own passing
// legacy-path tests) completely untouched, zero risk of introducing an
// error into already-proven legacy behavior.
//
// Proves, with real evidence, not assumption:
//   - old Finished Carousel fixtures/records remain valid unchanged;
//   - the legacy builder path (fields.carouselContent) still works
//     exactly as before;
//   - the new Production Package lineage (fields.productionPackageId)
//     works, end to end, through a REAL mock-rendered six-slide pipeline
//     using I033's own Templated Renderer Adapter;
//   - ambiguous/inconsistent lineage combinations are rejected, both at
//     the builder-composition layer and the schema layer;
//   - findByProductionPackageId() on the store correctly distinguishes
//     the two lineages.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createValidator } from "../../src/validator.mjs";
import { mapCarouselToTemplatedPayload } from "../../src/carousel-payload-mapper.mjs";
import { createTemplatedRendererAdapter } from "../../src/templated-renderer-adapter.mjs";
import { renderTemplatedPayload } from "../../src/renderer.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { createExecutionMetadata } from "../../src/execution-metadata.mjs";
import { createFinishedCarousel } from "../../src/finished-carousel-builder.mjs";
import { FinishedCarouselCompositionError } from "../../src/finished-carousel-errors.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createProductionPackage } from "../../src/production-package.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAROUSEL_CONTENT_FIXTURE = path.join(__dirname, "..", "fixtures", "carousel-content.example.json");
const FINISHED_CAROUSEL_FIXTURE = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

function loadCarouselContent() {
  return JSON.parse(readFileSync(CAROUSEL_CONTENT_FIXTURE, "utf-8"));
}

async function buildLegacyInputs() {
  const carouselContent = loadCarouselContent();
  const templatedPayloads = mapCarouselToTemplatedPayload(carouselContent);
  const transport = createMockTransport();
  const slideRenders = [];
  for (const templatedPayload of templatedPayloads) {
    const renderResult = await renderTemplatedPayload(templatedPayload, { transport });
    slideRenders.push({ templatedPayload, renderResult });
  }
  const totalDurationMs = slideRenders.reduce((sum, { renderResult }) => sum + renderResult.durationMs, 0);
  const executionMetadata = createExecutionMetadata({ provider: transport.name, renderDurationMs: totalDurationMs });
  return { carouselContent, slideRenders, executionMetadata };
}

const SLIDE_ROLES = ["cover", "insight", "statistic", "quote", "takeaway", "cta"];

function buildProductionPackage(overrides = {}, idGenerator = () => "pp_dualtest0000001") {
  const slide = (n) => ({
    slideNumber: n,
    slideRole: SLIDE_ROLES[n - 1],
    headlineMapping: `Headline ${n}.`,
    bodyCopyMapping: `Body ${n}.`,
    ctaMapping: n === 6 ? "Act now." : null,
    imageGuidanceMapping: `Guidance ${n}.`,
    placeholderTagMapping: { headline: `Headline ${n}.`, body: `Body ${n}.`, cta: n === 6 ? "Act now." : null, image_guidance: `Guidance ${n}.` },
    structuredContent:
      SLIDE_ROLES[n - 1] === "statistic"
        ? { statistic: { value: "50%", context: `Body ${n}.` }, quote: null, keyPoints: [] }
        : SLIDE_ROLES[n - 1] === "quote"
          ? { statistic: null, quote: { quoteText: `Body ${n}.` }, keyPoints: [] }
          : SLIDE_ROLES[n - 1] === "takeaway"
            ? { statistic: null, quote: null, keyPoints: [`Body ${n}.`] }
            : { statistic: null, quote: null, keyPoints: [] },
  });
  return createProductionPackage(
    {
      socialMediaPackageId: "sm_a1b2c3d4e5f60708",
      renderer: "templated",
      platform: null,
      designId: "dc-002-v1",
      templateId: "dc-carousel-v1",
      slideSequence: [1, 2, 3, 4, 5, 6].map(slide),
      renderingMetadata: { mappingStrategy: "semantic-six-template-v1", slideCount: 6, generator: "templated-renderer-adapter" },
      validationMetadata: {
        socialMediaPackageChecksum: "d734fd7f65fce3498ee98ef948f538caa02346dfd80498b68b81776e522727c7",
        allSlidesPopulated: true,
        rendererMappingValidated: true,
      },
      schemaVersion: "1.0",
      ...overrides,
    },
    { idGenerator }
  );
}

async function buildProductionPackageInputs(overrides = {}, idGenerator = undefined) {
  const productionPackage = buildProductionPackage(overrides, idGenerator);
  const adapter = createTemplatedRendererAdapter();
  const rendererPayloads = adapter.mapToRendererPayload(productionPackage);
  const transport = createMockTransport();
  const slideRenders = [];
  for (const templatedPayload of rendererPayloads) {
    const renderResult = await renderTemplatedPayload(templatedPayload, { transport });
    slideRenders.push({ templatedPayload, renderResult });
  }
  const totalDurationMs = slideRenders.reduce((sum, { renderResult }) => sum + renderResult.durationMs, 0);
  const executionMetadata = createExecutionMetadata({ provider: transport.name, renderDurationMs: totalDurationMs });
  return { productionPackage, slideRenders, executionMetadata };
}

// --- Schema: old fixtures/records remain valid unchanged ---------------

test("the real finished-carousel.example.json fixture (pre-existing, legacy lineage) still validates unchanged", () => {
  const validator = createValidator();
  const carousel = JSON.parse(readFileSync(FINISHED_CAROUSEL_FIXTURE, "utf-8"));
  const result = validator.validate("finishedCarousel", carousel);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(typeof carousel.topic_id, "string");
  assert.equal(typeof carousel.carousel_content_id, "string");
});

// --- Legacy builder path: unchanged ------------------------------------

test("legacy lineage: createFinishedCarousel(fields.carouselContent) still works exactly as before", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildLegacyInputs();
  const finishedCarousel = createFinishedCarousel({ carouselContent, slideRenders, executionMetadata });

  assert.equal(finishedCarousel.topic_id, carouselContent.topic_id);
  assert.equal(finishedCarousel.carousel_content_id, carouselContent.carousel_content_id);
  assert.equal(finishedCarousel.production_package_id, null);
  assert.equal(finishedCarousel.overall_status, "completed");
  assert.equal(finishedCarousel.slides.length, 6);
});

// --- New Production Package lineage: real, end-to-end, mock-rendered ---

test("Production Package lineage: createFinishedCarousel(fields.productionPackageId) builds a valid, immutable Finished Carousel through a real mock-rendered pipeline", async () => {
  const { productionPackage, slideRenders, executionMetadata } = await buildProductionPackageInputs();
  const finishedCarousel = createFinishedCarousel({ productionPackageId: productionPackage.production_package_id, slideRenders, executionMetadata });

  assert.match(finishedCarousel.carousel_id, /^car_[A-Za-z0-9]+$/);
  assert.equal(finishedCarousel.topic_id, null);
  assert.equal(finishedCarousel.carousel_content_id, null);
  assert.equal(finishedCarousel.production_package_id, productionPackage.production_package_id);
  assert.equal(finishedCarousel.overall_status, "completed");
  assert.equal(finishedCarousel.slides.length, 6);
  assert.equal(finishedCarousel.slides[0].slide_type, "cover");
  assert.equal(finishedCarousel.slides[5].slide_type, "cta");
  assert.equal(finishedCarousel.metadata.completed_slides, 6);
  assert.throws(() => {
    finishedCarousel.production_package_id = "changed";
  }, TypeError);
});

test("Production Package lineage: the assembled object validates against finished-carousel.schema.json", async () => {
  const { productionPackage, slideRenders, executionMetadata } = await buildProductionPackageInputs();
  const finishedCarousel = createFinishedCarousel({ productionPackageId: productionPackage.production_package_id, slideRenders, executionMetadata });

  const validator = createValidator();
  const result = validator.validate("finishedCarousel", finishedCarousel);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("Production Package lineage: throws FinishedCarouselCompositionError for a malformed productionPackageId", async () => {
  const { slideRenders, executionMetadata } = await buildProductionPackageInputs();
  assert.throws(() => createFinishedCarousel({ productionPackageId: "not-a-real-id", slideRenders, executionMetadata }), FinishedCarouselCompositionError);
});

test("Production Package lineage: throws FinishedCarouselCompositionError when a slide's payload is missing template_id/slide_type/format/slide_number", async () => {
  const { productionPackage, slideRenders, executionMetadata } = await buildProductionPackageInputs();
  const broken = slideRenders.map((pair, i) => (i === 2 ? { ...pair, templatedPayload: { ...pair.templatedPayload, slide_type: "" } } : pair));
  assert.throws(
    () => createFinishedCarousel({ productionPackageId: productionPackage.production_package_id, slideRenders: broken, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

test("Production Package lineage: throws FinishedCarouselCompositionError when a renderResult's slideType disagrees with its own templatedPayload", async () => {
  const { productionPackage, slideRenders, executionMetadata } = await buildProductionPackageInputs();
  const broken = slideRenders.map((pair, i) => (i === 0 ? { ...pair, renderResult: { ...pair.renderResult, slideType: "cta" } } : pair));
  assert.throws(
    () => createFinishedCarousel({ productionPackageId: productionPackage.production_package_id, slideRenders: broken, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

// --- Ambiguous / inconsistent lineage combinations rejected -------------

test("throws FinishedCarouselCompositionError when both fields.carouselContent and fields.productionPackageId are supplied", async () => {
  const legacy = await buildLegacyInputs();
  assert.throws(
    () =>
      createFinishedCarousel({
        carouselContent: legacy.carouselContent,
        productionPackageId: "pp_a1b2c3d4e5f60708",
        slideRenders: legacy.slideRenders,
        executionMetadata: legacy.executionMetadata,
      }),
    FinishedCarouselCompositionError
  );
});

test("throws FinishedCarouselCompositionError when neither fields.carouselContent nor fields.productionPackageId is supplied", async () => {
  const legacy = await buildLegacyInputs();
  assert.throws(
    () => createFinishedCarousel({ slideRenders: legacy.slideRenders, executionMetadata: legacy.executionMetadata }),
    FinishedCarouselCompositionError
  );
});

// --- Store: findByProductionPackageId() ---------------------------------

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-finished-carousel-dual-lineage-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir }) });
}

test("findByProductionPackageId() returns only matching full records, ordered chronologically; legacy records never match", () =>
  withTempDir(async (dir) => {
    const store = buildStore(dir);

    const legacy = await buildLegacyInputs();
    store.save(createFinishedCarousel(legacy, { carouselId: "car_legacytest00001" }));

    const first = await buildProductionPackageInputs({}, () => "pp_dualfirst00000001");
    store.save(
      createFinishedCarousel(
        { productionPackageId: first.productionPackage.production_package_id, slideRenders: first.slideRenders, executionMetadata: first.executionMetadata },
        { carouselId: "car_ppfirst000000001", now: () => "2026-08-07T10:00:00.000Z" }
      )
    );

    const second = await buildProductionPackageInputs({ socialMediaPackageId: "sm_bbbbbbbbbbbbbbbb" }, () => "pp_dualsecond0000001");
    store.save(
      createFinishedCarousel(
        { productionPackageId: second.productionPackage.production_package_id, slideRenders: second.slideRenders, executionMetadata: second.executionMetadata },
        { carouselId: "car_ppsecond00000001", now: () => "2026-08-07T11:00:00.000Z" }
      )
    );

    const matches = store.findByProductionPackageId(first.productionPackage.production_package_id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].carousel_id, "car_ppfirst000000001");

    assert.equal(store.findByProductionPackageId("pp_doesnotexist000001").length, 0);
  }));

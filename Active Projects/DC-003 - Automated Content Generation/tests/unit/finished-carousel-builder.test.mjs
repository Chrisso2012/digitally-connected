import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mapCarouselToTemplatedPayload } from "../../src/carousel-payload-mapper.mjs";
import { renderTemplatedPayload } from "../../src/renderer.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { createExecutionMetadata } from "../../src/execution-metadata.mjs";
import { createFinishedCarousel } from "../../src/finished-carousel-builder.mjs";
import { FinishedCarouselCompositionError, FinishedCarouselValidationError } from "../../src/finished-carousel-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAROUSEL_CONTENT_FIXTURE = path.join(__dirname, "..", "fixtures", "carousel-content.example.json");

function loadCarouselContent() {
  return JSON.parse(readFileSync(CAROUSEL_CONTENT_FIXTURE, "utf-8"));
}

// Builds one fully-valid, real (mock-rendered) set of inputs — the same
// pipeline the build-finished-carousel.mjs CLI runs, entirely offline.
async function buildValidInputs() {
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

// --- Successful construction ------------------------------------------

test("a valid set of inputs builds a well-formed, immutable Finished Carousel Object", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const finishedCarousel = createFinishedCarousel({ carouselContent, slideRenders, executionMetadata });

  assert.match(finishedCarousel.carousel_id, /^car_[A-Za-z0-9]+$/);
  assert.equal(finishedCarousel.topic_id, carouselContent.topic_id);
  assert.equal(finishedCarousel.carousel_content_id, carouselContent.carousel_content_id);
  assert.equal(finishedCarousel.overall_status, "completed");
  assert.equal(finishedCarousel.slides.length, 6);
  assert.equal(finishedCarousel.metadata.total_slides, 6);
  assert.equal(finishedCarousel.metadata.completed_slides, 6);
  assert.equal(finishedCarousel.metadata.failed_slides, 0);
  assert.equal(finishedCarousel.execution_metadata.execution_id, executionMetadata.executionId);
  assert.equal(finishedCarousel.execution_metadata.provider, "mock-transport");
  assert.deepEqual(finishedCarousel.approval, {
    approved: false,
    approved_by: null,
    approved_at: null,
    rejected: false,
    rejection_reason: null,
    published: false,
    published_at: null,
  });
});

test("does not expose RenderResult or TemplatedPayload shapes directly — only the documented Finished Carousel fields", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const finishedCarousel = createFinishedCarousel({ carouselContent, slideRenders, executionMetadata });

  const slideKeys = Object.keys(finishedCarousel.slides[0]).sort();
  assert.deepEqual(slideKeys, [
    "duration_ms",
    "error",
    "format",
    "height",
    "image_url",
    "render_completed_at",
    "render_id",
    "render_started_at",
    "slide_number",
    "slide_type",
    "status",
    "template_id",
    "width",
  ]);
  // No leaked camelCase RenderResult/TemplatedPayload field names.
  assert.ok(!("renderId" in finishedCarousel.slides[0]));
  assert.ok(!("payload_id" in finishedCarousel.slides[0]));
  assert.ok(!("layers" in finishedCarousel.slides[0]));
});

test("each slide's image dimensions come from config/constants.json, not the render result", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const finishedCarousel = createFinishedCarousel({ carouselContent, slideRenders, executionMetadata });
  for (const slide of finishedCarousel.slides) {
    assert.equal(slide.width, 1080);
    assert.equal(slide.height, 1350);
  }
});

// --- Immutability --------------------------------------------------------

test("the built Finished Carousel Object is deep-frozen — top-level and nested mutation both throw", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const finishedCarousel = createFinishedCarousel({ carouselContent, slideRenders, executionMetadata });

  assert.throws(() => {
    finishedCarousel.overall_status = "failed";
  }, TypeError);
  assert.throws(() => {
    finishedCarousel.slides[0].status = "failed";
  }, TypeError);
  assert.throws(() => {
    finishedCarousel.metadata.completed_slides = 0;
  }, TypeError);
  assert.throws(() => {
    finishedCarousel.execution_metadata.provider = "tampered";
  }, TypeError);
});

// --- Schema validation (explicit, beyond the builder's own composition checks) ---

test("the built object validates cleanly against the finishedCarousel schema", async () => {
  const { createValidator } = await import("../../src/validator.mjs");
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const finishedCarousel = createFinishedCarousel({ carouselContent, slideRenders, executionMetadata });

  const validator = createValidator();
  const result = validator.validate("finishedCarousel", finishedCarousel);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("a composition-valid-but-schema-invalid ExecutionMetadata is caught by FinishedCarouselValidationError", async () => {
  const { carouselContent, slideRenders } = await buildValidInputs();
  // Passes every composition check (non-empty strings, a number) but
  // renderedAt is not a real date-time — schema validation must still
  // catch it; the composition checks are deliberately not a full schema
  // re-implementation.
  const executionMetadata = {
    executionId: "exec_20260801_deadbeefcafe",
    renderedAt: "not-a-real-timestamp",
    provider: "mock-transport",
    renderDurationMs: 100,
  };

  assert.throws(
    () => createFinishedCarousel({ carouselContent, slideRenders, executionMetadata }),
    FinishedCarouselValidationError
  );
});

// --- Missing dependency ----------------------------------------------

test("throws FinishedCarouselCompositionError when carouselContent is missing", async () => {
  const { slideRenders, executionMetadata } = await buildValidInputs();
  assert.throws(
    () => createFinishedCarousel({ slideRenders, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

test("throws FinishedCarouselCompositionError when slideRenders is missing", async () => {
  const { carouselContent, executionMetadata } = await buildValidInputs();
  assert.throws(
    () => createFinishedCarousel({ carouselContent, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

test("throws FinishedCarouselCompositionError when executionMetadata is missing", async () => {
  const { carouselContent, slideRenders } = await buildValidInputs();
  assert.throws(
    () => createFinishedCarousel({ carouselContent, slideRenders }),
    FinishedCarouselCompositionError
  );
});

test("throws FinishedCarouselCompositionError when slideRenders has fewer than 6 entries", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  assert.throws(
    () => createFinishedCarousel({ carouselContent, slideRenders: slideRenders.slice(0, 5), executionMetadata }),
    FinishedCarouselCompositionError
  );
});

// --- Invalid CarouselContent -------------------------------------------

test("throws FinishedCarouselCompositionError for a CarouselContent missing required fields", async () => {
  const { slideRenders, executionMetadata } = await buildValidInputs();
  const brokenCarouselContent = { carousel_content_id: "cc_broken" }; // no topic_id, no slides
  assert.throws(
    () => createFinishedCarousel({ carouselContent: brokenCarouselContent, slideRenders, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

test("throws FinishedCarouselCompositionError for a CarouselContent with the wrong slide count", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const brokenCarouselContent = { ...carouselContent, slides: carouselContent.slides.slice(0, 3) };
  assert.throws(
    () => createFinishedCarousel({ carouselContent: brokenCarouselContent, slideRenders, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

// --- Invalid TemplatedPayload --------------------------------------------

test("throws FinishedCarouselCompositionError for a malformed templatedPayload (missing template_id)", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const broken = structuredClone(slideRenders);
  delete broken[0].templatedPayload.template_id;
  assert.throws(
    () => createFinishedCarousel({ carouselContent, slideRenders: broken, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

test("throws FinishedCarouselCompositionError when a templatedPayload's slide_type doesn't match its carousel position", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const broken = structuredClone(slideRenders);
  // Swap slide 0 and slide 1's payloads — each is individually well-formed,
  // but now mismatched against carouselContent.slides[0].slide_type.
  [broken[0].templatedPayload, broken[1].templatedPayload] = [broken[1].templatedPayload, broken[0].templatedPayload];
  assert.throws(
    () => createFinishedCarousel({ carouselContent, slideRenders: broken, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

// --- Invalid RenderResult ------------------------------------------------

test("throws FinishedCarouselCompositionError for a malformed renderResult (missing renderId)", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const broken = structuredClone(slideRenders);
  delete broken[0].renderResult.renderId;
  assert.throws(
    () => createFinishedCarousel({ carouselContent, slideRenders: broken, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

test("throws FinishedCarouselCompositionError when a renderResult's templateId doesn't match its own payload's template_id", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const broken = structuredClone(slideRenders);
  broken[0].renderResult.templateId = "some-other-template-id";
  assert.throws(
    () => createFinishedCarousel({ carouselContent, slideRenders: broken, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

test("throws FinishedCarouselCompositionError when a slideRenders entry is entirely missing", async () => {
  const { carouselContent, slideRenders, executionMetadata } = await buildValidInputs();
  const broken = [...slideRenders];
  broken[3] = null;
  assert.throws(
    () => createFinishedCarousel({ carouselContent, slideRenders: broken, executionMetadata }),
    FinishedCarouselCompositionError
  );
});

// DC-003-I007 — CLI capstone: builds one complete Finished Carousel Object
// entirely offline, end-to-end, from a single Carousel Content Object file.
//
// Carousel Content -> (I005) Payload Mapper -> 6 Templated Payloads
//                   -> (I006) Renderer, mock transport only -> 6 RenderResults
//                   -> (I007) Finished Carousel Builder -> Finished Carousel
//
// No previous stage is reimplemented here — every step is a direct call
// into the exact module that stage already delivered. Always uses the mock
// transport: this CLI demonstrates composition, not rendering, and
// DC-003-I006's "no automated/demonstration path may reach the network"
// constraint applies here too. Does not write any file.
//
// Usage: node tests/validation/build-finished-carousel.mjs <path-to-carousel-content.json>
//    or: npm run build:carousel -- <path>

import { readFileSync } from "node:fs";
import { mapCarouselToTemplatedPayload } from "../../src/carousel-payload-mapper.mjs";
import { renderTemplatedPayload } from "../../src/renderer.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { createExecutionMetadata } from "../../src/execution-metadata.mjs";
import { createFinishedCarousel } from "../../src/finished-carousel-builder.mjs";
import {
  UnknownTemplateError,
  MissingLayerError,
  DuplicateLayerMappingError,
  UnsupportedContentError,
  TemplatedPayloadValidationError,
} from "../../src/carousel-payload-errors.mjs";
import { FinishedCarouselCompositionError, FinishedCarouselValidationError } from "../../src/finished-carousel-errors.mjs";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node tests/validation/build-finished-carousel.mjs <path-to-carousel-content.json>");
  process.exit(1);
}

try {
  const carouselContent = JSON.parse(readFileSync(filePath, "utf-8"));
  const templatedPayloads = mapCarouselToTemplatedPayload(carouselContent);

  const transport = createMockTransport();
  const slideRenders = [];
  for (const templatedPayload of templatedPayloads) {
    const renderResult = await renderTemplatedPayload(templatedPayload, { transport });
    slideRenders.push({ templatedPayload, renderResult });
  }

  const totalDurationMs = slideRenders.reduce((sum, { renderResult }) => sum + renderResult.durationMs, 0);
  const executionMetadata = createExecutionMetadata({
    provider: transport.name,
    renderDurationMs: totalDurationMs,
  });

  const finishedCarousel = createFinishedCarousel({ carouselContent, slideRenders, executionMetadata });

  console.log("Finished Carousel built OK");
  console.log(`  carousel ID:     ${finishedCarousel.carousel_id}`);
  console.log(`  topic ID:        ${finishedCarousel.topic_id}`);
  console.log(`  overall status:  ${finishedCarousel.overall_status}`);
  console.log(
    `  slides:          ${finishedCarousel.metadata.completed_slides}/${finishedCarousel.metadata.total_slides} completed`
  );
  console.log(`  total duration:  ${finishedCarousel.metadata.total_duration_ms}ms`);
  console.log(`  execution ID:    ${finishedCarousel.execution_metadata.execution_id}`);
  console.log(`  provider:        ${finishedCarousel.execution_metadata.provider}`);
  for (const slide of finishedCarousel.slides) {
    console.log(`    [slide ${slide.slide_number}] ${slide.slide_type} — ${slide.status} — ${slide.image_url}`);
  }
  process.exit(0);
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`FAIL  File not found: ${filePath}`);
  } else if (error instanceof SyntaxError) {
    console.error(`FAIL  Malformed JSON in ${filePath}: ${error.message}`);
  } else if (
    error instanceof UnknownTemplateError ||
    error instanceof MissingLayerError ||
    error instanceof DuplicateLayerMappingError ||
    error instanceof UnsupportedContentError
  ) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else if (error instanceof TemplatedPayloadValidationError) {
    console.error(`FAIL  Payload validation failed for slide_type "${error.slideType}" (${error.errors.length} error(s))`);
    for (const e of error.errors) console.error(`  - ${e.path}: ${e.message}`);
  } else if (error instanceof FinishedCarouselCompositionError) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else if (error instanceof FinishedCarouselValidationError) {
    console.error(`FAIL  Finished Carousel failed schema validation (${error.errors.length} error(s))`);
    for (const e of error.errors) console.error(`  - ${e.path}: ${e.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

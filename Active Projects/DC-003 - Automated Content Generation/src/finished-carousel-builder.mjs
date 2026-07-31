// DC-003-I007 — Finished Carousel Builder.
//
// CarouselContent + six { TemplatedPayload, RenderResult } pairs (one per
// slide) + ExecutionMetadata -> Builder -> immutable Finished Carousel
// Object.
//
// From this milestone onward, FinishedCarousel is this pipeline's public,
// stable contract — a future orchestrator (n8n, DC-003-I009) or execution
// logger (DC-003-I008) should depend on this object, never on
// TemplatedPayload or RenderResult directly. Neither of those two object
// types is exposed by this module's return value.
//
// Composition only, per the DC-003-I007 brief: this module never invents
// content, never calls Templated, never decides what a slide's image looks
// like — every value in its output came from one of its three inputs,
// each already produced and validated by an earlier, unmodified stage. The
// one mechanical exception is renaming RenderResult's camelCase fields
// (renderId, imageUrl, requestedAt, completedAt, durationMs) onto this
// schema's snake_case field names — the same kind of renaming DC-003-I005's
// Payload Mapper already does going from a Carousel Content Object onto a
// Templated Payload Object.
//
// Image width/height are not tracked by RenderResult (DC-003-I006
// deliberately keeps it minimal) or by Templated Payload (no dimensions in
// that schema either) — every DC-002 template is a fixed 1080x1350
// (config/constants.json's image_width/image_height), so this builder
// reads it from there rather than hardcoding it a second time.
//
// "TemplatedPayload"/"RenderResult" are described in the singular in the
// I007 brief, but a Finished Carousel Object always has exactly six slides
// (finished-carousel.schema.json: minItems/maxItems 6) — so this builder
// takes one { templatedPayload, renderResult } pair per slide, in the same
// order as carouselContent.slides.

import { randomUUID } from "node:crypto";
import { loadConstants } from "./config-loader.mjs";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { FinishedCarouselCompositionError, FinishedCarouselValidationError } from "./finished-carousel-errors.mjs";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function generateCarouselId() {
  return "car_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function checkCarouselContent(carouselContent) {
  if (
    !carouselContent ||
    !isNonEmptyString(carouselContent.carousel_content_id) ||
    !isNonEmptyString(carouselContent.topic_id) ||
    !Array.isArray(carouselContent.slides) ||
    carouselContent.slides.length !== 6
  ) {
    throw new FinishedCarouselCompositionError(
      "createFinishedCarousel requires a validated CarouselContent object with exactly 6 slides"
    );
  }
}

function checkExecutionMetadata(executionMetadata) {
  if (
    !executionMetadata ||
    !isNonEmptyString(executionMetadata.executionId) ||
    !isNonEmptyString(executionMetadata.renderedAt) ||
    !isNonEmptyString(executionMetadata.provider) ||
    typeof executionMetadata.renderDurationMs !== "number"
  ) {
    throw new FinishedCarouselCompositionError(
      "createFinishedCarousel requires a validated ExecutionMetadata object (executionId, renderedAt, provider, renderDurationMs) — see execution-metadata.mjs"
    );
  }
}

function checkTemplatedPayload(index, templatedPayload) {
  if (
    !templatedPayload ||
    !isNonEmptyString(templatedPayload.payload_id) ||
    !isNonEmptyString(templatedPayload.carousel_content_id) ||
    !isNonEmptyString(templatedPayload.template_id) ||
    !isNonEmptyString(templatedPayload.slide_type) ||
    !isNonEmptyString(templatedPayload.format) ||
    typeof templatedPayload.slide_number !== "number"
  ) {
    throw new FinishedCarouselCompositionError(
      `slideRenders[${index}].templatedPayload is not a validated Templated Payload Object`
    );
  }
}

function checkRenderResult(index, renderResult) {
  if (
    !renderResult ||
    !isNonEmptyString(renderResult.renderId) ||
    !isNonEmptyString(renderResult.status) ||
    !isNonEmptyString(renderResult.templateId) ||
    !isNonEmptyString(renderResult.slideType) ||
    !isNonEmptyString(renderResult.requestedAt) ||
    !isNonEmptyString(renderResult.completedAt) ||
    typeof renderResult.durationMs !== "number"
  ) {
    throw new FinishedCarouselCompositionError(`slideRenders[${index}].renderResult is not a validated RenderResult`);
  }
}

// Cross-checks that the three inputs actually describe the same slide —
// this builder composes, it never guesses which payload/render belongs to
// which slide.
function checkSlideConsistency(index, slide, carouselContent, templatedPayload, renderResult) {
  if (templatedPayload.carousel_content_id !== carouselContent.carousel_content_id) {
    throw new FinishedCarouselCompositionError(
      `slideRenders[${index}]: templatedPayload.carousel_content_id ("${templatedPayload.carousel_content_id}") does not match carouselContent.carousel_content_id ("${carouselContent.carousel_content_id}")`
    );
  }
  if (templatedPayload.slide_type !== slide.slide_type) {
    throw new FinishedCarouselCompositionError(
      `slideRenders[${index}]: templatedPayload.slide_type ("${templatedPayload.slide_type}") does not match carouselContent.slides[${index}].slide_type ("${slide.slide_type}")`
    );
  }
  if (renderResult.slideType !== templatedPayload.slide_type) {
    throw new FinishedCarouselCompositionError(
      `slideRenders[${index}]: renderResult.slideType ("${renderResult.slideType}") does not match templatedPayload.slide_type ("${templatedPayload.slide_type}")`
    );
  }
  if (renderResult.templateId !== templatedPayload.template_id) {
    throw new FinishedCarouselCompositionError(
      `slideRenders[${index}]: renderResult.templateId ("${renderResult.templateId}") does not match templatedPayload.template_id ("${templatedPayload.template_id}")`
    );
  }
}

/**
 * Composes an already-rendered carousel's validated artifacts into one
 * immutable Finished Carousel Object — this pipeline's public downstream
 * contract from DC-003-I007 onward.
 *
 * fields.carouselContent — a validated Carousel Content Object (I004).
 * fields.slideRenders — an array of exactly 6 { templatedPayload, renderResult }
 *   pairs, in the same slide order as carouselContent.slides — one
 *   Templated Payload Object (I005) and one RenderResult (I006) per slide.
 * fields.executionMetadata — a validated ExecutionMetadata object (see
 *   execution-metadata.mjs), carrying this run's trace identity.
 *
 * options.now — override the clock (used by tests).
 * options.carouselId — override ID generation (used by tests).
 * options.constants — inject a pre-loaded config/constants.json instead of
 *   loading the real one (used for image width/height).
 * options.validator — inject a pre-built validator.
 * options.rootDir — passed through when no constants/validator are injected.
 *
 * Throws FinishedCarouselCompositionError immediately if any input is
 * missing, malformed, or mutually inconsistent — this builder never
 * silently drops or reorders a slide. Throws FinishedCarouselValidationError
 * if the assembled object still fails schema validation despite passing
 * every composition check above.
 */
export function createFinishedCarousel(fields = {}, options = {}) {
  const { carouselContent, slideRenders, executionMetadata } = fields;
  const now = options.now ?? (() => new Date().toISOString());
  const constants = options.constants ?? loadConstants(options);
  const validator = options.validator ?? createValidator(options);

  checkCarouselContent(carouselContent);
  checkExecutionMetadata(executionMetadata);

  if (!Array.isArray(slideRenders) || slideRenders.length !== 6) {
    throw new FinishedCarouselCompositionError("createFinishedCarousel requires exactly 6 slideRenders, one per slide");
  }

  const slides = carouselContent.slides.map((slide, index) => {
    const pair = slideRenders[index];
    if (!pair || typeof pair !== "object") {
      throw new FinishedCarouselCompositionError(`slideRenders[${index}] is missing`);
    }
    const { templatedPayload, renderResult } = pair;

    checkTemplatedPayload(index, templatedPayload);
    checkRenderResult(index, renderResult);
    checkSlideConsistency(index, slide, carouselContent, templatedPayload, renderResult);

    return {
      slide_number: templatedPayload.slide_number,
      slide_type: templatedPayload.slide_type,
      template_id: templatedPayload.template_id,
      render_id: renderResult.renderId,
      status: renderResult.status,
      image_url: renderResult.imageUrl,
      width: constants.image_width,
      height: constants.image_height,
      format: templatedPayload.format,
      render_started_at: renderResult.requestedAt,
      render_completed_at: renderResult.completedAt,
      duration_ms: renderResult.durationMs,
      error: null,
    };
  });

  const completedSlides = slides.filter((s) => s.status === "completed").length;
  const failedSlides = slides.filter((s) => s.status === "failed").length;
  const overallStatus = completedSlides === slides.length ? "completed" : completedSlides === 0 ? "failed" : "partial";
  const totalDurationMs = slides.reduce((sum, s) => sum + s.duration_ms, 0);

  const finishedCarousel = {
    carousel_id: options.carouselId ?? generateCarouselId(),
    topic_id: carouselContent.topic_id,
    carousel_content_id: carouselContent.carousel_content_id,
    generated_at: now(),
    overall_status: overallStatus,
    slides,
    metadata: {
      total_slides: slides.length,
      completed_slides: completedSlides,
      failed_slides: failedSlides,
      total_duration_ms: totalDurationMs,
    },
    execution_metadata: {
      execution_id: executionMetadata.executionId,
      rendered_at: executionMetadata.renderedAt,
      provider: executionMetadata.provider,
      render_duration_ms: executionMetadata.renderDurationMs,
    },
    approval: {
      approved: false,
      approved_by: null,
      approved_at: null,
      rejected: false,
      rejection_reason: null,
      published: false,
      published_at: null,
    },
  };

  const validation = validator.validate("finishedCarousel", finishedCarousel);
  if (!validation.valid) {
    throw new FinishedCarouselValidationError(validation.errors);
  }

  return deepFreezeClone(finishedCarousel);
}

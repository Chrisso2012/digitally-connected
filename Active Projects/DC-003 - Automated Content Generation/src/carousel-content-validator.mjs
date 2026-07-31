// DC-003-I004 — Carousel Content Validator.
//
// The single place that turns raw provider output + pipeline metadata into
// either a valid Carousel Content Object or a structured, staged failure.
// Three gates, in order, each of which can fail independently:
//
//   1. parse         — is the provider's raw text valid JSON with a
//                       "slides" array at all?
//   2. schema         — does the assembled object conform to
//                       schemas/carousel-content.schema.json? (the I002
//                       validator runtime — never reimplemented here)
//   3. content-shape  — does each slide's content actually have the
//                       fields its slide_type needs? (carousel-content-shape.mjs)
//
// Pure function: no I/O, no provider calls, no retry logic — that's
// retry.mjs and carousel-generator.mjs's job. Never throws; every outcome
// is a returned { ok, ... } result so a caller can retry without a
// try/catch.

import { createValidator } from "./validator.mjs";
import { checkCarouselContentShape } from "./carousel-content-shape.mjs";

/**
 * metadata: { carousel_content_id, topic_id, generated_at, llm_model,
 *   prompt_version, schema_version } — the pipeline-controlled fields the
 *   provider never authors itself (see README "Validation flow" for why).
 * options.validator — inject a pre-built validator (from createValidator())
 *   instead of constructing a new one on every call.
 *
 * Returns { ok: true, carouselContent } or
 *   { ok: false, stage: "parse"|"schema"|"content-shape", message, details }.
 */
export function validateGeneratedCarousel(rawProviderOutput, metadata, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(rawProviderOutput);
  } catch (cause) {
    return { ok: false, stage: "parse", message: `Provider output is not valid JSON: ${cause.message}`, details: [] };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.slides)) {
    return {
      ok: false,
      stage: "parse",
      message: 'Provider output must be a JSON object with a "slides" array — got something else',
      details: [],
    };
  }

  const carouselContent = {
    carousel_content_id: metadata.carousel_content_id,
    topic_id: metadata.topic_id,
    generated_at: metadata.generated_at,
    llm_model: metadata.llm_model,
    prompt_version: metadata.prompt_version,
    schema_version: metadata.schema_version,
    slides: parsed.slides,
  };

  const validator = options.validator ?? createValidator();
  const schemaResult = validator.validate("carouselContent", carouselContent);
  if (!schemaResult.valid) {
    return {
      ok: false,
      stage: "schema",
      message: `Carousel Content Object failed schema validation with ${schemaResult.errors.length} error(s)`,
      details: schemaResult.errors,
    };
  }

  const shapeResult = checkCarouselContentShape(carouselContent);
  if (!shapeResult.ok) {
    return {
      ok: false,
      stage: "content-shape",
      message: `Carousel Content Object is schema-valid but has ${shapeResult.issues.length} content issue(s)`,
      details: shapeResult.issues,
    };
  }

  return { ok: true, carouselContent };
}

// DC-003-I033 — Templated Renderer Adapter: the only concrete Renderer
// Adapter implemented this milestone (see production-package-renderer
// -adapter.mjs for the generic interface). Never calls Templated's API —
// this milestone is purely preparation for rendering, not rendering
// itself (see README "Out of scope").
//
// Key investigation finding, worth restating here (full reasoning in
// README "Investigation"): config/templates.json's six existing
// templates (cover/content/statistic/quote/infographic/cta) were
// purpose-built for the OLDER Topic-Package -> Carousel Content pipeline
// (I003-I007), whose own LLM prompt (I004) was written specifically to
// produce slide-type-DIFFERENTIATED structured content (a stat_value, a
// quote + attribution, a 4-step list). DC-003-I032's Social Media
// Package deliberately produces UNIFORM carousel content instead — one
// heading + one body + one image-guidance string per slide, by design,
// to stay renderer-agnostic. Naively assigning that uniform content onto
// all six heterogeneous templates in SLIDE_ORDER would leave the
// "statistic" and "quote" slides with ZERO real content mapped (neither
// template has a headline_text/body_text-shaped layer at all) — silently
// broken output, not renderer-ready. This is a real shape mismatch, not
// a coding detail, and inventing a stat_value or a quote+attribution
// from a single generic string would be fabricating content this
// adapter has no right to invent (see this milestone's own explicit
// "do not generate marketing copy" boundary).
//
// Resolution adopted for this milestone: every slide maps onto the
// "cover" template's shape (headline_text/body_text — the only two
// fields all six generic slides can honestly supply, given
// eyebrow_text is left at the template's own default rather than
// fabricated), and the FINAL slide additionally maps onto the "cta"
// template's extra button_label layer, sourced from the Social Media
// Package's own real call_to_action field. This is a deliberate,
// documented scope decision: visually-differentiated slide types
// (a distinct statistic/quote/infographic look) are not supported by
// the current uniform Social Media Package carousel shape. A future
// milestone could enrich I032's carousel model with slide-type-specific
// structured content if that visual differentiation is wanted again —
// not this one's job to invent unprompted.

import { loadTemplatesConfig } from "./config-loader.mjs";
import { RequiredRendererMappingMissingError, InvalidTemplateMappingError } from "./production-package-errors.mjs";

const RENDERER_NAME = "templated";
const TEMPLATE_FAMILY_ID = "dc-carousel-v1";
const MAPPING_STRATEGY = "uniform-cover-cta-v1";
const SLIDE_COUNT = 6;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function templateKeyForSlide(slideNumber) {
  return slideNumber === SLIDE_COUNT ? "cta" : "cover";
}

/**
 * Transforms one Social Media Package's uniform six-slide carousel
 * content into a renderer-agnostic slide_sequence — never calls
 * Templated, never invents structure the source doesn't have.
 */
function buildSlideSequence(socialMediaPackage) {
  const carousel = socialMediaPackage?.carousel;
  const headings = carousel?.headings;
  const slideCopy = carousel?.slide_copy;
  const imageGuidance = carousel?.image_guidance;
  const callToAction = socialMediaPackage?.call_to_action;

  // Defense-in-depth only — social-media-package.schema.json already
  // guarantees exactly 6 non-empty entries in each array and a non-empty
  // call_to_action; this should never actually fire in normal operation.
  if (!Array.isArray(headings) || headings.length !== SLIDE_COUNT || !Array.isArray(slideCopy) || slideCopy.length !== SLIDE_COUNT || !Array.isArray(imageGuidance) || imageGuidance.length !== SLIDE_COUNT) {
    throw new RequiredRendererMappingMissingError(RENDERER_NAME, null, "carousel.headings/slide_copy/image_guidance (expected 6 entries each)");
  }

  const slideSequence = headings.map((heading, index) => {
    const slideNumber = index + 1;
    const isFinalSlide = slideNumber === SLIDE_COUNT;
    const bodyCopy = slideCopy[index];
    const guidance = imageGuidance[index];

    if (!isNonEmptyString(heading)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slideNumber, "headline_mapping");
    if (!isNonEmptyString(bodyCopy)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slideNumber, "body_copy_mapping");
    if (!isNonEmptyString(guidance)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slideNumber, "image_guidance_mapping");
    if (isFinalSlide && !isNonEmptyString(callToAction)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slideNumber, "cta_mapping");

    const ctaMapping = isFinalSlide ? callToAction : null;

    return {
      slideNumber,
      headlineMapping: heading,
      bodyCopyMapping: bodyCopy,
      ctaMapping,
      imageGuidanceMapping: guidance,
      placeholderTagMapping: { headline: heading, body: bodyCopy, cta: ctaMapping, image_guidance: guidance },
    };
  });

  return {
    slideSequence,
    templateId: TEMPLATE_FAMILY_ID,
    renderingMetadata: { mappingStrategy: MAPPING_STRATEGY, slideCount: SLIDE_COUNT, generator: "templated-renderer-adapter" },
  };
}

/**
 * Maps an already-built Production Package's renderer-agnostic
 * slide_sequence onto Templated's own real per-slide template IDs and
 * literal layer names — resolved fresh from config/templates.json, not
 * duplicated. Never persisted as part of the Production Package; exists
 * to (a) validate the mapping actually works during generation and
 * (b) give a future I034 renderer milestone a real, tested starting
 * point.
 *
 * options.templatesConfig — inject a pre-loaded config/templates.json
 *   instead of loading the real one (used by tests).
 * options.rootDir — passed through when no templatesConfig is injected.
 *
 * Returns an array of 6 { template_id, template_version, format,
 * slide_number, layers } objects, in slide order. Throws
 * InvalidTemplateMappingError if a required template key is missing
 * from the template registry, or RequiredRendererMappingMissingError if
 * a slide's own mapping content is somehow blank (defense-in-depth,
 * mirrors buildSlideSequence()'s own checks).
 */
function mapToRendererPayload(productionPackage, options = {}) {
  const templatesConfig = options.templatesConfig ?? loadTemplatesConfig(options);

  return (productionPackage?.slide_sequence ?? []).map((slide) => {
    const templateKey = templateKeyForSlide(slide.slide_number);
    const templateEntry = templatesConfig.templates?.[templateKey];
    if (!templateEntry) {
      throw new InvalidTemplateMappingError(RENDERER_NAME, templateKey);
    }

    if (!isNonEmptyString(slide.headline_mapping)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slide.slide_number, "headline_text");
    if (!isNonEmptyString(slide.body_copy_mapping)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slide.slide_number, "body_text");

    const layers = {
      headline_text: { text: slide.headline_mapping },
      body_text: { text: slide.body_copy_mapping },
    };
    if (templateKey === "cta") {
      if (!isNonEmptyString(slide.cta_mapping)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slide.slide_number, "button_label");
      layers.button_label = { text: slide.cta_mapping };
    }

    return {
      template_id: templateEntry.template_id,
      template_version: templateEntry.template_version ?? null,
      format: templateEntry.format,
      slide_number: slide.slide_number,
      layers,
    };
  });
}

/**
 * Creates the Templated Renderer Adapter, implementing the interface
 * asserted by assertValidRendererAdapter() in
 * production-package-renderer-adapter.mjs.
 */
export function createTemplatedRendererAdapter() {
  return {
    name: "templated-renderer-adapter-v1",
    renderer: RENDERER_NAME,
    buildSlideSequence,
    mapToRendererPayload,
  };
}

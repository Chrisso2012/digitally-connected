// DC-003-I033 — Templated Renderer Adapter: the only concrete Renderer
// Adapter implemented this milestone (see production-package-renderer
// -adapter.mjs for the generic interface). Never calls Templated's API —
// this milestone is purely preparation for rendering, not rendering
// itself (see README "Out of scope").
//
// DC-003-I032.1 supersedes this file's original "uniform-cover-cta-v1"
// mapping. Original finding (kept for history): config/templates.json's
// six templates (cover/content/statistic/quote/infographic/cta) were
// purpose-built for the OLDER Topic-Package -> Carousel Content pipeline
// (I003-I007), and I032's ORIGINAL uniform carousel content (one
// heading/body per slide, no slide-type differentiation) couldn't
// honestly fill the statistic/quote/infographic templates' own distinct
// fields — so I033 originally mapped every slide onto only "cover"/"cta".
// DC-003-I032.1 fixed the real gap at its source: I032 now produces six
// SEMANTICALLY TYPED slides (cover/insight/statistic/quote/takeaway/cta,
// fixed positional order), each carrying real evidence (or an honest
// null) for its role. This file's job changes accordingly: transform
// that already-differentiated content onto the matching real template —
// still a pure, deterministic transform, still never generating or
// rewriting copy, still never fabricating a value a null evidence field
// doesn't have.

import { loadTemplatesConfig } from "./config-loader.mjs";
import { RequiredRendererMappingMissingError, InvalidTemplateMappingError } from "./production-package-errors.mjs";

// Role -> template key is a fixed lookup, not content-driven — matches
// the Social Media Package schema's own fixed positional slide_role
// order (social-media-provider.mjs's CAROUSEL_SLIDE_ROLE_ORDER).
//
// DC-003-I032.6 — "evidence" maps onto the same "content" template
// "insight" already uses (confirmed via a real Templated get_template_
// layers call: headline_text/body_text/list_item_N_* only, no
// attribution-style layers at all — safe to reuse as-is). Keyed by the
// slide's own slide_role now (see templateKeyForSlide() below), not by
// position, since position 4 can now legitimately be either "quote" or
// "evidence".
//
// The "quote" mapping itself is NOT safe to exercise today — flagged,
// not fixed, in this milestone: a real Templated get_template_layers
// call on the Quote template (5daf71d6-8aeb-4c8b-b542-27557057ed5a)
// found its own Studio-configured DEFAULTS for the attribution_name/
// attribution_role layers are "Operations Lead" / "Mid-market services
// business" — a fake but real-person-shaped placeholder. Every quote
// slide this pipeline has ever rendered has left those two layers
// completely unset (see buildLayersForTemplate()'s own "quote" case
// below, and its long-standing comment: "eyebrow_text and quote
// attribution are deliberately NEVER populated by this adapter"), so
// Templated's own Studio default has silently rendered on every single
// one. This is a genuine template-asset issue, not a code defect this
// adapter can safely patch within this milestone's own "do not redesign
// Templated templates" boundary — see this file's own README/report for
// the explicit Strategy Office stop-and-review flag. Practically moot
// today regardless, since no canonical contract in this pipeline
// (Ingested Content, Editorial Package) carries genuine external-
// attribution data for "quote" to ever legitimately fire.
const ROLE_TO_TEMPLATE_KEY = {
  cover: "cover",
  insight: "content",
  statistic: "statistic",
  quote: "quote",
  evidence: "content",
  takeaway: "infographic",
  cta: "cta",
};

const RENDERER_NAME = "templated";
const TEMPLATE_FAMILY_ID = "dc-carousel-v1";
const MAPPING_STRATEGY = "semantic-six-template-v2";
const SLIDE_COUNT = 6;
// DC-003-I032.6 — position 4 (0-indexed 3) is evidence-aware; every
// other position keeps its single fixed role. Mirrors
// social-media-provider.mjs's own identical constants exactly.
const CAROUSEL_SLIDE_ROLE_ORDER = ["cover", "insight", "statistic", "quote", "takeaway", "cta"];
const EVIDENCE_POSITION_INDEX = 3;
const EVIDENCE_POSITION_ALLOWED_ROLES = ["quote", "evidence"];

function allowedRolesAtPosition(index) {
  return index === EVIDENCE_POSITION_INDEX ? EVIDENCE_POSITION_ALLOWED_ROLES : [CAROUSEL_SLIDE_ROLE_ORDER[index]];
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// DC-003-I032.6 — resolves the real template by the slide's own actual
// slide_role, not by position. Position 4 can legitimately be either
// "quote" or "evidence" now, so a purely positional lookup (the
// pre-I032.6 design) can no longer determine the right template.
function templateKeyForSlide(slideRole) {
  return ROLE_TO_TEMPLATE_KEY[slideRole];
}

/**
 * Transforms one Social Media Package's six semantically-typed carousel
 * slides into a renderer-agnostic slide_sequence — never calls
 * Templated, never invents structure the source doesn't have. The
 * evidence fields (statistic/quote/keyPoints) are copied through
 * verbatim, null stays null.
 */
function buildSlideSequence(socialMediaPackage) {
  const carousel = socialMediaPackage?.carousel;
  const slides = carousel?.slides;
  const callToAction = socialMediaPackage?.call_to_action;

  // Defense-in-depth only — social-media-package.schema.json already
  // guarantees exactly 6 entries with the fixed role order; this should
  // never actually fire in normal operation.
  if (!Array.isArray(slides) || slides.length !== SLIDE_COUNT) {
    throw new RequiredRendererMappingMissingError(RENDERER_NAME, null, "carousel.slides (expected 6 entries)");
  }

  const slideSequence = slides.map((slide, index) => {
    const slideNumber = index + 1;
    const isFinalSlide = slideNumber === SLIDE_COUNT;
    const allowedRoles = allowedRolesAtPosition(index);
    const heading = slide?.heading;
    const bodyCopy = slide?.body;
    const guidance = slide?.image_guidance;

    if (!allowedRoles.includes(slide?.slide_role)) {
      const expected = allowedRoles.length === 1 ? `"${allowedRoles[0]}"` : `one of ${JSON.stringify(allowedRoles)} (DC-003-I032.6 evidence-aware position)`;
      throw new RequiredRendererMappingMissingError(RENDERER_NAME, slideNumber, `slide_role (expected ${expected}, got ${JSON.stringify(slide?.slide_role)})`);
    }
    if (!isNonEmptyString(heading)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slideNumber, "headline_mapping");
    if (!isNonEmptyString(bodyCopy)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slideNumber, "body_copy_mapping");
    if (!isNonEmptyString(guidance)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slideNumber, "image_guidance_mapping");
    if (isFinalSlide && !isNonEmptyString(callToAction)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slideNumber, "cta_mapping");

    const ctaMapping = isFinalSlide ? callToAction : null;

    return {
      slideNumber,
      slideRole: slide.slide_role,
      headlineMapping: heading,
      bodyCopyMapping: bodyCopy,
      ctaMapping,
      imageGuidanceMapping: guidance,
      placeholderTagMapping: { headline: heading, body: bodyCopy, cta: ctaMapping, image_guidance: guidance },
      structuredContent: {
        // slide.statistic is already { value, context } — no key
        // renaming needed. slide.quote is the PERSISTED (snake_case)
        // Social Media Package shape { quote_text } — converted to the
        // camelCase { quoteText } this renderer-agnostic slideSequence
        // layer uses everywhere else (matches headlineMapping/
        // bodyCopyMapping's own snake_case-in/camelCase-here pattern),
        // converted back to snake_case only once more by
        // production-package.mjs's own toSnakeCaseSlide() at persistence.
        statistic: slide?.statistic ?? null,
        quote: slide?.quote ? { quoteText: slide.quote.quote_text } : null,
        keyPoints: slide?.key_points ?? [],
      },
    };
  });

  return {
    slideSequence,
    templateId: TEMPLATE_FAMILY_ID,
    renderingMetadata: { mappingStrategy: MAPPING_STRATEGY, slideCount: SLIDE_COUNT, generator: "templated-renderer-adapter" },
  };
}

// Builds the real Templated layer overrides for one slide, per its real
// template's own variable-layer shape (config/templates.json). Only
// includes a layer when real content genuinely exists for it — a layer
// this function omits is left at the template's own Studio-configured
// default, never filled with an invented value. eyebrow_text and quote
// attribution are deliberately NEVER populated by this adapter (no
// source anywhere in this pipeline honestly supplies them) — same
// established discipline the original uniform-cover-cta-v1 mapping
// already applied to eyebrow_text.
function buildLayersForTemplate(templateKey, slide) {
  const structured = slide.structured_content ?? {};

  switch (templateKey) {
    case "cover":
      return { headline_text: { text: slide.headline_mapping }, body_text: { text: slide.body_copy_mapping } };

    case "content":
      // list_item_1-4 are deliberately omitted: the "insight" role
      // supplies one real heading + one real body, not 3-4 distinct
      // real list items — inventing list items to fill this template's
      // list_item_N layers would fabricate structure the Social Media
      // Package doesn't have. See DC-003-I032.1 README "Known gap".
      return { headline_text: { text: slide.headline_mapping }, body_text: { text: slide.body_copy_mapping } };

    case "statistic": {
      if (!structured.statistic) {
        // Honest fallback: no real statistic exists for this slide.
        // stat_value/supporting_stat_text have no other honest source
        // (this template has no headline_text/body_text layer at all),
        // so every layer is left at the template's own default rather
        // than stuffing fallback prose into a field shaped for a short
        // numeric figure.
        return {};
      }
      return {
        stat_value: { text: structured.statistic.value },
        supporting_stat_text: { text: structured.statistic.context },
      };
    }

    case "quote": {
      if (!structured.quote) {
        // Honest fallback: no real quote exists — same reasoning as
        // the statistic case above (this template has no
        // headline_text/body_text layer to fall back onto either).
        return {};
      }
      // FLAGGED, NOT FIXED (DC-003-I032.6) — do not remove this comment
      // without Strategy Office review. This template's real Studio
      // defaults for the attribution_name/attribution_role layers are
      // "Operations Lead" / "Mid-market services business" (confirmed
      // via a real Templated get_template_layers call on
      // 5daf71d6-8aeb-4c8b-b542-27557057ed5a) — a fake but real-person-
      // shaped placeholder. Because this function has never populated
      // those two layers (by design — no source anywhere in this
      // pipeline honestly supplies them), every quote slide ever
      // rendered has shown that Studio default, which is exactly the
      // fabricated attribution that got car_3479ca8ac2af40b8 rejected.
      // Overriding these two layers blank here would suppress it, but
      // that is a template-payload decision this milestone's own brief
      // explicitly asks to stop and flag rather than force through —
      // see this milestone's own report for the open Strategy Office
      // item. In practice this code path is not currently reachable via
      // honest generation anyway: no canonical contract in this
      // pipeline carries genuine external-attribution data, so I032's
      // own prompt/schema (DC-003-I032.6) never lets a provider
      // legitimately choose "quote" today.
      return { quote_text: { text: structured.quote.quote_text } };
    }

    case "infographic": {
      const layers = { headline_text: { text: slide.headline_mapping } };
      const keyPoints = structured.key_points ?? [];
      keyPoints.slice(0, 4).forEach((point, index) => {
        const n = index + 1;
        const title = point.length > 60 ? `${point.slice(0, 59).trim()}…` : point;
        layers[`step_${n}_title`] = { text: title };
        layers[`step_${n}_description`] = { text: point };
      });
      // Fewer than 4 real key points -> the remaining step_N layers are
      // simply never added, left at the template's own default, never
      // padded with invented steps.
      return layers;
    }

    case "cta":
      return {
        headline_text: { text: slide.headline_mapping },
        body_text: { text: slide.body_copy_mapping },
        button_label: { text: slide.cta_mapping },
      };

    default:
      return {};
  }
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
 * slide_number, slide_type, layers } objects, in slide order — one of
 * the six real DC Carousel templates per slide (cover/content/statistic/
 * quote/infographic/cta), selected by the slide's own slide_role
 * (templateKeyForSlide(), DC-003-I032.6 — no longer purely positional,
 * since position 4 can legitimately be either "quote" or "evidence").
 * Throws InvalidTemplateMappingError if a required template key is
 * missing from the template registry, or RequiredRendererMappingMissingError
 * if a slide's own mapping content is somehow blank (defense-in-depth,
 * mirrors buildSlideSequence()'s own checks).
 */
function mapToRendererPayload(productionPackage, options = {}) {
  const templatesConfig = options.templatesConfig ?? loadTemplatesConfig(options);

  return (productionPackage?.slide_sequence ?? []).map((slide) => {
    const templateKey = templateKeyForSlide(slide.slide_role);
    const templateEntry = templatesConfig.templates?.[templateKey];
    if (!templateEntry) {
      throw new InvalidTemplateMappingError(RENDERER_NAME, templateKey);
    }

    if (!isNonEmptyString(slide.headline_mapping)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slide.slide_number, "headline_text");
    if (!isNonEmptyString(slide.body_copy_mapping)) throw new RequiredRendererMappingMissingError(RENDERER_NAME, slide.slide_number, "body_text");
    if (templateKey === "cta" && !isNonEmptyString(slide.cta_mapping)) {
      throw new RequiredRendererMappingMissingError(RENDERER_NAME, slide.slide_number, "button_label");
    }

    return {
      template_id: templateEntry.template_id,
      template_version: templateEntry.template_version ?? null,
      format: templateEntry.format,
      slide_number: slide.slide_number,
      // DC-003-I034 — the REAL template family used for this slide, one
      // of the six real DC Carousel templates (per templateKeyForSlide()
      // above), never a fabricated value. Required both by renderer.mjs
      // (I006, which carries it onto the resulting RenderResult) and by
      // finished-carousel-builder.mjs's own Production Package lineage
      // check (checkTemplatedPayloadForProductionPackageLineage()).
      slide_type: templateKey,
      layers: buildLayersForTemplate(templateKey, slide),
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

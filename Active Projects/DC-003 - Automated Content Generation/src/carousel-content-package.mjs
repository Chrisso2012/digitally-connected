// DC-003-I032.10.1 — Carousel Content Package domain object factory.
// Mirrors this codebase's own "assemble, then validate, then deep-freeze"
// discipline (social-media-package.mjs, editorial-package.mjs) —
// composition only, no filesystem APIs, no HTTP, no AI provider call of
// any kind (this object is never AI-generated; it is authored entirely
// upstream in Claude Cowork and CEO-approved before Claude Code ever
// receives it).
//
// Unlike every I030-I032 factory, there is no camelCase-provider-JSON-in,
// snake_case-record-out translation layer here: this object has no LLM
// step to translate FROM, so `fields` is already shaped close to the
// final record (snake_case throughout) — the factory's job is limited to
// mechanical validation, positional/template enforcement, the emphasis
// substring/overlap check, checksum computation, and stamping the fixed
// `production_authority` block. It never rewrites, shortens, or
// reinterprets any copy field it receives.
//
// The seven-slide positional sequence is a hardcoded constant, never
// caller-configurable — position determines role AND template together;
// content_orange slides are additionally constrained to carry no image
// (that template's own fixed no-image design).

import { randomUUID, createHash } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { validateEmphasisInstructions } from "./carousel-content-package-emphasis.mjs";
import { InvalidCarouselContentPackageInputError, CarouselContentPackageValidationError } from "./carousel-content-package-errors.mjs";

const SLIDE_COUNT = 7;
const POSITION_TEMPLATE = ["cover_black", "content_white", "content_orange", "content_white", "content_orange", "content_white", "close_black"];
const POSITION_ROLE = ["cover", "content", "content", "content", "content", "content", "close"];
const IMAGE_MODES = ["none", "provided"];
const IMAGE_LAYOUTS = ["none", "corner", "strip"];
const EMPHASIS_STYLES = ["highlight", "strike"];

// DC-003-I032.10.1 — enforceable contract behaviour, never decorative
// metadata and never caller-suppliable: every Carousel Content Package
// this factory ever produces carries exactly these values, the same
// "hardcoded, never accepted as input" discipline social-media-package.mjs
// already applies to its own `corrections: []` default.
const PRODUCTION_AUTHORITY = Object.freeze({
  preserve_copy_exactly: true,
  allow_editorial_rewriting: false,
  allow_copy_truncation: false,
  allow_template_substitution: false,
  allow_unapproved_content_generation: false,
  capacity_validation_required: true,
  visual_approval_required: true,
  publishing_authorized: false,
});

function generateCarouselContentPackageId() {
  return "ccp_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkNonEmptyString(value, label) {
  if (!isNonEmptyString(value)) {
    throw new InvalidCarouselContentPackageInputError(`fields.${label} is required and must be a non-empty string`);
  }
}

function checkNullableString(value, label) {
  if (value !== null && !isNonEmptyString(value)) {
    throw new InvalidCarouselContentPackageInputError(`fields.${label} must be a non-empty string or null`);
  }
}

// Claude Code never sources, generates, or chooses an image (see this
// file's own header comment) — this only checks internal consistency:
// mode is one of the two implemented values, asset_reference is present
// exactly when mode requires it.
function buildImage(rawImage, label) {
  if (!rawImage || typeof rawImage !== "object") {
    throw new InvalidCarouselContentPackageInputError(`fields.${label}.image is required`);
  }
  const mode = rawImage.mode;
  if (!IMAGE_MODES.includes(mode)) {
    throw new InvalidCarouselContentPackageInputError(`fields.${label}.image.mode must be one of ${IMAGE_MODES.join(", ")} — got ${JSON.stringify(mode)}`);
  }

  const assetReference = rawImage.asset_reference ?? null;
  if (mode === "provided") {
    if (!isNonEmptyString(assetReference)) {
      throw new InvalidCarouselContentPackageInputError(`fields.${label}.image.asset_reference is required (non-empty) when image.mode is "provided" — a production-ready slide requiring an image may never be missing one`);
    }
  } else if (assetReference !== null) {
    throw new InvalidCarouselContentPackageInputError(`fields.${label}.image.asset_reference must be null when image.mode is "none"`);
  }

  const direction = rawImage.direction ?? null;
  if (direction !== null && typeof direction !== "string") {
    throw new InvalidCarouselContentPackageInputError(`fields.${label}.image.direction must be a string or null`);
  }

  return { mode, asset_reference: assetReference, direction };
}

// Structural checks only (non-empty phrase, closed style enum) — the
// substring/overlap check itself happens once per slide in
// buildContentSlide()/buildCloseSlide(), after the slide's own
// searchable text is known.
function buildEmphasisInstructions(rawList, label) {
  const list = rawList ?? [];
  if (!Array.isArray(list)) {
    throw new InvalidCarouselContentPackageInputError(`fields.${label}.emphasis_instructions must be an array`);
  }
  return list.map((instruction, index) => {
    const entryLabel = `${label}.emphasis_instructions[${index}]`;
    if (!instruction || typeof instruction !== "object") {
      throw new InvalidCarouselContentPackageInputError(`fields.${entryLabel} is required`);
    }
    checkNonEmptyString(instruction.phrase, `${entryLabel}.phrase`);
    if (!EMPHASIS_STYLES.includes(instruction.style)) {
      throw new InvalidCarouselContentPackageInputError(`fields.${entryLabel}.style must be one of ${EMPHASIS_STYLES.join(", ")} — got ${JSON.stringify(instruction.style)}`);
    }
    return { phrase: instruction.phrase, style: instruction.style };
  });
}

function checkSlideCommon(slide, label, slideNumber, expectedRole, expectedTemplate, packageIndustrySeries) {
  if (!slide || typeof slide !== "object") {
    throw new InvalidCarouselContentPackageInputError(`fields.${label} is required`);
  }
  if (slide.slide_number !== slideNumber) {
    throw new InvalidCarouselContentPackageInputError(`fields.${label}.slide_number must be ${slideNumber} — got ${JSON.stringify(slide.slide_number)}`);
  }
  if (slide.role !== expectedRole) {
    throw new InvalidCarouselContentPackageInputError(`fields.${label}.role must be "${expectedRole}" (position ${slideNumber} is fixed) — got ${JSON.stringify(slide.role)}`);
  }
  if (slide.template !== expectedTemplate) {
    throw new InvalidCarouselContentPackageInputError(`fields.${label}.template must be "${expectedTemplate}" (position ${slideNumber} is fixed — template choice is never inferred or caller-chosen) — got ${JSON.stringify(slide.template)}`);
  }
  checkNonEmptyString(slide.industry_series, `${label}.industry_series`);
  if (slide.industry_series !== packageIndustrySeries) {
    throw new InvalidCarouselContentPackageInputError(
      `fields.${label}.industry_series (${JSON.stringify(slide.industry_series)}) must exactly match the package-level industry_series (${JSON.stringify(packageIndustrySeries)})`
    );
  }
}

function buildCoverSlide(slide, label) {
  checkNonEmptyString(slide.headline, `${label}.headline`);
  checkNonEmptyString(slide.supporting_line, `${label}.supporting_line`);
  const image = buildImage(slide.image, label);
  return {
    slide_number: 1,
    role: "cover",
    template: "cover_black",
    industry_series: slide.industry_series,
    headline: slide.headline,
    supporting_line: slide.supporting_line,
    image,
  };
}

function buildContentSlide(slide, label, template) {
  checkNonEmptyString(slide.headline, `${label}.headline`);
  checkNonEmptyString(slide.body, `${label}.body`);
  const image = buildImage(slide.image, label);

  const imageLayout = slide.image_layout;
  if (!IMAGE_LAYOUTS.includes(imageLayout)) {
    throw new InvalidCarouselContentPackageInputError(`fields.${label}.image_layout must be one of ${IMAGE_LAYOUTS.join(", ")} — got ${JSON.stringify(imageLayout)}`);
  }

  if (template === "content_orange" && (image.mode !== "none" || imageLayout !== "none")) {
    throw new InvalidCarouselContentPackageInputError(
      `fields.${label}: content_orange has a fixed no-image design — image.mode and image_layout must both be "none" (got image.mode=${JSON.stringify(image.mode)}, image_layout=${JSON.stringify(imageLayout)})`
    );
  }

  const emphasisInstructions = buildEmphasisInstructions(slide.emphasis_instructions, label);
  validateEmphasisInstructions({
    slideNumber: slide.slide_number,
    searchableText: `${slide.headline} ${slide.body}`,
    emphasisInstructions,
  });

  return {
    slide_number: slide.slide_number,
    role: "content",
    template,
    industry_series: slide.industry_series,
    headline: slide.headline,
    body: slide.body,
    image,
    image_layout: imageLayout,
    emphasis_instructions: emphasisInstructions,
  };
}

function buildCloseSlide(slide, label) {
  checkNonEmptyString(slide.headline, `${label}.headline`);
  checkNonEmptyString(slide.body, `${label}.body`);
  checkNonEmptyString(slide.soft_cta, `${label}.soft_cta`);
  const image = buildImage(slide.image, label);

  const emphasisInstructions = buildEmphasisInstructions(slide.emphasis_instructions, label);
  validateEmphasisInstructions({
    slideNumber: 7,
    searchableText: `${slide.headline} ${slide.body}`,
    emphasisInstructions,
  });

  return {
    slide_number: 7,
    role: "close",
    template: "close_black",
    industry_series: slide.industry_series,
    headline: slide.headline,
    body: slide.body,
    soft_cta: slide.soft_cta,
    image,
    emphasis_instructions: emphasisInstructions,
  };
}

function buildSlides(rawSlides, packageIndustrySeries) {
  if (!Array.isArray(rawSlides) || rawSlides.length !== SLIDE_COUNT) {
    throw new InvalidCarouselContentPackageInputError(`fields.slides must be an array of exactly ${SLIDE_COUNT} entries`);
  }

  return rawSlides.map((slide, index) => {
    const slideNumber = index + 1;
    const label = `slides[${index}]`;
    const expectedRole = POSITION_ROLE[index];
    const expectedTemplate = POSITION_TEMPLATE[index];

    checkSlideCommon(slide, label, slideNumber, expectedRole, expectedTemplate, packageIndustrySeries);

    if (expectedTemplate === "cover_black") return buildCoverSlide(slide, label);
    if (expectedTemplate === "close_black") return buildCloseSlide(slide, label);
    return buildContentSlide(slide, label, expectedTemplate);
  });
}

function checksumOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Builds an immutable Carousel Content Package from already-approved,
 * externally-authored fields — no AI/LLM step, no rewriting.
 *
 * fields.sourceArticleTitle — required, non-empty string.
 * fields.sourceArticleReference — optional, string or null (default null).
 * fields.industryName — required, non-empty string.
 * fields.industrySeries — required, non-empty string; every slide's own
 *   industry_series must equal this exactly.
 * fields.carouselTitle — required, non-empty string.
 * fields.slides — required, array of exactly 7 slide objects in the
 *   fixed positional sequence (see this file's own header comment).
 * fields.approvedBy — required, non-empty string identifying who
 *   approved this package upstream (unverified, mirrors this project's
 *   established no-auth-layer convention).
 * fields.approvedAt — required, ISO date-time string — the real,
 *   external, upstream approval event, never "now" at ingestion time.
 * fields.schemaVersion — required, non-empty string.
 *
 * options.now — override the clock for created_at (used by tests).
 * options.idGenerator — override carousel_content_package_id generation.
 * options.validator — inject a pre-built validator.
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidCarouselContentPackageInputError for structurally
 * invalid input. Throws EmphasisPhraseNotFoundError /
 * ConflictingEmphasisInstructionsError for a mechanically-invalid
 * emphasis instruction (see carousel-content-package-emphasis.mjs).
 * Throws CarouselContentPackageValidationError if the assembled object
 * still fails schema validation.
 */
export function createCarouselContentPackage(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateCarouselContentPackageId;
  const validator = options.validator ?? createValidator(options);

  checkNonEmptyString(fields.sourceArticleTitle, "sourceArticleTitle");
  checkNullableString(fields.sourceArticleReference ?? null, "sourceArticleReference");
  checkNonEmptyString(fields.industryName, "industryName");
  checkNonEmptyString(fields.industrySeries, "industrySeries");
  checkNonEmptyString(fields.carouselTitle, "carouselTitle");
  checkNonEmptyString(fields.approvedBy, "approvedBy");
  checkNonEmptyString(fields.approvedAt, "approvedAt");
  checkNonEmptyString(fields.schemaVersion, "schemaVersion");

  const slides = buildSlides(fields.slides, fields.industrySeries);

  const withoutChecksum = {
    package_type: "carousel_content_package",
    package_version: "v1",
    carousel_content_package_id: idGenerator(),
    source_article_title: fields.sourceArticleTitle,
    source_article_reference: fields.sourceArticleReference ?? null,
    industry_name: fields.industryName,
    industry_series: fields.industrySeries,
    carousel_title: fields.carouselTitle,
    total_slides: SLIDE_COUNT,
    slides,
    approval: { approved: true, approved_by: fields.approvedBy, approved_at: fields.approvedAt },
    production_authority: PRODUCTION_AUTHORITY,
    created_at: now(),
    schema_version: fields.schemaVersion,
  };

  const carouselContentPackage = { ...withoutChecksum, checksum: checksumOf(withoutChecksum) };

  const validation = validator.validate("carouselContentPackage", carouselContentPackage);
  if (!validation.valid) {
    throw new CarouselContentPackageValidationError(validation.errors);
  }

  return deepFreezeClone(carouselContentPackage);
}

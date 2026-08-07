// DC-003-I033 — Production Package domain object factory. Mirrors
// social-media-package.mjs's own "assemble, then validate, then
// deep-freeze" discipline exactly — composition only, no filesystem
// APIs, no HTTP, no renderer call (any renderer-adapter mapping happens
// one layer up, in production-package-generator.mjs, before this
// factory is ever called). Computes its own production_checksum
// internally, self-integrity for the record itself, mirroring
// ingested-content.mjs/editorial-package.mjs/social-media-package.mjs
// exactly.
//
// Unlike I030-I032, there is no AI/LLM step anywhere in this milestone
// — slide_sequence is handed in already-computed by a Renderer Adapter
// (a pure, deterministic transform), so this factory has no
// llmModel/promptVersion-style provenance fields, only schemaVersion.

import { randomUUID, createHash } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidProductionPackageInputError, ProductionPackageValidationError } from "./production-package-errors.mjs";

const SOCIAL_MEDIA_PACKAGE_ID_PATTERN = /^sm_[A-Za-z0-9]+$/;
const SLIDE_COUNT = 6;

function generateProductionPackageId() {
  return "pp_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkNonEmptyString(value, label) {
  if (!isNonEmptyString(value)) {
    throw new InvalidProductionPackageInputError(`fields.${label} is required and must be a non-empty string`);
  }
}

function checkNullableString(value, label) {
  if (value !== null && !isNonEmptyString(value)) {
    throw new InvalidProductionPackageInputError(`fields.${label} must be a non-empty string or null`);
  }
}

function checkSlideSequence(slideSequence) {
  if (!Array.isArray(slideSequence) || slideSequence.length !== SLIDE_COUNT) {
    throw new InvalidProductionPackageInputError(`fields.slideSequence must be an array of exactly ${SLIDE_COUNT} slides`);
  }
  slideSequence.forEach((slide, index) => {
    const expectedNumber = index + 1;
    if (!slide || typeof slide !== "object") {
      throw new InvalidProductionPackageInputError(`fields.slideSequence[${index}] is required`);
    }
    if (slide.slideNumber !== expectedNumber) {
      throw new InvalidProductionPackageInputError(`fields.slideSequence[${index}].slideNumber must be ${expectedNumber}, got ${JSON.stringify(slide.slideNumber)}`);
    }
    checkNonEmptyString(slide.headlineMapping, `slideSequence[${index}].headlineMapping`);
    checkNonEmptyString(slide.bodyCopyMapping, `slideSequence[${index}].bodyCopyMapping`);
    checkNonEmptyString(slide.imageGuidanceMapping, `slideSequence[${index}].imageGuidanceMapping`);
    checkNullableString(slide.ctaMapping ?? null, `slideSequence[${index}].ctaMapping`);
    if (expectedNumber === SLIDE_COUNT) {
      if (!isNonEmptyString(slide.ctaMapping)) {
        throw new InvalidProductionPackageInputError(`fields.slideSequence[${index}].ctaMapping is required on the final slide`);
      }
    } else if (slide.ctaMapping !== null && slide.ctaMapping !== undefined) {
      throw new InvalidProductionPackageInputError(`fields.slideSequence[${index}].ctaMapping must be null on a non-final slide`);
    }

    const tags = slide.placeholderTagMapping;
    if (!tags || typeof tags !== "object") {
      throw new InvalidProductionPackageInputError(`fields.slideSequence[${index}].placeholderTagMapping is required`);
    }
    checkNonEmptyString(tags.headline, `slideSequence[${index}].placeholderTagMapping.headline`);
    checkNonEmptyString(tags.body, `slideSequence[${index}].placeholderTagMapping.body`);
    checkNonEmptyString(tags.image_guidance, `slideSequence[${index}].placeholderTagMapping.image_guidance`);
    checkNullableString(tags.cta ?? null, `slideSequence[${index}].placeholderTagMapping.cta`);
  });
}

function checksumOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toSnakeCaseSlide(slide) {
  return {
    slide_number: slide.slideNumber,
    headline_mapping: slide.headlineMapping,
    body_copy_mapping: slide.bodyCopyMapping,
    cta_mapping: slide.ctaMapping ?? null,
    image_guidance_mapping: slide.imageGuidanceMapping,
    placeholder_tag_mapping: {
      headline: slide.placeholderTagMapping.headline,
      body: slide.placeholderTagMapping.body,
      cta: slide.placeholderTagMapping.cta ?? null,
      image_guidance: slide.placeholderTagMapping.image_guidance,
    },
  };
}

/**
 * Builds an immutable Production Package from an already-computed
 * renderer-agnostic slide sequence (the output of a Renderer Adapter's
 * own buildSlideSequence() — see production-package-renderer-adapter.mjs).
 *
 * fields.socialMediaPackageId — required, the sm_... identifier this
 *   package was derived from.
 * fields.renderer — required, non-empty string (e.g. "templated").
 * fields.platform — optional, string or null (default null).
 * fields.designId / templateId — required, non-empty strings.
 * fields.slideSequence — required, array of exactly 6
 *   { slideNumber, headlineMapping, bodyCopyMapping, ctaMapping,
 *     imageGuidanceMapping, placeholderTagMapping } — ctaMapping must be
 *   non-null on slide 6 and null everywhere else.
 * fields.renderingMetadata — required object
 *   { mappingStrategy, slideCount, generator }.
 * fields.validationMetadata — required object
 *   { socialMediaPackageChecksum, allSlidesPopulated, rendererMappingValidated }.
 * fields.schemaVersion — required, non-empty string.
 *
 * options.now — override the clock (used by tests).
 * options.idGenerator — override production_package_id generation.
 * options.validator — inject a pre-built validator.
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidProductionPackageInputError for structurally invalid
 * input. Throws ProductionPackageValidationError if the assembled
 * object still fails schema validation.
 */
export function createProductionPackage(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateProductionPackageId;
  const validator = options.validator ?? createValidator(options);

  if (typeof fields.socialMediaPackageId !== "string" || !SOCIAL_MEDIA_PACKAGE_ID_PATTERN.test(fields.socialMediaPackageId)) {
    throw new InvalidProductionPackageInputError("fields.socialMediaPackageId must match sm_<alphanumeric>");
  }
  checkNonEmptyString(fields.renderer, "renderer");
  checkNullableString(fields.platform ?? null, "platform");
  checkNonEmptyString(fields.designId, "designId");
  checkNonEmptyString(fields.templateId, "templateId");
  checkSlideSequence(fields.slideSequence);
  checkNonEmptyString(fields.schemaVersion, "schemaVersion");

  const renderingMetadata = fields.renderingMetadata;
  if (!renderingMetadata || typeof renderingMetadata !== "object") {
    throw new InvalidProductionPackageInputError("fields.renderingMetadata is required");
  }
  checkNonEmptyString(renderingMetadata.mappingStrategy, "renderingMetadata.mappingStrategy");
  if (renderingMetadata.slideCount !== SLIDE_COUNT) {
    throw new InvalidProductionPackageInputError(`fields.renderingMetadata.slideCount must be ${SLIDE_COUNT}`);
  }
  checkNonEmptyString(renderingMetadata.generator, "renderingMetadata.generator");

  const validationMetadata = fields.validationMetadata;
  if (!validationMetadata || typeof validationMetadata !== "object") {
    throw new InvalidProductionPackageInputError("fields.validationMetadata is required");
  }
  if (typeof validationMetadata.socialMediaPackageChecksum !== "string" || !/^[a-f0-9]{64}$/.test(validationMetadata.socialMediaPackageChecksum)) {
    throw new InvalidProductionPackageInputError("fields.validationMetadata.socialMediaPackageChecksum must be a 64-character hex checksum");
  }
  if (typeof validationMetadata.allSlidesPopulated !== "boolean") {
    throw new InvalidProductionPackageInputError("fields.validationMetadata.allSlidesPopulated must be a boolean");
  }
  if (typeof validationMetadata.rendererMappingValidated !== "boolean") {
    throw new InvalidProductionPackageInputError("fields.validationMetadata.rendererMappingValidated must be a boolean");
  }

  const withoutChecksum = {
    production_package_id: idGenerator(),
    social_media_package_id: fields.socialMediaPackageId,
    status: "generated",
    renderer: fields.renderer,
    platform: fields.platform ?? null,
    design_id: fields.designId,
    template_id: fields.templateId,
    slide_sequence: fields.slideSequence.map(toSnakeCaseSlide),
    rendering_metadata: {
      mapping_strategy: renderingMetadata.mappingStrategy,
      slide_count: renderingMetadata.slideCount,
      generator: renderingMetadata.generator,
    },
    validation_metadata: {
      social_media_package_checksum: validationMetadata.socialMediaPackageChecksum,
      all_slides_populated: validationMetadata.allSlidesPopulated,
      renderer_mapping_validated: validationMetadata.rendererMappingValidated,
    },
    generated_at: now(),
    schema_version: fields.schemaVersion,
  };

  const productionPackage = { ...withoutChecksum, production_checksum: checksumOf(withoutChecksum) };

  const validation = validator.validate("productionPackage", productionPackage);
  if (!validation.valid) {
    throw new ProductionPackageValidationError(validation.errors);
  }

  return deepFreezeClone(productionPackage);
}

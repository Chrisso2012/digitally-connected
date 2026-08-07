// DC-003-I032 — Social Media Package domain object factory. Mirrors
// editorial-package.mjs's own "assemble, then validate, then deep-freeze"
// discipline exactly — composition only, no filesystem APIs, no HTTP, no
// AI provider call (that happens one layer up, in
// social-media-package-generator.mjs, before this factory is ever
// called). Computes its own checksum internally, self-integrity for the
// record itself, mirroring ingested-content.mjs/editorial-package.mjs
// exactly.
//
// Also computes every platform's own character_count from its post_text/
// caption — never accepted as a separate input, the same "derived, not
// supplied" discipline ingested-content.mjs already applies to word_count.

import { randomUUID, createHash } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidSocialMediaPackageInputError, SocialMediaPackageValidationError } from "./social-media-package-errors.mjs";

const EDITORIAL_PACKAGE_ID_PATTERN = /^ep_[A-Za-z0-9]+$/;
const TEXT_PLATFORMS = ["linkedin", "facebook", "x"];
const CAROUSEL_ARRAY_FIELDS = ["headings", "slideCopy", "imageGuidance"];
const CAROUSEL_SLIDE_COUNT = 6;
const CAROUSEL_SLIDE_ROLE_ORDER = ["cover", "insight", "statistic", "quote", "takeaway", "cta"];

function generateSocialMediaPackageId() {
  return "sm_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkNonEmptyString(value, label) {
  if (!isNonEmptyString(value)) {
    throw new InvalidSocialMediaPackageInputError(`fields.${label} is required and must be a non-empty string`);
  }
}

function checkHashtags(value, label) {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new InvalidSocialMediaPackageInputError(`fields.platforms.${label}.hashtags must be an array of non-empty strings (may be empty)`);
  }
}

function buildTextVariation(raw, label) {
  if (!raw || typeof raw !== "object") {
    throw new InvalidSocialMediaPackageInputError(`fields.platforms.${label} is required`);
  }
  checkNonEmptyString(raw.postText, `${label}.postText`);
  checkHashtags(raw.hashtags ?? [], label);
  return { post_text: raw.postText, hashtags: raw.hashtags ?? [], character_count: raw.postText.length };
}

function buildCaptionVariation(raw, label) {
  if (!raw || typeof raw !== "object") {
    throw new InvalidSocialMediaPackageInputError(`fields.platforms.${label} is required`);
  }
  checkNonEmptyString(raw.caption, `${label}.caption`);
  checkHashtags(raw.hashtags ?? [], label);
  return { caption: raw.caption, hashtags: raw.hashtags ?? [], character_count: raw.caption.length };
}

function checkCarouselArray(value, label) {
  if (!Array.isArray(value) || value.length !== CAROUSEL_SLIDE_COUNT || !value.every(isNonEmptyString)) {
    throw new InvalidSocialMediaPackageInputError(`fields.carousel.${label} must be an array of exactly ${CAROUSEL_SLIDE_COUNT} non-empty strings`);
  }
}

// DC-003-I032.1 — validates and normalises the structured, semantically-typed
// carousel slides. Mirrors checkCarouselArray()'s own "throw
// InvalidSocialMediaPackageInputError on any structural problem" discipline.
// `statistic`/`quote` are honest evidence containers — null is a valid,
// expected value here, never coerced into a fabricated placeholder.
function buildCarouselSlides(value) {
  if (!Array.isArray(value) || value.length !== CAROUSEL_SLIDE_COUNT) {
    throw new InvalidSocialMediaPackageInputError(`fields.carousel.slides must be an array of exactly ${CAROUSEL_SLIDE_COUNT} entries`);
  }
  return value.map((slide, index) => {
    const label = `carousel.slides[${index}]`;
    const expectedNumber = index + 1;
    const expectedRole = CAROUSEL_SLIDE_ROLE_ORDER[index];
    if (!slide || typeof slide !== "object") {
      throw new InvalidSocialMediaPackageInputError(`fields.${label} is required`);
    }
    if (slide.slideNumber !== expectedNumber) {
      throw new InvalidSocialMediaPackageInputError(`fields.${label}.slideNumber must be ${expectedNumber}`);
    }
    if (slide.slideRole !== expectedRole) {
      throw new InvalidSocialMediaPackageInputError(`fields.${label}.slideRole must be "${expectedRole}" (fixed positional order)`);
    }
    checkNonEmptyString(slide.heading, `${label}.heading`);
    checkNonEmptyString(slide.body, `${label}.body`);
    checkNonEmptyString(slide.imageGuidance, `${label}.imageGuidance`);

    let statistic = null;
    if (slide.statistic !== null && slide.statistic !== undefined) {
      if (typeof slide.statistic !== "object" || !isNonEmptyString(slide.statistic.value) || !isNonEmptyString(slide.statistic.context)) {
        throw new InvalidSocialMediaPackageInputError(`fields.${label}.statistic must be null or { value, context } with non-empty strings`);
      }
      statistic = { value: slide.statistic.value, context: slide.statistic.context };
    }

    let quote = null;
    if (slide.quote !== null && slide.quote !== undefined) {
      if (typeof slide.quote !== "object" || !isNonEmptyString(slide.quote.quoteText)) {
        throw new InvalidSocialMediaPackageInputError(`fields.${label}.quote must be null or { quoteText } with a non-empty string`);
      }
      quote = { quote_text: slide.quote.quoteText };
    }

    const keyPoints = slide.keyPoints ?? [];
    if (!Array.isArray(keyPoints) || keyPoints.length > 4 || !keyPoints.every(isNonEmptyString)) {
      throw new InvalidSocialMediaPackageInputError(`fields.${label}.keyPoints must be an array of 0-4 non-empty strings`);
    }

    return {
      slide_number: expectedNumber,
      slide_role: expectedRole,
      heading: slide.heading,
      body: slide.body,
      image_guidance: slide.imageGuidance,
      statistic,
      quote,
      key_points: keyPoints,
    };
  });
}

function checksumOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Builds an immutable Social Media Package from already-generated
 * platform content (the output of a Social Media Provider, already
 * validated against the Social Media Result contract — see
 * social-media-provider.mjs).
 *
 * fields.editorialPackageId — required, the ep_... identifier this
 *   package was derived from.
 * fields.hook / callToAction / tone / audience — required, non-empty strings.
 * fields.platforms.linkedin / facebook / x — required, each
 *   `{ postText: string, hashtags?: string[] }`.
 * fields.platforms.instagram — required, `{ caption: string, hashtags?: string[] }`.
 * fields.carousel.headings / slideCopy / imageGuidance — required,
 *   each an array of exactly 6 non-empty strings.
 * fields.metadata — optional, object or null (default null).
 * fields.llmModel / promptVersion / schemaVersion — required, non-empty
 *   strings (provenance metadata).
 *
 * options.now — override the clock (used by tests).
 * options.idGenerator — override social_media_package_id generation.
 * options.validator — inject a pre-built validator.
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidSocialMediaPackageInputError for structurally invalid
 * input. Throws SocialMediaPackageValidationError if the assembled
 * object still fails schema validation.
 */
export function createSocialMediaPackage(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateSocialMediaPackageId;
  const validator = options.validator ?? createValidator(options);

  if (typeof fields.editorialPackageId !== "string" || !EDITORIAL_PACKAGE_ID_PATTERN.test(fields.editorialPackageId)) {
    throw new InvalidSocialMediaPackageInputError("fields.editorialPackageId must match ep_<alphanumeric>");
  }
  checkNonEmptyString(fields.hook, "hook");
  checkNonEmptyString(fields.callToAction, "callToAction");
  checkNonEmptyString(fields.tone, "tone");
  checkNonEmptyString(fields.audience, "audience");

  const platformsInput = fields.platforms ?? {};
  const platforms = {};
  for (const platform of TEXT_PLATFORMS) {
    platforms[platform] = buildTextVariation(platformsInput[platform], platform);
  }
  platforms.instagram = buildCaptionVariation(platformsInput.instagram, "instagram");

  const carouselInput = fields.carousel ?? {};
  for (const field of CAROUSEL_ARRAY_FIELDS) {
    checkCarouselArray(carouselInput[field], field);
  }
  const carouselSlides = buildCarouselSlides(carouselInput.slides);

  checkNonEmptyString(fields.llmModel, "llmModel");
  checkNonEmptyString(fields.promptVersion, "promptVersion");
  checkNonEmptyString(fields.schemaVersion, "schemaVersion");

  if (fields.metadata !== null && fields.metadata !== undefined && typeof fields.metadata !== "object") {
    throw new InvalidSocialMediaPackageInputError("fields.metadata must be an object or null");
  }

  const withoutChecksum = {
    social_media_package_id: idGenerator(),
    editorial_package_id: fields.editorialPackageId,
    status: "generated",
    hook: fields.hook,
    call_to_action: fields.callToAction,
    tone: fields.tone,
    audience: fields.audience,
    platforms,
    carousel: {
      headings: carouselInput.headings,
      slide_copy: carouselInput.slideCopy,
      image_guidance: carouselInput.imageGuidance,
      slides: carouselSlides,
    },
    metadata: fields.metadata ?? null,
    generated_at: now(),
    llm_model: fields.llmModel,
    prompt_version: fields.promptVersion,
    schema_version: fields.schemaVersion,
  };

  const socialMediaPackage = { ...withoutChecksum, checksum: checksumOf(withoutChecksum) };

  const validation = validator.validate("socialMediaPackage", socialMediaPackage);
  if (!validation.valid) {
    throw new SocialMediaPackageValidationError(validation.errors);
  }

  return deepFreezeClone(socialMediaPackage);
}

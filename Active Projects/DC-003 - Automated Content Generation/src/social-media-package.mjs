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
const SOCIAL_MEDIA_PACKAGE_ID_PATTERN = /^sm_[A-Za-z0-9]+$/;
const TEXT_PLATFORMS = ["linkedin", "facebook", "x"];
const CAROUSEL_ARRAY_FIELDS = ["headings", "slideCopy", "imageGuidance"];
const CAROUSEL_SLIDE_COUNT = 6;
const CAROUSEL_SLIDE_ROLE_ORDER = ["cover", "insight", "statistic", "quote", "takeaway", "cta"];

// DC-003-I032.6 — position 4 (0-indexed 3) is evidence-aware — see
// social-media-provider.mjs's own identical constant for the full
// rationale (no canonical contract in this pipeline carries genuine
// external-attribution data, so "quote" is schema-supported for a
// future version but never legitimately reachable today; "evidence" is
// the honest fallback).
const EVIDENCE_POSITION_INDEX = 3;
const EVIDENCE_POSITION_ALLOWED_ROLES = ["quote", "evidence"];

function allowedRolesAtPosition(index) {
  return index === EVIDENCE_POSITION_INDEX ? EVIDENCE_POSITION_ALLOWED_ROLES : [CAROUSEL_SLIDE_ROLE_ORDER[index]];
}

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

// DC-003-I031.8 — honest evidence container, mirroring statistic/quote's
// own null-or-real pattern: null is a valid, expected value here.
function checkNullableNonEmptyString(value, label) {
  if (value !== null && !isNonEmptyString(value)) {
    throw new InvalidSocialMediaPackageInputError(`fields.${label} must be null or a non-empty string`);
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
    const allowedRoles = allowedRolesAtPosition(index);
    if (!slide || typeof slide !== "object") {
      throw new InvalidSocialMediaPackageInputError(`fields.${label} is required`);
    }
    if (slide.slideNumber !== expectedNumber) {
      throw new InvalidSocialMediaPackageInputError(`fields.${label}.slideNumber must be ${expectedNumber}`);
    }
    if (!allowedRoles.includes(slide.slideRole)) {
      const expected = allowedRoles.length === 1 ? `"${allowedRoles[0]}" (fixed positional order)` : `one of ${JSON.stringify(allowedRoles)} (DC-003-I032.6 evidence-aware position)`;
      throw new InvalidSocialMediaPackageInputError(`fields.${label}.slideRole must be ${expected}`);
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

    // DC-003-I032.6 — the same anti-fabrication cross-check as
    // social-media-provider.mjs's own validator: a quote object may
    // only accompany the "quote" role, never "evidence" or any other.
    if (slide.slideRole !== "quote" && quote !== null) {
      throw new InvalidSocialMediaPackageInputError(`fields.${label}.quote must be null when slideRole is not "quote"`);
    }

    const keyPoints = slide.keyPoints ?? [];
    if (!Array.isArray(keyPoints) || keyPoints.length > 4 || !keyPoints.every(isNonEmptyString)) {
      throw new InvalidSocialMediaPackageInputError(`fields.${label}.keyPoints must be an array of 0-4 non-empty strings`);
    }

    return {
      slide_number: expectedNumber,
      slide_role: slide.slideRole,
      heading: slide.heading,
      body: slide.body,
      image_guidance: slide.imageGuidance,
      statistic,
      quote,
      key_points: keyPoints,
    };
  });
}

// DC-003-I032.8 — revision-lineage fields. Both default to the
// "first-ever record for this Editorial Package" shape (revision 1,
// supersedes null) so ordinary generateSocialMediaPackage() never has to
// pass either — only reviseSocialMediaPackage() (social-media-package-
// generator.mjs) ever supplies non-default values, and it always
// supplies both together.
function checkRevision(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidSocialMediaPackageInputError("fields.revision must be an integer >= 1");
  }
}

function checkSupersedes(value) {
  if (value !== null && (typeof value !== "string" || !SOCIAL_MEDIA_PACKAGE_ID_PATTERN.test(value))) {
    throw new InvalidSocialMediaPackageInputError("fields.supersedes must be null or match sm_<alphanumeric>");
  }
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
 * fields.industryContext — required (DC-003-I031.8), null or a non-empty
 *   string; null when the source has no clearly-supported specific
 *   industry/sector — never coerced into a fabricated value.
 * fields.platforms.linkedin / facebook / x — required, each
 *   `{ postText: string, hashtags?: string[] }`.
 * fields.platforms.instagram — required, `{ caption: string, hashtags?: string[] }`.
 * fields.carousel.headings / slideCopy / imageGuidance — required,
 *   each an array of exactly 6 non-empty strings.
 * fields.metadata — optional, object or null (default null).
 * fields.llmModel / promptVersion / schemaVersion — required, non-empty
 *   strings (provenance metadata).
 * fields.revision — optional (DC-003-I032.8), integer >= 1, default 1.
 *   Only reviseSocialMediaPackage() ever passes a value > 1.
 * fields.supersedes — optional (DC-003-I032.8), null or an sm_... id,
 *   default null. Only reviseSocialMediaPackage() ever passes a non-null
 *   value — the identifier of the Social Media Package this new record
 *   explicitly revises.
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
  const industryContext = fields.industryContext ?? null;
  checkNullableNonEmptyString(industryContext, "industryContext");

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

  const revision = fields.revision ?? 1;
  checkRevision(revision);
  const supersedes = fields.supersedes ?? null;
  checkSupersedes(supersedes);
  if (revision === 1 && supersedes !== null) {
    throw new InvalidSocialMediaPackageInputError("fields.supersedes must be null when fields.revision is 1 (only a revision > 1 supersedes an earlier record)");
  }
  if (revision > 1 && supersedes === null) {
    throw new InvalidSocialMediaPackageInputError("fields.supersedes is required (must name the record being revised) when fields.revision is greater than 1");
  }

  const withoutChecksum = {
    social_media_package_id: idGenerator(),
    editorial_package_id: fields.editorialPackageId,
    status: "generated",
    hook: fields.hook,
    call_to_action: fields.callToAction,
    tone: fields.tone,
    audience: fields.audience,
    industry_context: industryContext,
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
    revision,
    supersedes,
    // DC-003-I032.9 — always empty at creation time; a fresh
    // generateSocialMediaPackage()/reviseSocialMediaPackage() record has
    // never had a correction applied. Not accepted as a fields input —
    // corrections are only ever added by correctSocialMediaPackageSlideField().
    corrections: [],
  };

  const socialMediaPackage = { ...withoutChecksum, checksum: checksumOf(withoutChecksum) };

  const validation = validator.validate("socialMediaPackage", socialMediaPackage);
  if (!validation.valid) {
    throw new SocialMediaPackageValidationError(validation.errors);
  }

  return deepFreezeClone(socialMediaPackage);
}

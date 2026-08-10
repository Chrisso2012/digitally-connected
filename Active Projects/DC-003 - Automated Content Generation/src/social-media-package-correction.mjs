// DC-003-I032.9 — Social Media Package Slide-Field Correction.
//
// Architectural investigation (before writing any code): Social Media
// Package is documented and enforced as immutable — no update/replace
// path exists anywhere in social-media-package-store.mjs, and I032.8's
// own reviseSocialMediaPackage() is the only existing "produce a new
// version" mechanism, but it always calls a Social Media Provider (mock
// or live Anthropic) and always mints a new revision/id. Neither fits a
// deterministic, human-directed, text-only correction that must NEVER
// invoke Anthropic and must NOT create a new revision/id. The closest
// real precedent in this codebase is DC-003-I014's carousel-approval.mjs
// (a pure, in-memory "assemble a new validated copy, never mutate the
// input" transition function) composed with DC-003-I015's Finished
// Carousel Store's own replace() (persists a corrected object back under
// its OWN existing identifier). This file mirrors carousel-approval.mjs's
// exact shape; social-media-package-store.mjs's own new replace()
// (mirroring finished-carousel-store.mjs's replace()) does the
// persistence half.
//
// Deliberately narrow, per the I032.9 brief ("do not build a large
// general editing framework"): exactly the three carousel slide fields
// that must always stay identical between the flat parallel arrays
// (headings/slide_copy/image_guidance) and the structured `slides` array
// — heading, body, imageGuidance — nothing else (not platforms copy, not
// hook/tone/audience/industry_context, not statistic/quote/keyPoints).
//
// Safety rules, all enforced here, none bypassable:
//   - the target slide/field must exist;
//   - replacement text must be a non-empty string;
//   - a reason (audit justification) is required, non-empty;
//   - the replacement text is checked against the Template Capacity
//     Contract's OWN canonical limit for that slide's real role + field
//     (template-capacity-contract.mjs, reused unmodified, unweakened) —
//     a violation is rejected outright, never truncated/rewritten, and
//     the limit itself is never touched;
//   - every field but the one named is carried over byte-identical;
//   - the correction is appended to `corrections` (never overwrites or
//     removes a prior entry), and the record's checksum is recomputed.

import { createHash } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { TEMPLATE_CAPACITY_CONTRACT, checkFieldCapacity } from "./template-capacity-contract.mjs";
import {
  InvalidSocialMediaPackageCorrectionError,
  SocialMediaPackageCorrectionCapacityExceededError,
  SocialMediaPackageValidationError,
} from "./social-media-package-errors.mjs";

// field (caller-facing, camelCase, matches every other camelCase input
// this project's factories already accept, e.g. fields.carousel.imageGuidance)
//   -> arrayField: the flat parallel-array property on carousel
//   -> slideField: the property on the matching carousel.slides[] entry
// Both are always kept identical, per social-media-package.schema.json's
// own documented invariant — a correction updates both together, never
// just one.
const FIELD_MAP = {
  heading: { arrayField: "headings", slideField: "heading", auditFieldName: "heading" },
  body: { arrayField: "slide_copy", slideField: "body", auditFieldName: "body" },
  imageGuidance: { arrayField: "image_guidance", slideField: "image_guidance", auditFieldName: "image_guidance" },
};

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checksumOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function checkSocialMediaPackage(socialMediaPackage) {
  if (
    !socialMediaPackage ||
    typeof socialMediaPackage !== "object" ||
    !isNonEmptyString(socialMediaPackage.social_media_package_id) ||
    !socialMediaPackage.carousel ||
    !Array.isArray(socialMediaPackage.carousel.slides)
  ) {
    throw new InvalidSocialMediaPackageCorrectionError(
      "expected a validated Social Media Package (with a social_media_package_id and a carousel.slides array) — see social-media-package-store.mjs's own get()"
    );
  }
}

/**
 * Applies one explicit, human-directed, deterministic slide-field
 * correction to an already-generated Social Media Package. Returns a
 * new, immutable Social Media Package with exactly that one field
 * updated (both the flat parallel array entry and the matching
 * carousel.slides[] entry), one new entry appended to `corrections`, and
 * a freshly recomputed `checksum` — every other field is carried over
 * byte-identical from the input. Never mutates the input. Never calls
 * any AI provider. Never changes revision/supersedes/social_media_package_id.
 *
 * fields.socialMediaPackage — the existing, validated Social Media
 *   Package to correct (e.g. from socialMediaPackageStore.get()).
 * fields.slideNumber — required, integer 1-6 (matches carousel.slides[].slide_number).
 * fields.field — required, one of "heading" | "body" | "imageGuidance".
 * fields.replacementText — required, non-empty string.
 * fields.reason — required, non-empty string audit justification (e.g. a
 *   Strategy Office/CEO authorisation reference).
 *
 * options.now — override the clock (used by tests).
 * options.validator — inject a pre-built validator (used by tests).
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidSocialMediaPackageCorrectionError for a malformed
 * socialMediaPackage, an out-of-range slideNumber, an unsupported field,
 * or a missing/blank replacementText/reason — before any mutation is
 * attempted.
 *
 * Throws SocialMediaPackageCorrectionCapacityExceededError when
 * replacementText exceeds the Template Capacity Contract's own canonical
 * limit for the target slide's real role + field — the limit is never
 * modified and the text is never truncated; the only recovery path is
 * genuinely shorter replacement text.
 *
 * Throws SocialMediaPackageValidationError if the corrected record still
 * somehow fails schema validation (defense-in-depth; should not happen
 * given the checks above).
 */
export function correctSocialMediaPackageSlideField(fields = {}, options = {}) {
  const { socialMediaPackage, slideNumber, field, replacementText, reason } = fields;
  const now = options.now ?? (() => new Date().toISOString());
  const validator = options.validator ?? createValidator(options);

  checkSocialMediaPackage(socialMediaPackage);

  if (!Number.isInteger(slideNumber) || slideNumber < 1 || slideNumber > 6) {
    throw new InvalidSocialMediaPackageCorrectionError("fields.slideNumber must be an integer between 1 and 6");
  }
  const fieldSpec = FIELD_MAP[field];
  if (!fieldSpec) {
    throw new InvalidSocialMediaPackageCorrectionError(`fields.field must be one of ${Object.keys(FIELD_MAP).join(", ")} — received ${JSON.stringify(field)}`);
  }
  if (!isNonEmptyString(replacementText)) {
    throw new InvalidSocialMediaPackageCorrectionError("fields.replacementText is required and must be a non-empty string");
  }
  if (!isNonEmptyString(reason)) {
    throw new InvalidSocialMediaPackageCorrectionError("fields.reason is required and must be a non-empty string audit justification");
  }

  const slideIndex = slideNumber - 1;
  const slide = socialMediaPackage.carousel.slides[slideIndex];
  if (!slide || slide.slide_number !== slideNumber) {
    throw new InvalidSocialMediaPackageCorrectionError(`no carousel.slides entry found with slide_number ${slideNumber}`);
  }

  // Capacity gate — reused, unmodified, from I033.1's own canonical
  // contract. Runs before any mutation; a violation aborts entirely.
  // contract[fieldSpec.slideField] is naturally undefined for
  // "image_guidance" (no such key exists in any TEMPLATE_CAPACITY_CONTRACT
  // entry — image guidance is never rendered as a text layer), so
  // checkFieldCapacity() correctly treats it as unconstrained.
  const contract = TEMPLATE_CAPACITY_CONTRACT[slide.slide_role];
  const capacityEntry = contract ? contract[fieldSpec.slideField] : null;
  const capacityCheck = checkFieldCapacity(replacementText, capacityEntry);
  if (!capacityCheck.compliant) {
    throw new SocialMediaPackageCorrectionCapacityExceededError({
      socialMediaPackageId: socialMediaPackage.social_media_package_id,
      slideNumber,
      slideRole: slide.slide_role,
      field,
      length: capacityCheck.length,
      maxChars: capacityCheck.maxChars,
    });
  }

  const previousValue = slide[fieldSpec.slideField];

  const correctedSlides = socialMediaPackage.carousel.slides.map((s, index) => (index === slideIndex ? { ...s, [fieldSpec.slideField]: replacementText } : s));
  const correctedArray = socialMediaPackage.carousel[fieldSpec.arrayField].map((value, index) => (index === slideIndex ? replacementText : value));

  const correctionEntry = {
    slide_number: slideNumber,
    field: fieldSpec.auditFieldName,
    previous_value: previousValue,
    corrected_value: replacementText,
    corrected_at: now(),
    reason,
  };

  const withoutChecksum = {
    ...socialMediaPackage,
    carousel: {
      ...socialMediaPackage.carousel,
      [fieldSpec.arrayField]: correctedArray,
      slides: correctedSlides,
    },
    corrections: [...socialMediaPackage.corrections, correctionEntry],
  };
  delete withoutChecksum.checksum;

  const corrected = { ...withoutChecksum, checksum: checksumOf(withoutChecksum) };

  const validation = validator.validate("socialMediaPackage", corrected);
  if (!validation.valid) {
    throw new SocialMediaPackageValidationError(validation.errors);
  }

  return deepFreezeClone(corrected);
}

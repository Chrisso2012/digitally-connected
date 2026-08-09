// DC-003-I032 — Social Media Provider: the provider-neutral contract
// every AI-assisted platform-copy generation implementation (the mock in
// social-media-mock-provider.mjs, the real one in
// social-media-anthropic-provider.mjs) must satisfy. Mirrors
// DC-003-I031's own Editorial Analysis Provider interface exactly — the
// same class of thing (call an AI provider with a deterministic prompt,
// get raw JSON back), reusing the architecture I031 already established
// per this milestone's own brief ("reuse the AI provider architecture
// established in I031, do not duplicate provider infrastructure").
//
//   { name: string,
//     generateSocialMedia(prompt, context): Promise<string> }  // raw JSON string
//
// context.editorialPackage is passed for interface parity with
// createEditorialAnalysisMockProvider()'s own `{ ingestedContent }`
// context — the mock provider reads it directly (no LLM call); a real
// provider ignores it (the prompt string already carries everything it
// needs).
//
// Also exports assertValidSocialMediaResult() — a defense-in-depth check
// on the PARSED JSON object every provider returns, run by
// social-media-package-generator.mjs before createSocialMediaPackage()
// is ever called, mirroring assertValidEditorialAnalysisResult()'s own
// precedent for untrusted provider output.

import { InvalidSocialMediaProviderError, MalformedSocialMediaResultError } from "./social-media-analysis-errors.mjs";

const REQUIRED_STRING_FIELDS = ["hook", "callToAction", "tone", "audience"];
const TEXT_PLATFORMS = ["linkedin", "facebook", "x"];
const CAROUSEL_ARRAY_FIELDS = ["headings", "slideCopy", "imageGuidance"];
const CAROUSEL_SLIDE_COUNT = 6;

// DC-003-I032.1 — fixed positional role order every carousel must follow.
// Not caller-configurable: the six real Templated templates are selected
// by POSITION (see templated-renderer-adapter.mjs's templateKeyForSlide()),
// so slide_role is a self-documenting/verifiable label, not something a
// provider gets to reorder.
export const CAROUSEL_SLIDE_ROLE_ORDER = ["cover", "insight", "statistic", "quote", "takeaway", "cta"];

export function assertValidSocialMediaProvider(provider) {
  if (!provider || typeof provider.name !== "string" || typeof provider.generateSocialMedia !== "function") {
    throw new InvalidSocialMediaProviderError();
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// DC-003-I032.3 — every fail() call site now names the exact field it
// rejected (a dot/bracket path), so a caller can attach safe structural
// diagnostics scoped to that one field — see describeResultFieldShape()
// below and MalformedSocialMediaResultError's own header comment.
function fail(reason, field = null) {
  throw new MalformedSocialMediaResultError(reason, field);
}

// DC-003-I032.3 — generic, content-free structural shape descriptor for
// ANY Social Media Result field — generalises I031's own
// describeArrayFieldShape() (editorial-analysis-provider.mjs), which only
// ever described array<string> fields. carousel's own contract is much
// richer (nested objects, arrays of objects), so this reports shape/type
// facts for any value: existence, null-ness, JS type, array length +
// item-type census, or — for a plain object — its own top-level key
// NAMES only (never values). Never returns or logs a string's contents,
// an array item's contents, or an object's property VALUES — only what
// shape the value has, exactly the same safety bar
// describeArrayFieldShape() already holds itself to.
// DC-003-I032.3 — resolves one of assertValidSocialMediaResult()'s own
// field paths (e.g. "carousel", "carousel.slides[2].statistic") against
// the actual parsed result, so a caller can describe the shape of
// exactly the value that failed. Deliberately tiny and specific to this
// module's own path format (dot-separated keys, `[n]` array indices) —
// not a general-purpose JSONPath implementation. Never throws: an
// unresolvable path (a missing intermediate object) resolves to
// `undefined`, which describeResultFieldShape() already reports as
// `{ exists: false }`.
export function getResultFieldByPath(result, path) {
  if (!path) return result;
  let current = result;
  for (const segment of path.split(".")) {
    const arrayMatch = segment.match(/^([^[]+)\[(\d+)\]$/);
    if (current === null || current === undefined) return undefined;
    if (arrayMatch) {
      const [, key, index] = arrayMatch;
      current = current[key];
      if (current === null || current === undefined) return undefined;
      current = current[Number(index)];
    } else {
      current = current[segment];
    }
  }
  return current;
}

export function describeResultFieldShape(value) {
  if (value === undefined) {
    return { exists: false, isNull: false, type: "undefined", isArray: false, isPlainObject: false, length: null, itemTypes: null, keys: null };
  }
  if (value === null) {
    return { exists: true, isNull: true, type: "object", isArray: false, isPlainObject: false, length: null, itemTypes: null, keys: null };
  }
  if (Array.isArray(value)) {
    return {
      exists: true,
      isNull: false,
      type: "object",
      isArray: true,
      isPlainObject: false,
      length: value.length,
      itemTypes: value.map((item) => (item === null ? "null" : Array.isArray(item) ? "array" : typeof item)),
      keys: null,
    };
  }
  if (typeof value === "object") {
    return { exists: true, isNull: false, type: "object", isArray: false, isPlainObject: true, length: null, itemTypes: null, keys: Object.keys(value) };
  }
  return { exists: true, isNull: false, type: typeof value, isArray: false, isPlainObject: false, length: null, itemTypes: null, keys: null };
}

/**
 * Validates a provider's parsed JSON output against the Social Media
 * Result contract — every field createSocialMediaPackage() itself
 * requires (in camelCase), except editorialPackageId/llmModel/
 * promptVersion/schemaVersion, which social-media-package-generator.mjs
 * supplies itself, never the provider.
 */
export function assertValidSocialMediaResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    fail("result is not an object");
  }
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(result[field])) fail(`${field} is required and must be a non-empty string`, field);
  }

  const platforms = result.platforms;
  if (!platforms || typeof platforms !== "object") fail("platforms is required and must be an object", "platforms");
  for (const platform of TEXT_PLATFORMS) {
    const variation = platforms[platform];
    if (!variation || typeof variation !== "object") fail(`platforms.${platform} is required`, `platforms.${platform}`);
    if (!isNonEmptyString(variation.postText)) fail(`platforms.${platform}.postText is required and must be a non-empty string`, `platforms.${platform}.postText`);
    if (variation.hashtags !== undefined && (!Array.isArray(variation.hashtags) || !variation.hashtags.every(isNonEmptyString))) {
      fail(`platforms.${platform}.hashtags must be an array of non-empty strings`, `platforms.${platform}.hashtags`);
    }
  }
  const instagram = platforms.instagram;
  if (!instagram || typeof instagram !== "object") fail("platforms.instagram is required", "platforms.instagram");
  if (!isNonEmptyString(instagram.caption)) fail("platforms.instagram.caption is required and must be a non-empty string", "platforms.instagram.caption");
  if (instagram.hashtags !== undefined && (!Array.isArray(instagram.hashtags) || !instagram.hashtags.every(isNonEmptyString))) {
    fail("platforms.instagram.hashtags must be an array of non-empty strings", "platforms.instagram.hashtags");
  }

  const carousel = result.carousel;
  if (!carousel || typeof carousel !== "object") fail("carousel is required and must be an object", "carousel");
  for (const field of CAROUSEL_ARRAY_FIELDS) {
    const value = carousel[field];
    if (!Array.isArray(value) || value.length !== CAROUSEL_SLIDE_COUNT || !value.every(isNonEmptyString)) {
      fail(`carousel.${field} must be an array of exactly ${CAROUSEL_SLIDE_COUNT} non-empty strings`, `carousel.${field}`);
    }
  }

  const slides = carousel.slides;
  if (!Array.isArray(slides) || slides.length !== CAROUSEL_SLIDE_COUNT) {
    fail(`carousel.slides must be an array of exactly ${CAROUSEL_SLIDE_COUNT} entries`, "carousel.slides");
  }
  slides.forEach((slide, index) => {
    const expectedNumber = index + 1;
    const expectedRole = CAROUSEL_SLIDE_ROLE_ORDER[index];
    const slidePath = `carousel.slides[${index}]`;
    if (!slide || typeof slide !== "object") fail(`${slidePath} is required`, slidePath);
    if (slide.slideNumber !== expectedNumber) {
      fail(`${slidePath}.slideNumber must be ${expectedNumber}, got ${JSON.stringify(slide.slideNumber)}`, `${slidePath}.slideNumber`);
    }
    if (slide.slideRole !== expectedRole) {
      fail(`${slidePath}.slideRole must be "${expectedRole}" (fixed positional order), got ${JSON.stringify(slide.slideRole)}`, `${slidePath}.slideRole`);
    }
    if (!isNonEmptyString(slide.heading)) fail(`${slidePath}.heading is required and must be a non-empty string`, `${slidePath}.heading`);
    if (!isNonEmptyString(slide.body)) fail(`${slidePath}.body is required and must be a non-empty string`, `${slidePath}.body`);
    if (!isNonEmptyString(slide.imageGuidance)) fail(`${slidePath}.imageGuidance is required and must be a non-empty string`, `${slidePath}.imageGuidance`);

    if (slide.statistic !== null) {
      if (!slide.statistic || typeof slide.statistic !== "object" || !isNonEmptyString(slide.statistic.value) || !isNonEmptyString(slide.statistic.context)) {
        fail(`${slidePath}.statistic must be null or { value, context } with non-empty strings`, `${slidePath}.statistic`);
      }
    }
    if (slide.quote !== null) {
      if (!slide.quote || typeof slide.quote !== "object" || !isNonEmptyString(slide.quote.quoteText)) {
        fail(`${slidePath}.quote must be null or { quoteText } with a non-empty string`, `${slidePath}.quote`);
      }
    }
    if (!Array.isArray(slide.keyPoints) || slide.keyPoints.length > 4 || !slide.keyPoints.every(isNonEmptyString)) {
      fail(`${slidePath}.keyPoints must be an array of 0-4 non-empty strings`, `${slidePath}.keyPoints`);
    }
  });

  return result;
}

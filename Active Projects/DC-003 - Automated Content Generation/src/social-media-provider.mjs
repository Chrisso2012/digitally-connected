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

export function assertValidSocialMediaProvider(provider) {
  if (!provider || typeof provider.name !== "string" || typeof provider.generateSocialMedia !== "function") {
    throw new InvalidSocialMediaProviderError();
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function fail(reason) {
  throw new MalformedSocialMediaResultError(reason);
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
    if (!isNonEmptyString(result[field])) fail(`${field} is required and must be a non-empty string`);
  }

  const platforms = result.platforms;
  if (!platforms || typeof platforms !== "object") fail("platforms is required and must be an object");
  for (const platform of TEXT_PLATFORMS) {
    const variation = platforms[platform];
    if (!variation || typeof variation !== "object") fail(`platforms.${platform} is required`);
    if (!isNonEmptyString(variation.postText)) fail(`platforms.${platform}.postText is required and must be a non-empty string`);
    if (variation.hashtags !== undefined && (!Array.isArray(variation.hashtags) || !variation.hashtags.every(isNonEmptyString))) {
      fail(`platforms.${platform}.hashtags must be an array of non-empty strings`);
    }
  }
  const instagram = platforms.instagram;
  if (!instagram || typeof instagram !== "object") fail("platforms.instagram is required");
  if (!isNonEmptyString(instagram.caption)) fail("platforms.instagram.caption is required and must be a non-empty string");
  if (instagram.hashtags !== undefined && (!Array.isArray(instagram.hashtags) || !instagram.hashtags.every(isNonEmptyString))) {
    fail("platforms.instagram.hashtags must be an array of non-empty strings");
  }

  const carousel = result.carousel;
  if (!carousel || typeof carousel !== "object") fail("carousel is required and must be an object");
  for (const field of CAROUSEL_ARRAY_FIELDS) {
    const value = carousel[field];
    if (!Array.isArray(value) || value.length !== CAROUSEL_SLIDE_COUNT || !value.every(isNonEmptyString)) {
      fail(`carousel.${field} must be an array of exactly ${CAROUSEL_SLIDE_COUNT} non-empty strings`);
    }
  }

  return result;
}

// DC-003-I031 — Editorial Package Prompt Builder. Mirrors
// carousel-prompt-builder.mjs exactly: turns an Ingested Content record
// into a deterministic LLM prompt string. Pure function of its input —
// the same Ingested Content always produces the exact same prompt, byte
// for byte. Never calls an LLM, never imports a provider — this module
// only builds text.

import { EditorialPromptBuilderError } from "./editorial-analysis-errors.mjs";

export const PROMPT_VERSION = "editorial-package.v1";

const REQUIRED_FIELDS = ["title", "full_article_text"];

function isBlank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

// Collapses internal newlines/tabs/runs of whitespace to single spaces —
// mirrors carousel-prompt-builder.mjs's own sanitizeForPrompt() exactly,
// so a multi-paragraph article body can never break this prompt's
// line-oriented "## Section" structure.
function sanitizeForPrompt(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Builds the deterministic editorial-analysis prompt for one Ingested
 * Content record. Throws EditorialPromptBuilderError if a field the
 * prompt needs is blank — a defense-in-depth check independent of
 * whatever validated the Ingested Content upstream (mirrors
 * buildCarouselPrompt()'s own identical precedent).
 */
export function buildEditorialPackagePrompt(ingestedContent) {
  const blankFields = REQUIRED_FIELDS.filter((field) => isBlank(ingestedContent[field]));
  if (blankFields.length > 0) {
    throw new EditorialPromptBuilderError(
      `Cannot build an editorial-package prompt — Ingested Content has no usable content for: ${blankFields.join(", ")}`,
      blankFields
    );
  }

  const lines = [
    "You are the senior editorial strategist for Digitally Connected's content marketing team.",
    "Analyse the following approved long-form article and extract structured editorial intelligence from it.",
    "Return JSON only. No prose, no markdown, no code fences — a single JSON object and nothing else.",
    "",
    "## Article title",
    sanitizeForPrompt(ingestedContent.title),
    "",
    "## Article body",
    sanitizeForPrompt(ingestedContent.full_article_text),
    "",
    "## Writing constraints",
    "- Base every field strictly on the article above — never invent a fact, statistic, or claim not present in it.",
    "- Sentence case, not Title Case, for headlines.",
    "- SEO title under 60 characters; SEO description under 160 characters.",
    "- Pull quotes must be verbatim (or near-verbatim) sentences drawn from the article body, not paraphrases.",
    "",
    "## Output format",
    "Return exactly one JSON object with these fields:",
    '  "primaryHeadline": string — the single strongest headline for this article.',
    '  "supportingHeadline": string — a secondary headline/subhead.',
    '  "executiveSummary": string — a 2-3 sentence summary of the whole article.',
    '  "coreMessage": string — the one central message the article makes.',
    '  "primaryAudience": string — who this article is written for.',
    '  "primaryProblem": string — the problem or pain point the article addresses.',
    '  "desiredOutcome": string — what the reader should think, feel, or do after reading.',
    '  "keyInsights": array of strings — the article\'s most important individual insights.',
    '  "pullQuotes": array of strings — quotable sentences drawn from the article body.',
    '  "callToAction": string — the single strongest call to action implied or stated by the article.',
    '  "keywords": array of strings — SEO-relevant keywords/phrases this article targets.',
    '  "seoTitle": string — a search-engine-optimised page title.',
    '  "seoDescription": string — a search-engine-optimised meta description.',
    '  "suggestedHashtags": array of strings — hashtags suitable for social promotion of this article, without the leading "#".',
    '  "editorialThemes": array of strings — the broader editorial themes this article belongs to.',
    '  "contentCategories": array of strings — content/topic categories this article belongs to.',
    "No other top-level fields. No trailing commentary before or after the JSON.",
  ];

  return lines.join("\n");
}

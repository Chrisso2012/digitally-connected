// DC-003-I031 — Editorial Package Prompt Builder. Mirrors
// carousel-prompt-builder.mjs exactly: turns an Ingested Content record
// into a deterministic LLM prompt string. Pure function of its input —
// the same Ingested Content always produces the exact same prompt, byte
// for byte. Never calls an LLM, never imports a provider — this module
// only builds text.

import { EditorialPromptBuilderError } from "./editorial-analysis-errors.mjs";

export const PROMPT_VERSION = "editorial-package.v3";

// DC-003-I031.7 — bounded cardinality TARGETS (guidance, never a hard
// structural minimum) for each canonical array<string> field, grounded
// in that field's own existing editorial purpose. A live verification
// (ep_8e2083b8c15240f7) proved I031.6's array-shape fix worked but the
// model then satisfied every field with exactly one item — technically
// valid, not useful for downstream social content. Deliberately NOT
// enforced via the tool schema's own minItems (still 1 in
// editorial-analysis-transport-http.mjs, unchanged): a hard minimum
// greater than 1 would force fabrication on a genuinely thin source,
// which this milestone explicitly forbids. The target is prompt
// guidance only — "aim for this many when the source supports it, never
// invent to reach it."
export const FIELD_RICHNESS_TARGETS = {
  keyInsights: { min: 3, max: 6, purpose: "the article's most important individual insights" },
  pullQuotes: { min: 2, max: 4, purpose: "verbatim (or near-verbatim) quotable sentences — naturally scarcer than insights, since each must be real quotable text" },
  keywords: { min: 5, max: 10, purpose: "SEO-relevant keywords/phrases" },
  suggestedHashtags: { min: 4, max: 8, purpose: "social-promotion hashtags" },
  editorialThemes: { min: 2, max: 4, purpose: "broader editorial themes — fewer and broader than individual insights by nature" },
  contentCategories: { min: 2, max: 4, purpose: "content/topic categories — broad classification buckets, not a long list" },
};

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
    "- keyInsights, pullQuotes, keywords, suggestedHashtags, editorialThemes, and contentCategories are each a native JSON array — every individual insight/quote/keyword/hashtag/theme/category is its own separate array element (a separate JSON string), never combined into one.",
    "- Do NOT represent any of those six list fields as a single string. Never use XML tags (e.g. <item>...</item>), never use newline-delimited or comma-delimited pseudo-lists inside one string, and never serialise an array as text inside a string. Use the tool's own array structure directly.",
    "",
    "## Richness expectations for the six array fields",
    "Each of the six array fields below has a TARGET item count — aim for that many DISTINCT items when the article genuinely supports it:",
    ...Object.entries(FIELD_RICHNESS_TARGETS).map(([field, { min, max, purpose }]) => `  - ${field}: aim for ${min}-${max} items (${purpose}).`),
    "These are targets, not hard requirements:",
    "- Never fabricate, invent, pad, or repeat a near-duplicate/trivially-reworded item merely to reach the target — if the article genuinely supports fewer distinct items than the target minimum, return only as many as are genuinely, distinctly supported.",
    "- Do not satisfy a field with a single overly-broad, generic item when the article actually contains several genuinely distinct ones — that under-uses the article's real content.",
    "- Every item in every field must remain strictly grounded in the article above — the same no-invention rule from Writing constraints applies per item, not just per field.",
    "- pullQuotes keeps its own stricter rule above (verbatim/near-verbatim real sentences) — never manufacture a quotation to reach the target; a genuinely quote-light article may honestly yield fewer than the target.",
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
    `  "keyInsights": a native JSON array of strings, one insight per array element (NOT a single string, NOT XML-tagged), target ${FIELD_RICHNESS_TARGETS.keyInsights.min}-${FIELD_RICHNESS_TARGETS.keyInsights.max} distinct items — the article's most important individual insights.`,
    `  "pullQuotes": a native JSON array of strings, one quote per array element (NOT a single string, NOT XML-tagged), target ${FIELD_RICHNESS_TARGETS.pullQuotes.min}-${FIELD_RICHNESS_TARGETS.pullQuotes.max} distinct items — quotable sentences drawn from the article body.`,
    '  "callToAction": string — the single strongest call to action implied or stated by the article.',
    `  "keywords": a native JSON array of strings, one keyword/phrase per array element (NOT a single string, NOT XML-tagged), target ${FIELD_RICHNESS_TARGETS.keywords.min}-${FIELD_RICHNESS_TARGETS.keywords.max} distinct items — SEO-relevant keywords/phrases this article targets.`,
    '  "seoTitle": string — a search-engine-optimised page title.',
    '  "seoDescription": string — a search-engine-optimised meta description.',
    `  "suggestedHashtags": a native JSON array of strings, one hashtag per array element (NOT a single string, NOT XML-tagged), target ${FIELD_RICHNESS_TARGETS.suggestedHashtags.min}-${FIELD_RICHNESS_TARGETS.suggestedHashtags.max} distinct items — hashtags suitable for social promotion of this article, without the leading "#".`,
    `  "editorialThemes": a native JSON array of strings, one theme per array element (NOT a single string, NOT XML-tagged), target ${FIELD_RICHNESS_TARGETS.editorialThemes.min}-${FIELD_RICHNESS_TARGETS.editorialThemes.max} distinct items — the broader editorial themes this article belongs to.`,
    `  "contentCategories": a native JSON array of strings, one category per array element (NOT a single string, NOT XML-tagged), target ${FIELD_RICHNESS_TARGETS.contentCategories.min}-${FIELD_RICHNESS_TARGETS.contentCategories.max} distinct items — content/topic categories this article belongs to.`,
    "No other top-level fields. No trailing commentary before or after the JSON.",
  ];

  return lines.join("\n");
}

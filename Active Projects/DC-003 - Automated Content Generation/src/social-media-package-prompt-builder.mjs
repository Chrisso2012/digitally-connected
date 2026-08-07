// DC-003-I032 — Social Media Package Prompt Builder. Mirrors
// editorial-package-prompt-builder.mjs exactly: turns an Editorial
// Package record into a deterministic LLM prompt string. Pure function
// of its input — the same Editorial Package always produces the exact
// same prompt, byte for byte. Never calls an LLM, never imports a
// provider — this module only builds text.
//
// Reads ONLY the Editorial Package's own fields — never the Ingested
// Content record it was itself derived from, and never a raw article.
// This is the structural enforcement of this milestone's own "consume
// only the Editorial Package" boundary at the prompt-building layer.

import { SocialMediaPromptBuilderError } from "./social-media-analysis-errors.mjs";

export const PROMPT_VERSION = "social-media-package.v2";

const REQUIRED_FIELDS = ["primary_headline", "core_message", "call_to_action"];

function isBlank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function sanitizeForPrompt(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function joinList(values) {
  return values.map((v) => `- ${sanitizeForPrompt(v)}`).join("\n");
}

/**
 * Builds the deterministic social-media-package prompt for one Editorial
 * Package record. Throws SocialMediaPromptBuilderError if a field the
 * prompt needs is blank — a defense-in-depth check independent of
 * whatever validated the Editorial Package upstream.
 */
export function buildSocialMediaPackagePrompt(editorialPackage) {
  const blankFields = REQUIRED_FIELDS.filter((field) => isBlank(editorialPackage[field]));
  if (blankFields.length > 0) {
    throw new SocialMediaPromptBuilderError(
      `Cannot build a social-media-package prompt — Editorial Package has no usable content for: ${blankFields.join(", ")}`,
      blankFields
    );
  }

  const lines = [
    "You are the senior social media strategist for Digitally Connected's content marketing team.",
    "Transform the following approved editorial intelligence into platform-tailored social media content.",
    "Return JSON only. No prose, no markdown, no code fences — a single JSON object and nothing else.",
    "",
    "## Primary headline",
    sanitizeForPrompt(editorialPackage.primary_headline),
    "",
    "## Core message",
    sanitizeForPrompt(editorialPackage.core_message),
    "",
    "## Primary audience",
    sanitizeForPrompt(editorialPackage.primary_audience),
    "",
    "## Key insights",
    joinList(editorialPackage.key_insights ?? []),
    "",
    "## Pull quotes",
    joinList(editorialPackage.pull_quotes ?? []),
    "",
    "## Call to action",
    sanitizeForPrompt(editorialPackage.call_to_action),
    "",
    "## Suggested hashtags",
    joinList(editorialPackage.suggested_hashtags ?? []),
    "",
    "## Writing constraints",
    "- Base every field strictly on the editorial intelligence above — never invent a fact, statistic, or claim not present in it.",
    "- Tailor each platform's own tone and length to that platform's own real conventions (LinkedIn: professional, longer form; X: concise, under 280 characters; Facebook: conversational; Instagram: visual-first, caption supports the image).",
    "- Never invent a statistic, quote, or client name presented as real.",
    "",
    "## Carousel structure — six semantic slide roles",
    "The carousel must follow this EXACT six-slide structure, in this exact order. Each slide has a fixed role; do not reorder, skip, or merge roles:",
    "  1. cover — the headline concept that opens the carousel.",
    "  2. insight — one real, substantive insight from the editorial intelligence above.",
    "  3. statistic — a real, already-present numeric/percentage/data figure, IF AND ONLY IF one genuinely appears in the editorial intelligence above.",
    "  4. quote — a real pull quote from the editorial intelligence above.",
    "  5. takeaway — a practical, actionable summary point drawn from the editorial intelligence above.",
    "  6. cta — the call to action.",
    "",
    "## Evidence-only policy — read carefully, this is a hard constraint",
    "- The \"statistic\" slide's `statistic` field MUST be null unless a real number, percentage, or figure is ALREADY PRESENT somewhere in the editorial intelligence above (the key insights, pull quotes, executive summary, core message, primary problem, or desired outcome). If no such figure exists, set `statistic` to null and instead use another real key insight as that slide's heading/body — do NOT invent, estimate, round, or paraphrase a number into existence.",
    "- The \"quote\" slide's `quote` field MUST be null unless a real quote genuinely exists in the pull quotes above. Never invent a quotation, and never invent a speaker name or title (attribution) for any quote — this package has no attribution field for a reason: none is available.",
    "- The \"takeaway\" slide's `keyPoints` array may contain 0 to 4 entries — only as many REAL key insights as genuinely exist. Never pad it with invented or paraphrased-to-sound-different filler to reach 4.",
    "- Never invent a case study, a company name, a research finding, or a financial figure not already present above.",
    "",
    "## Output format",
    "Return exactly one JSON object with these fields:",
    '  "hook": string — the single attention-grabbing opening concept used to seed every platform variation.',
    '  "callToAction": string — the strongest, most concrete call to action.',
    '  "tone": string — the tone used across the package (e.g. "professional and confident").',
    '  "audience": string — who this package is written for.',
    '  "platforms": {',
    '    "linkedin": { "postText": string, "hashtags": array of strings },',
    '    "facebook": { "postText": string, "hashtags": array of strings },',
    '    "x": { "postText": string, "hashtags": array of strings },',
    '    "instagram": { "caption": string, "hashtags": array of strings }',
    "  }",
    '  "carousel": {',
    '    "headings": array of exactly 6 strings — one short heading per slide, in order, matching slides[].heading,',
    '    "slideCopy": array of exactly 6 strings — one body copy string per slide, in order, matching slides[].body,',
    '    "imageGuidance": array of exactly 6 strings — one visual-direction note per slide, in order, matching slides[].imageGuidance,',
    '    "slides": array of exactly 6 objects, one per fixed role above, each:',
    "      {",
    '        "slideNumber": integer 1-6,',
    '        "slideRole": one of "cover", "insight", "statistic", "quote", "takeaway", "cta" (must match the fixed order above exactly),',
    '        "heading": string,',
    '        "body": string,',
    '        "imageGuidance": string,',
    '        "statistic": { "value": string, "context": string } OR null (see Evidence-only policy),',
    '        "quote": { "quoteText": string } OR null (see Evidence-only policy),',
    '        "keyPoints": array of 0-4 strings (used only by the "takeaway" slide; empty array for every other role)',
    "      }",
    "  }",
    "No other top-level fields. No trailing commentary before or after the JSON.",
  ];

  return lines.join("\n");
}

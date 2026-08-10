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

export const PROMPT_VERSION = "social-media-package.v4";

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
    "## Industry/audience specificity — read carefully, this applies to every field you generate",
    "- The Primary Audience above may name a specific industry, sector, or professional domain (e.g. real estate, healthcare, hospitality, B2B SaaS) — not just a generic job title. Read it for that domain, not only for who the reader is.",
    "- If a specific domain is clearly supported by the Primary Audience and the editorial intelligence above, set `industryContext` to a short description of it in your own words, and preferentially express every field you generate — hook, platform posts, and EVERY carousel slide (not only the cover/CTA) — using that domain's own concrete vocabulary, examples and scenarios wherever the editorial intelligence supports it, rather than defaulting to generic business language (e.g. \"database\", \"leads\", \"CRM strategy\" read as generic; if the domain is real estate, prefer the source's own terms such as vendors, buyers, landlords, agencies, property enquiries, listing decisions, and timing around buying/selling/property management, when those concepts genuinely appear in or are directly implied by the editorial intelligence above).",
    "- If no specific domain is clearly supported — the Primary Audience is genuinely general (e.g. \"small business owners\", \"marketing managers\") — set `industryContext` to null and write in general business terms. Never invent or guess a domain the source doesn't support.",
    "- This never means changing the facts, statistics, quotes, or claims themselves — only the vocabulary and framing used to express real editorial intelligence that already exists.",
    "",
    "## Carousel structure — six slide roles, position 4 is evidence-aware",
    "The carousel must follow this six-slide structure, in this exact order. Positions 1, 2, 3, 5, 6 have a fixed role; do not reorder, skip, or merge roles:",
    "  1. cover — the headline concept that opens the carousel.",
    "  2. insight — one real, substantive insight from the editorial intelligence above.",
    "  3. statistic — a real, already-present numeric/percentage/data figure, IF AND ONLY IF one genuinely appears in the editorial intelligence above.",
    "  4. quote OR evidence — see \"Position 4\" below; choose exactly one.",
    "  5. takeaway — a practical, actionable summary point drawn from the editorial intelligence above.",
    "  6. cta — the call to action.",
    "",
    "## Position 4: quote vs. evidence — read carefully, this is a hard constraint",
    "- \"Pull quotes\" above are excerpts FROM THE ARTICLE ITSELF — the author's own words. They are never a real external person's testimony: this package's own input never includes a genuine speaker name, job title, or organisation for any quote, for any article, in any industry. You have no basis to ever legitimately claim a quote is attributed to a real external person.",
    "- Because of this, slideRole \"quote\" is not available in the current version of this system — always choose slideRole \"evidence\" for position 4 instead. \"quote\" remains a defined role for a future version of this pipeline that provides genuine external-attribution data; do not use it now, under any circumstances, for any industry.",
    "- The \"evidence\" role: a second real, substantive insight from the editorial intelligence above — distinct from position 2's insight — written as ordinary carousel body copy (heading + body, exactly like the \"insight\" or \"takeaway\" roles). Its `quote` field MUST be null. Never wrap this content in quotation marks, and never present it as if it were said by, or attributed to, any person, title, or organisation — invented or otherwise.",
    "- If you were ever instructed in a future version to use \"quote\": its `quote` field must be null unless a real quote genuinely exists in the pull quotes above, and even then, never invent a speaker name, job title, or organisation to accompany it. This instruction is not in effect today.",
    "",
    "## Evidence-only policy — read carefully, this is a hard constraint",
    "- The \"statistic\" slide's `statistic` field MUST be null unless a real number, percentage, or figure is ALREADY PRESENT somewhere in the editorial intelligence above (the key insights, pull quotes, executive summary, core message, primary problem, or desired outcome). If no such figure exists, set `statistic` to null and instead use another real key insight as that slide's heading/body — do NOT invent, estimate, round, or paraphrase a number into existence.",
    "- Every slide's `quote` field MUST be null except position 4's — and per \"Position 4\" above, position 4's `quote` field is also null today, since slideRole must be \"evidence\", not \"quote\".",
    "- The \"takeaway\" slide's `keyPoints` array may contain 0 to 4 entries — only as many REAL key insights as genuinely exist. Never pad it with invented or paraphrased-to-sound-different filler to reach 4.",
    "- Never invent a case study, a company name, a research finding, or a financial figure not already present above.",
    "",
    "## Output format",
    "Return exactly one JSON object with these fields:",
    '  "hook": string — the single attention-grabbing opening concept used to seed every platform variation.',
    '  "callToAction": string — the strongest, most concrete call to action.',
    '  "tone": string — the tone used across the package (e.g. "professional and confident").',
    '  "audience": string — who this package is written for.',
    '  "industryContext": string or null — see "Industry/audience specificity" above; null when no specific domain is clearly supported.',
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
    '    "slides": array of exactly 6 objects, one per role above, each:',
    "      {",
    '        "slideNumber": integer 1-6,',
    '        "slideRole": one of "cover", "insight", "statistic", "evidence", "takeaway", "cta" (position 4 must be "evidence" — see "Position 4" above; "quote" is not available today),',
    '        "heading": string,',
    '        "body": string,',
    '        "imageGuidance": string,',
    '        "statistic": { "value": string, "context": string } OR null (see Evidence-only policy),',
    '        "quote": null (must be null for every slide today — see "Position 4" above),',
    '        "keyPoints": array of 0-4 strings (used only by the "takeaway" slide; empty array for every other role)',
    "      }",
    "  }",
    "No other top-level fields. No trailing commentary before or after the JSON.",
  ];

  return lines.join("\n");
}

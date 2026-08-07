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

export const PROMPT_VERSION = "social-media-package.v1";

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
    '    "headings": array of exactly 6 strings — one short heading per slide, in order,',
    '    "slideCopy": array of exactly 6 strings — one body copy string per slide, in order, matching headings,',
    '    "imageGuidance": array of exactly 6 strings — one visual-direction note per slide, in order',
    "  }",
    "No other top-level fields. No trailing commentary before or after the JSON.",
  ];

  return lines.join("\n");
}

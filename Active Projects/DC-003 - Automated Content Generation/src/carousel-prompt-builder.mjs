// DC-003-I004 — Prompt Builder.
//
// Turns a Topic Package into a deterministic LLM prompt string. Pure
// function of its input: the same Topic Package always produces the exact
// same prompt, byte for byte — no timestamps, random IDs, or other
// non-deterministic content are ever embedded here (those belong to the
// Generator Orchestrator, added after generation, not before).
//
// Never calls an LLM, never imports a provider — this module only builds
// text.

import { SLIDE_ORDER, SLIDE_CONTENT_SPEC } from "./carousel-slide-spec.mjs";
import { PromptBuilderError } from "./carousel-generator-errors.mjs";

export const PROMPT_VERSION = "carousel-copy.v1";

const REQUIRED_FIELDS = ["working_title", "audience", "primary_goal", "core_message", "cta", "brand_voice"];

function isBlank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

// Collapses internal newlines/tabs/runs of whitespace to single spaces so a
// multi-line or oddly-formatted Topic Package field can never break this
// prompt's line-oriented "## Section" structure. Everything else (quotes,
// punctuation, unicode) passes through untouched — this is plain text for
// an LLM, not a value being embedded inside a JSON literal we control.
function sanitizeForPrompt(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function describeSlideSpec(slideType) {
  const spec = SLIDE_CONTENT_SPEC[slideType];
  const parts = [];

  for (const field of spec.fields ?? []) {
    parts.push(`"${field}": string`);
  }
  for (const [field, rule] of Object.entries(spec.arrayFields ?? {})) {
    parts.push(`"${field}": array of ${rule.min}-${rule.max} strings`);
  }
  for (const [field, rule] of Object.entries(spec.objectArrayFields ?? {})) {
    const inner = rule.fields.map((f) => `"${f}": string`).join(", ");
    parts.push(`"${field}": array of exactly ${rule.exact} objects { ${inner} }`);
  }

  return `{ "slide_type": "${slideType}", "content": { ${parts.join(", ")} } }`;
}

/**
 * Builds the deterministic carousel-copy prompt for one Topic Package.
 * Throws PromptBuilderError if a field the prompt needs is blank — a
 * defense-in-depth check independent of whatever validated the Topic
 * Package upstream (see README "Prompt Builder").
 */
export function buildCarouselPrompt(topicPackage) {
  const blankFields = REQUIRED_FIELDS.filter((field) => isBlank(topicPackage[field]));
  const points = Array.isArray(topicPackage.supporting_points)
    ? topicPackage.supporting_points.filter((point) => !isBlank(point))
    : [];
  if (points.length === 0) {
    blankFields.push("supporting_points");
  }
  if (blankFields.length > 0) {
    throw new PromptBuilderError(
      `Cannot build a carousel prompt — Topic Package has no usable content for: ${blankFields.join(", ")}`,
      blankFields
    );
  }

  const lines = [
    "You are the copywriter for Digitally Connected's six-slide Instagram carousel format.",
    "Return JSON only. No prose, no markdown, no code fences — a single JSON object and nothing else.",
    "",
    "## Topic",
    sanitizeForPrompt(topicPackage.working_title),
    "",
    "## Audience",
    sanitizeForPrompt(topicPackage.audience),
    "",
    "## Objective",
    sanitizeForPrompt(topicPackage.primary_goal),
    "",
    "## Key message",
    sanitizeForPrompt(topicPackage.core_message),
    "",
    "## Supporting points",
    ...points.map((point) => `- ${sanitizeForPrompt(point)}`),
    "",
    "## Call to action",
    sanitizeForPrompt(topicPackage.cta),
    "",
    "## Desired tone",
    sanitizeForPrompt(topicPackage.brand_voice),
    "",
    "## Writing constraints",
    "- Sentence case, not Title Case.",
    "- No emoji, no hashtags, no markdown formatting inside any field.",
    "- Headlines under 12 words; body copy under 40 words per field.",
    '- Never invent a statistic, quote, or client name presented as real — mark anything illustrative as illustrative.',
    "",
    "## Slide sequence (produce exactly these six, in this exact order)",
    ...SLIDE_ORDER.map((slideType, index) => `${index + 1}. ${describeSlideSpec(slideType)}`),
    "",
    "## Brand rules",
    `- Voice: ${sanitizeForPrompt(topicPackage.brand_voice)}.`,
    "- Stay strictly on the topic and audience above — no unrelated claims or offers.",
    "",
    "## Output format",
    'Return exactly one JSON object: { "slides": [ <the six slide objects above, in that order> ] }',
    "No other top-level fields. No trailing commentary before or after the JSON.",
  ];

  return lines.join("\n");
}

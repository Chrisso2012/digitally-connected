// DC-003-I032.10.1 — Carousel Content Package emphasis-instruction
// validation. Pure functions only, no filesystem/store access.
//
// Architectural principle (from the brief): "Claude Code must not decide
// which phrase should receive emphasis." This module never chooses a
// phrase or a style — it only mechanically confirms that an
// ALREADY-DECIDED phrase genuinely appears in its own slide's own text,
// and that no two instructions on the same slide claim overlapping text.
// Both checks are structural/deterministic, the same category of check
// this codebase already applies elsewhere (e.g.
// social-media-package.mjs's own "a quote object may only accompany the
// quote role" cross-check) — never fuzzy, never semantic, never a
// judgment call.
//
// --- Normalisation rule (disclosed, conservative, documented) ---------
// Applied identically to both the phrase and the searched text before
// matching:
//   1. Smart/curly single quotes and the prime mark (' ' ′) -> straight
//      apostrophe (').
//   2. Smart/curly double quotes and the double-prime mark (" " ″) ->
//      straight double quote (").
//   3. Any run of whitespace collapsed to a single space; leading/
//      trailing whitespace trimmed.
// Deliberately NOT applied: case folding (case sensitivity is
// preserved — safer, avoids accidental cross-matches) and no
// stemming/pluralisation handling of any kind (that would be exactly
// the "fuzzy semantic matching" the brief explicitly forbids).
//
// --- DC-003-I035.1 — field-aware matching (bugfix) ---------------------
// A real production render crashed because two callers of this module
// used to disagree about what "a slide's own text" means:
// carousel-content-package.mjs's own import-time validation checked a
// phrase against `${headline} ${body}` CONCATENATED into one string, but
// carousel-renderer-templates.mjs only ever applied emphasis markup to
// `body` when rendering — a phrase genuinely present only in the
// headline (e.g. "source of future listings" in "Your appraisal history
// is a source of future listings.") passed import validation but then
// threw at render time, since the renderer never even looked at the
// headline.
//
// Fixed by making field membership explicit and shared: the functions
// below resolve each instruction to EXACTLY ONE real field (checked
// independently, never via concatenation) and are called identically by
// both the factory (to validate) and the renderer (to know which field's
// markup to apply an instruction to) — one shared source of truth,
// never two independent checks that can silently disagree again.
//
// This also closes a latent edge case the old concatenated-string check
// could never have caught: a phrase that only matches by spanning the
// boundary between headline and body (e.g. headline ending "...is a",
// body starting "genuine asset...", phrase "is a genuine") would have
// matched the concatenation `${headline} ${body}` while corresponding to
// no real, renderable span in either field — such a phrase could never
// coherently render (it isn't a real substring of anything a template
// actually draws), so it is now REJECTED at import time
// (EmphasisPhraseNotFoundError) exactly like any other not-found phrase,
// rather than being silently accepted and left to crash a future render.
// No special-case detection was needed for this — checking each field
// independently, rather than their concatenation, makes it fall out
// automatically.
//
// Priority when a (short, generic) phrase happens to match more than one
// field independently: `body` wins, preserving this codebase's own
// pre-existing behaviour (only `body` was ever actually rendered with
// emphasis before this fix, so anything that already worked continues
// to resolve exactly the same way).

import { EmphasisPhraseNotFoundError, ConflictingEmphasisInstructionsError } from "./carousel-content-package-errors.mjs";

const SMART_SINGLE_QUOTES = /[‘’′]/g;
const SMART_DOUBLE_QUOTES = /[“”″]/g;

export function normalizeForEmphasisMatching(text) {
  return String(text)
    .replace(SMART_SINGLE_QUOTES, "'")
    .replace(SMART_DOUBLE_QUOTES, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Returns the [start, end) character range of the FIRST occurrence of
// `normalizedPhrase` in `normalizedHaystack`, or null if absent.
function findFirstMatchRange(normalizedHaystack, normalizedPhrase) {
  const start = normalizedHaystack.indexOf(normalizedPhrase);
  if (start === -1) return null;
  return { start, end: start + normalizedPhrase.length };
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

/**
 * Validates every emphasis instruction on one slide against that slide's
 * own searchable text (its headline/body, concatenated by the caller).
 * Never mutates/reorders the input array. Returns nothing on success.
 *
 * fields.slideNumber — the slide_number these instructions belong to
 *   (used only for error messages).
 * fields.searchableText — the slide's own headline + body (or headline +
 *   supporting_line), concatenated by the caller — this function never
 *   decides which fields are searchable, only whether a phrase exists in
 *   whatever text it is given.
 * fields.emphasisInstructions — array of { phrase, style } (schema
 *   shape — style is validated by the schema's own closed enum, not
 *   re-checked here).
 *
 * Throws EmphasisPhraseNotFoundError if any phrase, after normalisation,
 * is not a substring of the normalised searchable text.
 *
 * Throws ConflictingEmphasisInstructionsError if two instructions on the
 * same slide have overlapping matched character ranges — including two
 * instructions naming the exact same phrase.
 */
export function validateEmphasisInstructions({ slideNumber, searchableText, emphasisInstructions }) {
  const normalizedHaystack = normalizeForEmphasisMatching(searchableText);
  const matchedRanges = [];

  for (const instruction of emphasisInstructions) {
    const normalizedPhrase = normalizeForEmphasisMatching(instruction.phrase);
    const range = findFirstMatchRange(normalizedHaystack, normalizedPhrase);
    if (!range) {
      throw new EmphasisPhraseNotFoundError(slideNumber, instruction.phrase);
    }
    for (const existing of matchedRanges) {
      if (rangesOverlap(range, existing.range)) {
        throw new ConflictingEmphasisInstructionsError(slideNumber, existing.phrase, instruction.phrase);
      }
    }
    matchedRanges.push({ phrase: instruction.phrase, range });
  }
}

// DC-003-I035.1 — `body` is checked before `headline`, so a phrase that
// happens to independently match both fields resolves to `body` —
// preserving this codebase's pre-fix behaviour, where only `body` was
// ever actually rendered with emphasis.
const DEFAULT_FIELD_PRIORITY = ["body", "headline"];

// Resolves one phrase to exactly one of `fields` (an object of
// { <fieldName>: text }), checking each field's own text INDEPENDENTLY
// — never a concatenation of several fields — so a match can never span
// a boundary between two fields. Returns { field, range } (range in that
// field's own normalised-text coordinate space) for the first field (in
// `fieldOrder`) whose normalised text contains the normalised phrase, or
// null if no field matches on its own.
export function resolveEmphasisInstructionField(fields, phrase, fieldOrder = DEFAULT_FIELD_PRIORITY) {
  const normalizedPhrase = normalizeForEmphasisMatching(phrase);
  for (const fieldName of fieldOrder) {
    const fieldText = fields[fieldName];
    if (fieldText == null) continue;
    const range = findFirstMatchRange(normalizeForEmphasisMatching(fieldText), normalizedPhrase);
    if (range) return { field: fieldName, range };
  }
  return null;
}

/**
 * Field-aware replacement for validateEmphasisInstructions() — used
 * wherever a slide has MORE THAN ONE field an emphasis phrase could
 * legitimately belong to (currently: `headline` and `body`). Never
 * mutates/reorders the input array. Returns nothing on success.
 *
 * slideNumber — used only for error messages.
 * fields — { headline: string, body: string } (or any subset/superset
 *   of named fields the caller wants phrases checked against) — each
 *   checked independently, never concatenated.
 * emphasisInstructions — array of { phrase, style }.
 *
 * Throws EmphasisPhraseNotFoundError if a phrase, after normalisation,
 * is not a substring of ANY single field's own normalised text —
 * including a phrase that would only match a concatenation of two
 * fields (see this file's own header comment on the boundary-spanning
 * edge case).
 *
 * Throws ConflictingEmphasisInstructionsError if two instructions
 * resolve to the SAME field with overlapping matched ranges — two
 * instructions resolving to different fields never conflict, since they
 * render into different elements entirely.
 */
export function validateEmphasisInstructionsAcrossFields({ slideNumber, fields, emphasisInstructions, fieldOrder = DEFAULT_FIELD_PRIORITY }) {
  const matchedRangesByField = {};

  for (const instruction of emphasisInstructions) {
    const resolved = resolveEmphasisInstructionField(fields, instruction.phrase, fieldOrder);
    if (!resolved) {
      throw new EmphasisPhraseNotFoundError(slideNumber, instruction.phrase);
    }
    const { field, range } = resolved;
    const matchedRanges = matchedRangesByField[field] ?? (matchedRangesByField[field] = []);
    for (const existing of matchedRanges) {
      if (rangesOverlap(range, existing.range)) {
        throw new ConflictingEmphasisInstructionsError(slideNumber, existing.phrase, instruction.phrase);
      }
    }
    matchedRanges.push({ phrase: instruction.phrase, range });
  }
}

/**
 * Splits an already-validated emphasis_instructions array by which of
 * `fields` each instruction's phrase belongs to — used by the renderer
 * to know which field's own markup an instruction applies to, using the
 * EXACT SAME resolution rule validateEmphasisInstructionsAcrossFields()
 * already confirmed every instruction satisfies (never a second,
 * independent matching system).
 *
 * Returns an object with one array per key of `fields`, e.g.
 * { headline: [...], body: [...] }, each safe to pass straight into
 * carousel-renderer-emphasis-html.mjs's renderTextWithEmphasisHtml()
 * for that same field's own text.
 *
 * Throws (defensively — should never happen for an already-validated
 * Carousel Content Package) if a phrase resolves to no field at all.
 */
export function partitionEmphasisInstructionsByField(fields, emphasisInstructions, fieldOrder = DEFAULT_FIELD_PRIORITY) {
  const result = {};
  for (const fieldName of Object.keys(fields)) result[fieldName] = [];

  for (const instruction of emphasisInstructions) {
    const resolved = resolveEmphasisInstructionField(fields, instruction.phrase, fieldOrder);
    if (!resolved) {
      throw new Error(
        `partitionEmphasisInstructionsByField: approved phrase ${JSON.stringify(instruction.phrase)} does not match any of ${Object.keys(fields).join(", ")} — this should never happen for an already-validated Carousel Content Package`
      );
    }
    result[resolved.field].push(instruction);
  }

  return result;
}

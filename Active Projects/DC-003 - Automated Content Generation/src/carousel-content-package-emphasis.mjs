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

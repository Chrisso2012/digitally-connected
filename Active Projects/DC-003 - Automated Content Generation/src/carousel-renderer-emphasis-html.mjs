// DC-003-I035 — renders a slide's approved text with its approved
// emphasis_instructions applied as deterministic HTML markup. Reuses
// carousel-content-package-emphasis.mjs's own exported
// normalizeForEmphasisMatching() DIRECTLY — never reimplements a second
// matching/normalisation algorithm (per this milestone's own brief).
// carousel-content-package.mjs (I032.10.1, protected/unmodified) has
// already validated, at construction time, that every phrase genuinely
// exists in its own slide's text and that no two instructions overlap —
// this module's only job is to locate WHERE in the original, un-modified
// copy each phrase falls, so it can be wrapped for display. The
// displayed text is always the original approved copy verbatim; only
// the matched span gets a visual treatment.
//
// Why not just reuse validateEmphasisInstructions() directly? That
// function proves existence/non-overlap in NORMALISED space and
// deliberately returns nothing (it is a validation gate, not a locator).
// Re-deriving the ORIGINAL-text position of a normalised match requires
// mapping back through whitespace-collapsing/quote-substitution — done
// here by repeatedly calling the SAME shared normaliser
// (normalizeForEmphasisMatching(), imported and used completely
// unmodified) against growing prefixes of the original text — never a
// second, independent normalisation implementation.
//
// A real bug was caught and fixed here during this milestone's own
// development: naively comparing normalizeForEmphasisMatching(text.slice(0,i)).length
// against a target is corrupted right at a whitespace boundary, because
// normalizeForEmphasisMatching() also TRIMS trailing whitespace — a
// prefix ending exactly on the space before a match has that space
// silently trimmed away, undercounting by one and shifting every match
// one character too late (confirmed via a real render: "interested or
// not" rendered as "nterested or not", missing its leading "i"). Fixed
// by appending a non-whitespace, non-quote sentinel character to each
// probed prefix before normalising, so a prefix's own trailing
// whitespace is never mistaken for the STRING's own trailing whitespace
// — still the exact same shared normaliser, called unmodified, just
// probed correctly.

import { normalizeForEmphasisMatching } from "./carousel-content-package-emphasis.mjs";

// A single non-whitespace, non-quote character — guaranteed unaffected
// by either of normalizeForEmphasisMatching()'s own rules — used only to
// stop trim() from consuming a probed prefix's own genuine trailing
// whitespace; never part of any returned range or rendered output.
const BOUNDARY_SENTINEL = "#";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Smallest prefix length of `text` whose normalisation reaches at least
// `targetNormalizedLength` characters — reuses normalizeForEmphasisMatching()
// on each candidate prefix (with a trailing sentinel so the prefix's own
// trailing whitespace is never trimmed away and undercounted — see this
// file's own header comment). O(n^2) in the length of `text`, which is
// always one slide's own headline/body (at most a few hundred
// characters) — negligible.
function originalIndexForNormalizedLength(text, targetNormalizedLength) {
  if (targetNormalizedLength <= 0) return 0;
  for (let i = 1; i <= text.length; i++) {
    const probeLength = normalizeForEmphasisMatching(text.slice(0, i) + BOUNDARY_SENTINEL).length - 1;
    if (probeLength >= targetNormalizedLength) {
      return i;
    }
  }
  return text.length;
}

/**
 * Finds the [start, end) character range in the ORIGINAL (un-normalised)
 * `text` corresponding to the first normalised occurrence of `phrase`.
 * Returns null if genuinely absent (should not happen for an
 * already-CCP-validated phrase; callers treat this as a defensive,
 * fail-closed case, never a silent skip).
 */
export function findOriginalMatchRange(text, phrase) {
  const normalizedPhrase = normalizeForEmphasisMatching(phrase);
  const normalizedText = normalizeForEmphasisMatching(text);
  const normalizedStart = normalizedText.indexOf(normalizedPhrase);
  if (normalizedStart === -1) return null;
  const normalizedEnd = normalizedStart + normalizedPhrase.length;

  const start = originalIndexForNormalizedLength(text, normalizedStart);
  const end = originalIndexForNormalizedLength(text, normalizedEnd);
  return { start, end };
}

const STYLE_TAG = {
  highlight: "mark",
  strike: "s",
};

/**
 * Renders `text` as safe, escaped HTML with every approved emphasis
 * instruction applied as a `<mark class="emphasis-highlight">` or
 * `<s class="emphasis-strike">` wrapper around the exact approved
 * phrase — nothing else is ever altered. Non-emphasised text is escaped
 * plain text. Never applies emphasis to anything beyond the phrases
 * supplied; never chooses or infers a phrase itself.
 *
 * text — the slide's own approved copy (already CEO-approved, verbatim).
 * emphasisInstructions — the slide's own `emphasis_instructions` array,
 *   already validated by carousel-content-package.mjs at construction
 *   time (existence + non-overlap guaranteed).
 *
 * Returns an HTML string safe to inject directly into the template.
 */
export function renderTextWithEmphasisHtml(text, emphasisInstructions) {
  if (!emphasisInstructions || emphasisInstructions.length === 0) {
    return escapeHtml(text);
  }

  const ranges = emphasisInstructions
    .map((instruction) => {
      const range = findOriginalMatchRange(text, instruction.phrase);
      // Defensive only — CCP's own factory already guarantees this
      // exists; a null here means the renderer is looking at text CCP
      // did not validate this instruction against (a caller bug), so it
      // fails closed rather than silently dropping the emphasis.
      if (!range) {
        throw new Error(`renderTextWithEmphasisHtml: approved phrase ${JSON.stringify(instruction.phrase)} not found in the supplied text — this should never happen for an already-validated Carousel Content Package`);
      }
      return { ...range, style: instruction.style };
    })
    .sort((a, b) => a.start - b.start);

  let html = "";
  let cursor = 0;
  for (const range of ranges) {
    html += escapeHtml(text.slice(cursor, range.start));
    const tag = STYLE_TAG[range.style];
    const cssClass = range.style === "highlight" ? "emphasis-highlight" : "emphasis-strike";
    html += `<${tag} class="${cssClass}">${escapeHtml(text.slice(range.start, range.end))}</${tag}>`;
    cursor = range.end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

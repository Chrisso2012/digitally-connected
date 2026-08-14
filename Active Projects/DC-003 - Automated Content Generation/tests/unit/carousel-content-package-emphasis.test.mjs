// DC-003-I032.10.1 — regression coverage for
// carousel-content-package-emphasis.mjs: pure, dependency-free
// normalisation + substring + overlap checks. No filesystem/store
// involved — carousel-content-package.test.mjs covers this wired
// through the real factory.
//
// DC-003-I035.1 — also covers the field-aware functions added to fix a
// real production render crash: the old validateEmphasisInstructions()
// (still tested above, still unchanged) checks a phrase against ONE
// caller-concatenated string; carousel-content-package.mjs used to pass
// it `${headline} ${body}` at import time while the renderer only ever
// applied emphasis to `body` — a phrase genuinely only in the headline
// passed import validation and then crashed the renderer. The new
// resolveEmphasisInstructionField() / validateEmphasisInstructionsAcrossFields() /
// partitionEmphasisInstructionsByField() check `headline` and `body` as
// two INDEPENDENT fields instead, so both the factory (validation) and
// the renderer (which field to apply markup to) always agree — and a
// phrase that only matches by spanning the headline/body boundary (never
// a real substring of either field alone) is now rejected at import time
// instead of surviving to crash a render.

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeForEmphasisMatching,
  validateEmphasisInstructions,
  resolveEmphasisInstructionField,
  validateEmphasisInstructionsAcrossFields,
  partitionEmphasisInstructionsByField,
} from "../../src/carousel-content-package-emphasis.mjs";
import { EmphasisPhraseNotFoundError, ConflictingEmphasisInstructionsError } from "../../src/carousel-content-package-errors.mjs";

test("normalizeForEmphasisMatching collapses whitespace runs and trims", () => {
  assert.equal(normalizeForEmphasisMatching("  ready   or  not\tready  yet  "), "ready or not ready yet");
});

test("normalizeForEmphasisMatching converts smart single quotes to a straight apostrophe", () => {
  assert.equal(normalizeForEmphasisMatching("today’s silence"), "today's silence");
  assert.equal(normalizeForEmphasisMatching("‘ready’"), "'ready'");
});

test("normalizeForEmphasisMatching converts smart double quotes to a straight double quote", () => {
  assert.equal(normalizeForEmphasisMatching("“ready”"), '"ready"');
});

test("normalizeForEmphasisMatching does NOT case-fold — case sensitivity is preserved deliberately", () => {
  assert.equal(normalizeForEmphasisMatching("Ready"), "Ready");
  assert.notEqual(normalizeForEmphasisMatching("Ready"), normalizeForEmphasisMatching("ready"));
});

test("a phrase present verbatim in the searchable text passes", () => {
  assert.doesNotThrow(() =>
    validateEmphasisInstructions({
      slideNumber: 5,
      searchableText: "The better lens is ready or not ready yet, because circumstances change.",
      emphasisInstructions: [{ phrase: "ready or not ready yet", style: "highlight" }],
    })
  );
});

test("a phrase matched only after whitespace normalisation still passes (harmless formatting difference)", () => {
  assert.doesNotThrow(() =>
    validateEmphasisInstructions({
      slideNumber: 5,
      searchableText: "The better lens is ready   or\tnot ready  yet.",
      emphasisInstructions: [{ phrase: "ready or not ready yet", style: "highlight" }],
    })
  );
});

test("a phrase matched only after smart-quote normalisation still passes", () => {
  assert.doesNotThrow(() =>
    validateEmphasisInstructions({
      slideNumber: 5,
      searchableText: "Circumstances change, and today’s silence isn’t tomorrow’s answer.",
      emphasisInstructions: [{ phrase: "today's silence isn't tomorrow's answer", style: "highlight" }],
    })
  );
});

test("throws EmphasisPhraseNotFoundError when the phrase is genuinely absent", () => {
  assert.throws(
    () =>
      validateEmphasisInstructions({
        slideNumber: 3,
        searchableText: "Nothing in this sentence matches.",
        emphasisInstructions: [{ phrase: "not present anywhere", style: "highlight" }],
      }),
    EmphasisPhraseNotFoundError
  );
});

test("never fuzzy-matches — a close-but-not-exact phrase (different word) fails", () => {
  assert.throws(
    () =>
      validateEmphasisInstructions({
        slideNumber: 5,
        searchableText: "The better lens is ready or not ready yet.",
        emphasisInstructions: [{ phrase: "ready or not prepared yet", style: "highlight" }],
      }),
    EmphasisPhraseNotFoundError
  );
});

test("never case-folds — a phrase differing only in case fails (case sensitivity preserved)", () => {
  assert.throws(
    () =>
      validateEmphasisInstructions({
        slideNumber: 5,
        searchableText: "The better lens is ready or not ready yet.",
        emphasisInstructions: [{ phrase: "READY OR NOT READY YET", style: "highlight" }],
      }),
    EmphasisPhraseNotFoundError
  );
});

test("two non-overlapping phrases on the same slide both pass", () => {
  assert.doesNotThrow(() =>
    validateEmphasisInstructions({
      slideNumber: 5,
      searchableText: "The old lens was interested or not. The better lens is ready or not ready yet.",
      emphasisInstructions: [
        { phrase: "interested or not", style: "strike" },
        { phrase: "ready or not ready yet", style: "highlight" },
      ],
    })
  );
});

test("throws ConflictingEmphasisInstructionsError when two phrases' matched ranges overlap", () => {
  assert.throws(
    () =>
      validateEmphasisInstructions({
        slideNumber: 5,
        searchableText: "ready or not ready yet, act now",
        emphasisInstructions: [
          { phrase: "ready or not ready yet", style: "highlight" },
          { phrase: "not ready yet", style: "strike" },
        ],
      }),
    ConflictingEmphasisInstructionsError
  );
});

test("throws ConflictingEmphasisInstructionsError when the exact same phrase is listed twice", () => {
  assert.throws(
    () =>
      validateEmphasisInstructions({
        slideNumber: 5,
        searchableText: "ready or not ready yet.",
        emphasisInstructions: [
          { phrase: "ready or not ready yet", style: "highlight" },
          { phrase: "ready or not ready yet", style: "strike" },
        ],
      }),
    ConflictingEmphasisInstructionsError
  );
});

test("adjacent (touching, non-overlapping) phrases do not conflict", () => {
  assert.doesNotThrow(() =>
    validateEmphasisInstructions({
      slideNumber: 5,
      searchableText: "ready or not ready yet",
      emphasisInstructions: [
        { phrase: "ready or not", style: "highlight" },
        { phrase: " ready yet", style: "strike" },
      ],
    })
  );
});

test("an empty emphasis_instructions list never throws", () => {
  assert.doesNotThrow(() => validateEmphasisInstructions({ slideNumber: 2, searchableText: "Any text at all.", emphasisInstructions: [] }));
});

// ---- DC-003-I035.1 — field-aware functions ------------------------------

test("resolveEmphasisInstructionField finds a phrase present only in body", () => {
  const fields = { headline: "Every appraisal took real effort.", body: "That work doesn't just disappear when a vendor doesn't proceed." };
  const result = resolveEmphasisInstructionField(fields, "doesn't just disappear");
  assert.equal(result.field, "body");
});

test("resolveEmphasisInstructionField finds a phrase present only in headline", () => {
  const fields = { headline: "Your appraisal history is a source of future listings.", body: "Not a record of past misses." };
  const result = resolveEmphasisInstructionField(fields, "source of future listings");
  assert.equal(result.field, "headline");
});

test("resolveEmphasisInstructionField prefers body when a phrase matches both fields independently", () => {
  const fields = { headline: "Ready is the word.", body: "Ready is also the word here." };
  const result = resolveEmphasisInstructionField(fields, "Ready is");
  assert.equal(result.field, "body");
});

test("resolveEmphasisInstructionField returns null for a phrase that only matches by spanning the headline/body boundary", () => {
  // Neither field alone contains "is a genuine" — it only exists in the
  // naive concatenation `${headline} ${body}` ("...is a" + " " + "genuine
  // asset..."). This is the exact latent edge case a future render could
  // never coherently draw (it isn't a real span of either field).
  const fields = { headline: "Your appraisal is a", body: "genuine asset worth revisiting." };
  const result = resolveEmphasisInstructionField(fields, "is a genuine");
  assert.equal(result, null);
});

test("validateEmphasisInstructionsAcrossFields accepts a headline-only phrase (the real defect this fix resolves)", () => {
  assert.doesNotThrow(() =>
    validateEmphasisInstructionsAcrossFields({
      slideNumber: 6,
      fields: { headline: "Your appraisal history is a source of future listings.", body: "Not a record of past misses." },
      emphasisInstructions: [{ phrase: "source of future listings", style: "highlight" }],
    })
  );
});

test("validateEmphasisInstructionsAcrossFields still accepts a body-only phrase (existing behaviour preserved)", () => {
  assert.doesNotThrow(() =>
    validateEmphasisInstructionsAcrossFields({
      slideNumber: 5,
      fields: { headline: "Ready vs. Not Ready Yet", body: "The old lens was interested or not. The better lens is ready or not ready yet." },
      emphasisInstructions: [
        { phrase: "interested or not", style: "strike" },
        { phrase: "ready or not ready yet", style: "highlight" },
      ],
    })
  );
});

test("validateEmphasisInstructionsAcrossFields rejects a phrase that only matches the headline/body boundary", () => {
  assert.throws(
    () =>
      validateEmphasisInstructionsAcrossFields({
        slideNumber: 4,
        fields: { headline: "Your appraisal is a", body: "genuine asset worth revisiting." },
        emphasisInstructions: [{ phrase: "is a genuine", style: "highlight" }],
      }),
    EmphasisPhraseNotFoundError
  );
});

test("validateEmphasisInstructionsAcrossFields still rejects a genuinely absent phrase", () => {
  assert.throws(
    () =>
      validateEmphasisInstructionsAcrossFields({
        slideNumber: 3,
        fields: { headline: "Speed Wins New Leads", body: "Agencies that respond within 24 hours convert more." },
        emphasisInstructions: [{ phrase: "not present anywhere", style: "highlight" }],
      }),
    EmphasisPhraseNotFoundError
  );
});

test("validateEmphasisInstructionsAcrossFields throws ConflictingEmphasisInstructionsError for two overlapping instructions in the SAME field", () => {
  assert.throws(
    () =>
      validateEmphasisInstructionsAcrossFields({
        slideNumber: 5,
        fields: { headline: "Ready vs. Not Ready Yet", body: "ready or not ready yet, act now" },
        emphasisInstructions: [
          { phrase: "ready or not ready yet", style: "highlight" },
          { phrase: "not ready yet", style: "strike" },
        ],
      }),
    ConflictingEmphasisInstructionsError
  );
});

test("validateEmphasisInstructionsAcrossFields does NOT conflict when two instructions resolve to DIFFERENT fields, even with matching text", () => {
  // Same word ("ready") appears in both the headline and body, but each
  // instruction resolves to its own field independently — no shared
  // element, so no real visual conflict, and none should be reported.
  assert.doesNotThrow(() =>
    validateEmphasisInstructionsAcrossFields({
      slideNumber: 5,
      fields: { headline: "Ready to talk", body: "Get ready for the next step." },
      emphasisInstructions: [
        { phrase: "Ready to talk", style: "highlight" },
        { phrase: "ready for the next step", style: "highlight" },
      ],
    })
  );
});

test("partitionEmphasisInstructionsByField splits a mixed instruction list by resolved field", () => {
  const fields = { headline: "Your appraisal history is a source of future listings.", body: "Not a record of past misses. Who is ready today?" };
  const { headline, body } = partitionEmphasisInstructionsByField(fields, [
    { phrase: "source of future listings", style: "highlight" },
    { phrase: "ready today", style: "strike" },
  ]);
  assert.deepEqual(headline, [{ phrase: "source of future listings", style: "highlight" }]);
  assert.deepEqual(body, [{ phrase: "ready today", style: "strike" }]);
});

test("partitionEmphasisInstructionsByField returns an empty array per field when there are no instructions", () => {
  const result = partitionEmphasisInstructionsByField({ headline: "H", body: "B" }, []);
  assert.deepEqual(result, { headline: [], body: [] });
});

test("partitionEmphasisInstructionsByField throws defensively for a phrase that resolves to no field (misuse — should never happen for an already-validated package)", () => {
  assert.throws(() =>
    partitionEmphasisInstructionsByField({ headline: "H", body: "B" }, [{ phrase: "not present", style: "highlight" }])
  );
});

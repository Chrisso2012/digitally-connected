// DC-003-I032.10.1 — regression coverage for
// carousel-content-package-emphasis.mjs: pure, dependency-free
// normalisation + substring + overlap checks. No filesystem/store
// involved — carousel-content-package.test.mjs covers this wired
// through the real factory.

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeForEmphasisMatching, validateEmphasisInstructions } from "../../src/carousel-content-package-emphasis.mjs";
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

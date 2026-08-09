import test from "node:test";
import assert from "node:assert/strict";
import {
  assertValidEditorialAnalysisProvider,
  assertValidEditorialAnalysisResult,
  describeArrayFieldShape,
  normalizeEditorialAnalysisArrayFields,
  CANONICAL_ARRAY_OF_STRING_FIELDS,
} from "../../src/editorial-analysis-provider.mjs";
import { InvalidEditorialAnalysisProviderError, MalformedEditorialAnalysisResultError } from "../../src/editorial-analysis-errors.mjs";

test("assertValidEditorialAnalysisProvider() accepts a well-shaped provider", () => {
  assert.doesNotThrow(() => assertValidEditorialAnalysisProvider({ name: "x", analyzeContent: async () => "{}" }));
});

test("assertValidEditorialAnalysisProvider() throws for a missing/malformed provider", () => {
  assert.throws(() => assertValidEditorialAnalysisProvider(null), InvalidEditorialAnalysisProviderError);
  assert.throws(() => assertValidEditorialAnalysisProvider({ name: "x" }), InvalidEditorialAnalysisProviderError);
  assert.throws(() => assertValidEditorialAnalysisProvider({ analyzeContent: async () => "{}" }), InvalidEditorialAnalysisProviderError);
});

const VALID_RESULT = {
  primaryHeadline: "H",
  supportingHeadline: "SH",
  executiveSummary: "ES",
  coreMessage: "CM",
  primaryAudience: "PA",
  primaryProblem: "PP",
  desiredOutcome: "DO",
  keyInsights: ["a"],
  pullQuotes: ["b"],
  callToAction: "CTA",
  keywords: ["k"],
  seoTitle: "ST",
  seoDescription: "SD",
  suggestedHashtags: ["h"],
  editorialThemes: ["t"],
  contentCategories: ["c"],
};

test("assertValidEditorialAnalysisResult() accepts a well-shaped result", () => {
  assert.doesNotThrow(() => assertValidEditorialAnalysisResult(VALID_RESULT));
});

test("assertValidEditorialAnalysisResult() throws for a non-object result", () => {
  assert.throws(() => assertValidEditorialAnalysisResult(null), MalformedEditorialAnalysisResultError);
  assert.throws(() => assertValidEditorialAnalysisResult("a string"), MalformedEditorialAnalysisResultError);
});

for (const field of ["primaryHeadline", "coreMessage", "callToAction", "seoTitle", "seoDescription"]) {
  test(`assertValidEditorialAnalysisResult() throws for a missing/blank ${field}`, () => {
    assert.throws(() => assertValidEditorialAnalysisResult({ ...VALID_RESULT, [field]: "" }), MalformedEditorialAnalysisResultError);
  });
}

for (const field of CANONICAL_ARRAY_OF_STRING_FIELDS) {
  test(`assertValidEditorialAnalysisResult() throws for an empty ${field} array`, () => {
    assert.throws(() => assertValidEditorialAnalysisResult({ ...VALID_RESULT, [field]: [] }), MalformedEditorialAnalysisResultError);
  });

  test(`assertValidEditorialAnalysisResult() reports field:"${field}" on the thrown error`, () => {
    try {
      assertValidEditorialAnalysisResult({ ...VALID_RESULT, [field]: [] });
      assert.fail("expected MalformedEditorialAnalysisResultError");
    } catch (error) {
      assert.equal(error.field, field);
    }
  });
}

test("CANONICAL_ARRAY_OF_STRING_FIELDS names exactly the six array<string> fields", () => {
  assert.deepEqual(CANONICAL_ARRAY_OF_STRING_FIELDS, ["keyInsights", "pullQuotes", "keywords", "suggestedHashtags", "editorialThemes", "contentCategories"]);
});

// --- DC-003-I031.3/I031.5 — describeArrayFieldShape(): safe, content-free
// structural diagnostics only. Every assertion here checks TYPES/LENGTHS/
// BOOLEANS — never asserts on or reproduces actual string content beyond
// what's needed to construct the test input itself. -------------------

test("describeArrayFieldShape(undefined) reports exists:false, isUndefined:true", () => {
  assert.deepEqual(describeArrayFieldShape(undefined), {
    exists: false, isUndefined: true, isNull: false, type: "undefined", isArray: false,
    length: null, itemTypes: null, itemLengths: null, anyZeroLength: null, anyBlankAfterTrim: null,
  });
});

test("describeArrayFieldShape(null) reports exists:true, isNull:true", () => {
  assert.deepEqual(describeArrayFieldShape(null), {
    exists: true, isUndefined: false, isNull: true, type: "object", isArray: false,
    length: null, itemTypes: null, itemLengths: null, anyZeroLength: null, anyBlankAfterTrim: null,
  });
});

for (const [label, value, type] of [
  ["a string", "not an array", "string"],
  ["a number", 42, "number"],
  ["a boolean", true, "boolean"],
  ["a plain object", { a: 1 }, "object"],
]) {
  test(`describeArrayFieldShape() reports isArray:false and the real JS type for ${label}`, () => {
    const result = describeArrayFieldShape(value);
    assert.equal(result.exists, true);
    assert.equal(result.isArray, false);
    assert.equal(result.type, type);
    assert.equal(result.length, null);
  });
}

test("describeArrayFieldShape() reports a fully-valid array correctly", () => {
  const result = describeArrayFieldShape(["one", "two", "three"]);
  assert.equal(result.isArray, true);
  assert.equal(result.length, 3);
  assert.deepEqual(result.itemTypes, ["string", "string", "string"]);
  assert.deepEqual(result.itemLengths, [3, 3, 5]);
  assert.equal(result.anyZeroLength, false);
  assert.equal(result.anyBlankAfterTrim, false);
});

test("describeArrayFieldShape() detects a zero-length string entry", () => {
  const result = describeArrayFieldShape(["real", ""]);
  assert.equal(result.anyZeroLength, true);
  assert.equal(result.anyBlankAfterTrim, true);
  assert.deepEqual(result.itemLengths, [4, 0]);
});

test("describeArrayFieldShape() detects a whitespace-only entry that is NOT zero-length", () => {
  // minLength:1 in the Anthropic tool schema only counts characters, so a
  // single space satisfies it while still failing .trim() !== "".
  const result = describeArrayFieldShape(["real", "   "]);
  assert.equal(result.anyZeroLength, false);
  assert.equal(result.anyBlankAfterTrim, true);
  assert.deepEqual(result.itemLengths, [4, 3]);
});

test("describeArrayFieldShape() detects a non-string item inside an otherwise-array value", () => {
  const result = describeArrayFieldShape(["real", 42, null]);
  assert.deepEqual(result.itemTypes, ["string", "number", "object"]);
  assert.deepEqual(result.itemLengths, [4, null, null]);
  assert.equal(result.anyZeroLength, false);
  assert.equal(result.anyBlankAfterTrim, false);
});

test("describeArrayFieldShape() never includes the actual string content anywhere in its own output shape", () => {
  const result = describeArrayFieldShape(["a secret-looking sentence about the article"]);
  assert.doesNotMatch(JSON.stringify(result), /secret-looking/);
});

// --- DC-003-I031.5 — normalizeEditorialAnalysisArrayFields(): the same
// string -> [string] normalisation applied independently across every
// CANONICAL_ARRAY_OF_STRING_FIELDS entry, generalising I031.4's
// keyInsights-only fix. Regression coverage for all 6 canonical fields:
// (1) arrays pass through unchanged; (2) a valid lone string becomes a
// one-item array with the exact original string; (3) blank/whitespace
// strings remain invalid; (4) malformed non-string/non-array values
// remain invalid; (5) generated text is never altered. -----------------

for (const field of CANONICAL_ARRAY_OF_STRING_FIELDS) {
  test(`normalizeEditorialAnalysisArrayFields() leaves an already-valid ${field} array completely unchanged`, () => {
    const input = { ...VALID_RESULT, [field]: ["one", "two"] };
    const { result, normalizedFields } = normalizeEditorialAnalysisArrayFields(input);
    assert.deepEqual(result[field], ["one", "two"]);
    assert.equal(normalizedFields.includes(field), false);
    assert.doesNotThrow(() => assertValidEditorialAnalysisResult(result));
  });

  test(`normalizeEditorialAnalysisArrayFields() converts a single non-blank ${field} string into a one-item array containing the exact original string`, () => {
    const original = `A real, distinct generated sentence for ${field}.`;
    const input = { ...VALID_RESULT, [field]: original };
    const { result, normalizedFields } = normalizeEditorialAnalysisArrayFields(input);
    assert.deepEqual(result[field], [original]);
    assert.equal(result[field][0], original, "the string must be preserved verbatim, not rewritten");
    assert.deepEqual(normalizedFields, [field]);
    assert.doesNotThrow(() => assertValidEditorialAnalysisResult(result));
  });

  test(`normalizeEditorialAnalysisArrayFields() does NOT normalise a blank/whitespace-only ${field} string — still fails validation`, () => {
    for (const blank of ["", "   ", "\n\t"]) {
      const input = { ...VALID_RESULT, [field]: blank };
      const { result, normalizedFields } = normalizeEditorialAnalysisArrayFields(input);
      assert.equal(result[field], blank, "a blank string must pass through unchanged, never coerced into a valid-looking array");
      assert.equal(normalizedFields.includes(field), false);
      assert.throws(() => assertValidEditorialAnalysisResult(result), MalformedEditorialAnalysisResultError);
    }
  });

  test(`normalizeEditorialAnalysisArrayFields() leaves null/number/object ${field} values unchanged — still rejected by the validator`, () => {
    for (const malformed of [null, 42, true, { note: "not a list" }]) {
      const input = { ...VALID_RESULT, [field]: malformed };
      const { result, normalizedFields } = normalizeEditorialAnalysisArrayFields(input);
      assert.equal(result[field], malformed);
      assert.equal(normalizedFields.includes(field), false);
      assert.throws(() => assertValidEditorialAnalysisResult(result), MalformedEditorialAnalysisResultError);
    }
  });
}

test("normalizeEditorialAnalysisArrayFields() normalises multiple canonical fields independently in one call", () => {
  const input = { ...VALID_RESULT, keyInsights: "A lone insight.", pullQuotes: "A lone quote.", keywords: ["already", "an", "array"] };
  const { result, normalizedFields } = normalizeEditorialAnalysisArrayFields(input);
  assert.deepEqual(result.keyInsights, ["A lone insight."]);
  assert.deepEqual(result.pullQuotes, ["A lone quote."]);
  assert.deepEqual(result.keywords, ["already", "an", "array"]);
  assert.deepEqual(normalizedFields.sort(), ["keyInsights", "pullQuotes"]);
  assert.doesNotThrow(() => assertValidEditorialAnalysisResult(result));
});

test("normalizeEditorialAnalysisArrayFields() never touches a scalar string field even if it looks list-like", () => {
  const input = { ...VALID_RESULT, primaryHeadline: "Not a canonical array field" };
  const { result, normalizedFields } = normalizeEditorialAnalysisArrayFields(input);
  assert.equal(result.primaryHeadline, "Not a canonical array field");
  assert.equal(normalizedFields.includes("primaryHeadline"), false);
});

test("normalizeEditorialAnalysisArrayFields() does not mutate unrelated fields on the result", () => {
  const input = { ...VALID_RESULT, keyInsights: "A lone insight.", primaryHeadline: "Untouched Headline" };
  const { result } = normalizeEditorialAnalysisArrayFields(input);
  assert.equal(result.primaryHeadline, "Untouched Headline");
});

test("normalizeEditorialAnalysisArrayFields() is a no-op when a canonical field is missing entirely", () => {
  const { keyInsights, ...withoutKeyInsights } = VALID_RESULT;
  const { result, normalizedFields } = normalizeEditorialAnalysisArrayFields(withoutKeyInsights);
  assert.equal("keyInsights" in result, false);
  assert.deepEqual(normalizedFields, []);
});

test("normalizeEditorialAnalysisArrayFields() passes through a non-object result unchanged (defense in depth)", () => {
  assert.equal(normalizeEditorialAnalysisArrayFields(null).result, null);
  assert.equal(normalizeEditorialAnalysisArrayFields("a string").result, "a string");
  assert.deepEqual(normalizeEditorialAnalysisArrayFields(["array"]).result, ["array"]);
});

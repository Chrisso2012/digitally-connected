import test from "node:test";
import assert from "node:assert/strict";
import { assertValidEditorialAnalysisProvider, assertValidEditorialAnalysisResult, describeKeyInsightsShape } from "../../src/editorial-analysis-provider.mjs";
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

for (const field of ["keyInsights", "pullQuotes", "keywords", "suggestedHashtags", "editorialThemes", "contentCategories"]) {
  test(`assertValidEditorialAnalysisResult() throws for an empty ${field} array`, () => {
    assert.throws(() => assertValidEditorialAnalysisResult({ ...VALID_RESULT, [field]: [] }), MalformedEditorialAnalysisResultError);
  });
}

// --- DC-003-I031.3 — describeKeyInsightsShape(): safe, content-free
// structural diagnostics only. Every assertion here checks TYPES/LENGTHS/
// BOOLEANS — never asserts on or reproduces actual string content beyond
// what's needed to construct the test input itself. -------------------

test("describeKeyInsightsShape(undefined) reports exists:false, isUndefined:true", () => {
  assert.deepEqual(describeKeyInsightsShape(undefined), {
    exists: false, isUndefined: true, isNull: false, type: "undefined", isArray: false,
    length: null, itemTypes: null, itemLengths: null, anyZeroLength: null, anyBlankAfterTrim: null,
  });
});

test("describeKeyInsightsShape(null) reports exists:true, isNull:true", () => {
  assert.deepEqual(describeKeyInsightsShape(null), {
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
  test(`describeKeyInsightsShape() reports isArray:false and the real JS type for ${label}`, () => {
    const result = describeKeyInsightsShape(value);
    assert.equal(result.exists, true);
    assert.equal(result.isArray, false);
    assert.equal(result.type, type);
    assert.equal(result.length, null);
  });
}

test("describeKeyInsightsShape() reports a fully-valid array correctly", () => {
  const result = describeKeyInsightsShape(["one", "two", "three"]);
  assert.equal(result.isArray, true);
  assert.equal(result.length, 3);
  assert.deepEqual(result.itemTypes, ["string", "string", "string"]);
  assert.deepEqual(result.itemLengths, [3, 3, 5]);
  assert.equal(result.anyZeroLength, false);
  assert.equal(result.anyBlankAfterTrim, false);
});

test("describeKeyInsightsShape() detects a zero-length string entry", () => {
  const result = describeKeyInsightsShape(["real", ""]);
  assert.equal(result.anyZeroLength, true);
  assert.equal(result.anyBlankAfterTrim, true);
  assert.deepEqual(result.itemLengths, [4, 0]);
});

test("describeKeyInsightsShape() detects a whitespace-only entry that is NOT zero-length", () => {
  // The exact discovered live failure mode: minLength:1 in the Anthropic
  // tool schema only counts characters, so a single space satisfies it
  // while still failing .trim() !== "".
  const result = describeKeyInsightsShape(["real", "   "]);
  assert.equal(result.anyZeroLength, false);
  assert.equal(result.anyBlankAfterTrim, true);
  assert.deepEqual(result.itemLengths, [4, 3]);
});

test("describeKeyInsightsShape() detects a non-string item inside an otherwise-array value", () => {
  const result = describeKeyInsightsShape(["real", 42, null]);
  assert.deepEqual(result.itemTypes, ["string", "number", "object"]);
  assert.deepEqual(result.itemLengths, [4, null, null]);
  // Non-string items never counted as "zero length" or "blank" —
  // assertValidEditorialAnalysisResult()'s own isNonEmptyString() already
  // rejects any non-string item on its own, independent of these flags.
  assert.equal(result.anyZeroLength, false);
  assert.equal(result.anyBlankAfterTrim, false);
});

test("describeKeyInsightsShape() never includes the actual string content anywhere in its own output shape", () => {
  const result = describeKeyInsightsShape(["a secret-looking sentence about the article"]);
  assert.doesNotMatch(JSON.stringify(result), /secret-looking/);
});

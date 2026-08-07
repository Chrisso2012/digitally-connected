import test from "node:test";
import assert from "node:assert/strict";
import { assertValidEditorialAnalysisProvider, assertValidEditorialAnalysisResult } from "../../src/editorial-analysis-provider.mjs";
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

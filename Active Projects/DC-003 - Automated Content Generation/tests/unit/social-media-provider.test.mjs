import test from "node:test";
import assert from "node:assert/strict";
import {
  assertValidSocialMediaProvider,
  assertValidSocialMediaResult,
  describeResultFieldShape,
  getResultFieldByPath,
} from "../../src/social-media-provider.mjs";
import { InvalidSocialMediaProviderError, MalformedSocialMediaResultError } from "../../src/social-media-analysis-errors.mjs";

test("assertValidSocialMediaProvider() accepts a well-shaped provider", () => {
  assert.doesNotThrow(() => assertValidSocialMediaProvider({ name: "x", generateSocialMedia: async () => "{}" }));
});

test("assertValidSocialMediaProvider() throws for a missing/malformed provider", () => {
  assert.throws(() => assertValidSocialMediaProvider(null), InvalidSocialMediaProviderError);
  assert.throws(() => assertValidSocialMediaProvider({ name: "x" }), InvalidSocialMediaProviderError);
  assert.throws(() => assertValidSocialMediaProvider({ generateSocialMedia: async () => "{}" }), InvalidSocialMediaProviderError);
});

const VALID_RESULT = {
  hook: "H",
  callToAction: "CTA",
  tone: "T",
  audience: "A",
  platforms: {
    linkedin: { postText: "L", hashtags: ["a"] },
    facebook: { postText: "F", hashtags: ["b"] },
    x: { postText: "X", hashtags: [] },
    instagram: { caption: "I", hashtags: ["c"] },
  },
  carousel: {
    headings: ["1", "2", "3", "4", "5", "6"],
    slideCopy: ["1", "2", "3", "4", "5", "6"],
    imageGuidance: ["1", "2", "3", "4", "5", "6"],
    slides: ["cover", "insight", "statistic", "quote", "takeaway", "cta"].map((slideRole, index) => ({
      slideNumber: index + 1,
      slideRole,
      heading: String(index + 1),
      body: String(index + 1),
      imageGuidance: String(index + 1),
      statistic: slideRole === "statistic" ? { value: "50%", context: "context" } : null,
      quote: slideRole === "quote" ? { quoteText: "a real quote" } : null,
      keyPoints: slideRole === "takeaway" ? ["point one"] : [],
    })),
  },
};

test("assertValidSocialMediaResult() accepts a well-shaped result", () => {
  assert.doesNotThrow(() => assertValidSocialMediaResult(VALID_RESULT));
});

test("assertValidSocialMediaResult() throws for a non-object result", () => {
  assert.throws(() => assertValidSocialMediaResult(null), MalformedSocialMediaResultError);
  assert.throws(() => assertValidSocialMediaResult("a string"), MalformedSocialMediaResultError);
  assert.throws(() => assertValidSocialMediaResult(["array"]), MalformedSocialMediaResultError);
});

for (const field of ["hook", "callToAction", "tone", "audience"]) {
  test(`assertValidSocialMediaResult() throws for a missing/blank ${field}`, () => {
    assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, [field]: "" }), MalformedSocialMediaResultError);
  });
}

test("assertValidSocialMediaResult() throws when platforms is missing", () => {
  const { platforms, ...rest } = VALID_RESULT;
  assert.throws(() => assertValidSocialMediaResult(rest), MalformedSocialMediaResultError);
});

for (const platform of ["linkedin", "facebook", "x"]) {
  test(`assertValidSocialMediaResult() throws when platforms.${platform} is missing`, () => {
    const platforms = { ...VALID_RESULT.platforms };
    delete platforms[platform];
    assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, platforms }), MalformedSocialMediaResultError);
  });
  test(`assertValidSocialMediaResult() throws when platforms.${platform}.postText is blank`, () => {
    const platforms = { ...VALID_RESULT.platforms, [platform]: { ...VALID_RESULT.platforms[platform], postText: "" } };
    assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, platforms }), MalformedSocialMediaResultError);
  });
  test(`assertValidSocialMediaResult() throws when platforms.${platform}.hashtags contains a non-string`, () => {
    const platforms = { ...VALID_RESULT.platforms, [platform]: { ...VALID_RESULT.platforms[platform], hashtags: [1] } };
    assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, platforms }), MalformedSocialMediaResultError);
  });
}

test("assertValidSocialMediaResult() throws when platforms.instagram.caption is blank", () => {
  const platforms = { ...VALID_RESULT.platforms, instagram: { ...VALID_RESULT.platforms.instagram, caption: "" } };
  assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, platforms }), MalformedSocialMediaResultError);
});

test("assertValidSocialMediaResult() throws when carousel is missing", () => {
  const { carousel, ...rest } = VALID_RESULT;
  assert.throws(() => assertValidSocialMediaResult(rest), MalformedSocialMediaResultError);
});

for (const field of ["headings", "slideCopy", "imageGuidance"]) {
  test(`assertValidSocialMediaResult() throws when carousel.${field} does not have exactly 6 entries`, () => {
    const carousel = { ...VALID_RESULT.carousel, [field]: ["1", "2"] };
    assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel }), MalformedSocialMediaResultError);
  });
}

test("assertValidSocialMediaResult() returns the result unchanged when valid", () => {
  assert.equal(assertValidSocialMediaResult(VALID_RESULT), VALID_RESULT);
});

// --- DC-003-I032.1 — carousel.slides validation ------------------------

test("assertValidSocialMediaResult() throws when carousel.slides does not have exactly 6 entries", () => {
  const carousel = { ...VALID_RESULT.carousel, slides: VALID_RESULT.carousel.slides.slice(0, 5) };
  assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel }), MalformedSocialMediaResultError);
});

test("assertValidSocialMediaResult() throws when a slide's slideNumber is out of position", () => {
  const slides = VALID_RESULT.carousel.slides.map((s, i) => (i === 2 ? { ...s, slideNumber: 9 } : s));
  assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }), MalformedSocialMediaResultError);
});

test("assertValidSocialMediaResult() throws when a slide's slideRole deviates from the fixed positional order", () => {
  const slides = VALID_RESULT.carousel.slides.map((s, i) => (i === 2 ? { ...s, slideRole: "quote" } : s));
  assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }), MalformedSocialMediaResultError);
});

for (const field of ["heading", "body", "imageGuidance"]) {
  test(`assertValidSocialMediaResult() throws when a slide's ${field} is blank`, () => {
    const slides = VALID_RESULT.carousel.slides.map((s, i) => (i === 0 ? { ...s, [field]: "" } : s));
    assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }), MalformedSocialMediaResultError);
  });
}

test("assertValidSocialMediaResult() accepts statistic: null on the statistic slide (honest no-evidence fallback)", () => {
  const slides = VALID_RESULT.carousel.slides.map((s) => (s.slideRole === "statistic" ? { ...s, statistic: null } : s));
  assert.doesNotThrow(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }));
});

test("assertValidSocialMediaResult() throws when statistic is a malformed non-null object (missing context)", () => {
  const slides = VALID_RESULT.carousel.slides.map((s) => (s.slideRole === "statistic" ? { ...s, statistic: { value: "50%" } } : s));
  assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }), MalformedSocialMediaResultError);
});

test("assertValidSocialMediaResult() accepts quote: null on the quote slide (honest no-evidence fallback)", () => {
  const slides = VALID_RESULT.carousel.slides.map((s) => (s.slideRole === "quote" ? { ...s, quote: null } : s));
  assert.doesNotThrow(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }));
});

test("assertValidSocialMediaResult() throws when quote is a malformed non-null object (missing quoteText)", () => {
  const slides = VALID_RESULT.carousel.slides.map((s) => (s.slideRole === "quote" ? { ...s, quote: {} } : s));
  assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }), MalformedSocialMediaResultError);
});

test("assertValidSocialMediaResult() throws when keyPoints has more than 4 entries", () => {
  const slides = VALID_RESULT.carousel.slides.map((s) => (s.slideRole === "takeaway" ? { ...s, keyPoints: ["1", "2", "3", "4", "5"] } : s));
  assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }), MalformedSocialMediaResultError);
});

test("assertValidSocialMediaResult() accepts an empty keyPoints array", () => {
  const slides = VALID_RESULT.carousel.slides.map((s) => (s.slideRole === "takeaway" ? { ...s, keyPoints: [] } : s));
  assert.doesNotThrow(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }));
});

// --- DC-003-I032.3 — field-scoped diagnostics ---------------------------
// Every MalformedSocialMediaResultError now names exactly which field it
// rejected (mirrors MalformedEditorialAnalysisResultError's own `field`
// param from I031.3/I031.5), so a caller can attach safe structural
// diagnostics without guessing. Covers, at minimum, the exact live
// failure this milestone exists to diagnose: a whole-object field
// ("carousel") missing entirely.

test('assertValidSocialMediaResult() reports field:"carousel" when carousel is missing entirely', () => {
  const { carousel, ...rest } = VALID_RESULT;
  try {
    assertValidSocialMediaResult(rest);
    assert.fail("expected MalformedSocialMediaResultError");
  } catch (error) {
    assert.equal(error.field, "carousel");
  }
});

test('assertValidSocialMediaResult() reports field:null for a whole-result shape failure', () => {
  try {
    assertValidSocialMediaResult(null);
    assert.fail("expected MalformedSocialMediaResultError");
  } catch (error) {
    assert.equal(error.field, null);
  }
});

for (const field of ["hook", "callToAction", "tone", "audience"]) {
  test(`assertValidSocialMediaResult() reports field:"${field}" when it is blank`, () => {
    try {
      assertValidSocialMediaResult({ ...VALID_RESULT, [field]: "" });
      assert.fail("expected MalformedSocialMediaResultError");
    } catch (error) {
      assert.equal(error.field, field);
    }
  });
}

test('assertValidSocialMediaResult() reports field:"platforms" when platforms is missing', () => {
  const { platforms, ...rest } = VALID_RESULT;
  try {
    assertValidSocialMediaResult(rest);
    assert.fail("expected MalformedSocialMediaResultError");
  } catch (error) {
    assert.equal(error.field, "platforms");
  }
});

test('assertValidSocialMediaResult() reports field:"platforms.instagram.caption" when it is blank', () => {
  const platforms = { ...VALID_RESULT.platforms, instagram: { ...VALID_RESULT.platforms.instagram, caption: "" } };
  try {
    assertValidSocialMediaResult({ ...VALID_RESULT, platforms });
    assert.fail("expected MalformedSocialMediaResultError");
  } catch (error) {
    assert.equal(error.field, "platforms.instagram.caption");
  }
});

for (const field of ["headings", "slideCopy", "imageGuidance"]) {
  test(`assertValidSocialMediaResult() reports field:"carousel.${field}" when it does not have exactly 6 entries`, () => {
    const carousel = { ...VALID_RESULT.carousel, [field]: ["1", "2"] };
    try {
      assertValidSocialMediaResult({ ...VALID_RESULT, carousel });
      assert.fail("expected MalformedSocialMediaResultError");
    } catch (error) {
      assert.equal(error.field, `carousel.${field}`);
    }
  });
}

test('assertValidSocialMediaResult() reports field:"carousel.slides[2].heading" for a blank heading on slide index 2', () => {
  const slides = VALID_RESULT.carousel.slides.map((s, i) => (i === 2 ? { ...s, heading: "" } : s));
  try {
    assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } });
    assert.fail("expected MalformedSocialMediaResultError");
  } catch (error) {
    assert.equal(error.field, "carousel.slides[2].heading");
  }
});

test('assertValidSocialMediaResult() reports field:"carousel.slides[3].statistic" for a malformed statistic', () => {
  const slides = VALID_RESULT.carousel.slides.map((s, i) => (i === 3 ? { ...s, statistic: { value: "x" } } : s));
  try {
    assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } });
    assert.fail("expected MalformedSocialMediaResultError");
  } catch (error) {
    assert.equal(error.field, "carousel.slides[3].statistic");
  }
});

// --- DC-003-I032.3 — describeResultFieldShape(): safe, content-free
// structural diagnostics for any Social Media Result field (generalises
// I031's own array<string>-only describeArrayFieldShape() to carousel's
// richer nested-object/array-of-objects shape). Every assertion here
// checks TYPES/LENGTHS/KEY NAMES only — never actual string/object
// content. -----------------------------------------------------------

test("describeResultFieldShape(undefined) reports exists:false", () => {
  assert.deepEqual(describeResultFieldShape(undefined), {
    exists: false, isNull: false, type: "undefined", isArray: false, isPlainObject: false, length: null, itemTypes: null, keys: null,
  });
});

test("describeResultFieldShape(null) reports exists:true, isNull:true", () => {
  assert.deepEqual(describeResultFieldShape(null), {
    exists: true, isNull: true, type: "object", isArray: false, isPlainObject: false, length: null, itemTypes: null, keys: null,
  });
});

test("describeResultFieldShape() reports a plain object's own top-level key NAMES, never its values", () => {
  const result = describeResultFieldShape({ headings: ["secret content here"], slideCopy: [], imageGuidance: [], slides: [] });
  assert.equal(result.isPlainObject, true);
  assert.deepEqual(result.keys, ["headings", "slideCopy", "imageGuidance", "slides"]);
  assert.doesNotMatch(JSON.stringify(result), /secret content/);
});

test("describeResultFieldShape() reports an array's length and per-item types", () => {
  const result = describeResultFieldShape([{ a: 1 }, "x", 42, null]);
  assert.equal(result.isArray, true);
  assert.equal(result.length, 4);
  assert.deepEqual(result.itemTypes, ["object", "string", "number", "null"]);
});

for (const [label, value, type] of [
  ["a string", "carousel arrived as a plain string", "string"],
  ["a number", 42, "number"],
  ["a boolean", false, "boolean"],
]) {
  test(`describeResultFieldShape() reports the real JS type for ${label}`, () => {
    const result = describeResultFieldShape(value);
    assert.equal(result.exists, true);
    assert.equal(result.isArray, false);
    assert.equal(result.isPlainObject, false);
    assert.equal(result.type, type);
  });
}

test("describeResultFieldShape() never includes actual string content anywhere in its own output", () => {
  const result = describeResultFieldShape("a secret-looking sentence about the article");
  assert.doesNotMatch(JSON.stringify(result), /secret-looking/);
});

// --- DC-003-I032.3 — getResultFieldByPath(): resolves one of this
// module's own field paths (dot-separated keys, `[n]` array indices)
// against a real result, so a caller can describe the shape of exactly
// the value that failed. -------------------------------------------

test("getResultFieldByPath() resolves a top-level field", () => {
  assert.equal(getResultFieldByPath(VALID_RESULT, "carousel"), VALID_RESULT.carousel);
});

test("getResultFieldByPath() resolves a nested dotted field", () => {
  assert.equal(getResultFieldByPath(VALID_RESULT, "platforms.instagram.caption"), VALID_RESULT.platforms.instagram.caption);
});

test("getResultFieldByPath() resolves an array-indexed path", () => {
  assert.equal(getResultFieldByPath(VALID_RESULT, "carousel.slides[2].slideRole"), "statistic");
});

test("getResultFieldByPath() returns the whole result for a null/empty path", () => {
  assert.equal(getResultFieldByPath(VALID_RESULT, null), VALID_RESULT);
});

test("getResultFieldByPath() returns undefined for an unresolvable intermediate, never throws", () => {
  const { carousel, ...rest } = VALID_RESULT;
  assert.equal(getResultFieldByPath(rest, "carousel.slides[2].slideRole"), undefined);
  assert.doesNotThrow(() => getResultFieldByPath(rest, "carousel.slides[2].slideRole"));
});

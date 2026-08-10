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
  industryContext: null,
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

// --- DC-003-I032.6 — position 4 is evidence-aware: "quote" (genuinely
// attributable evidence) or "evidence" (source-grounded, no attribution
// claimed) — never anything else, and a quote object may never
// accompany any role but "quote". This is the direct regression coverage
// for the rejected carousel (car_3479ca8ac2af40b8): a fabricated
// "Operations Lead" attribution must be structurally impossible through
// this contract regardless of what any provider tries to submit.

test('assertValidSocialMediaResult() accepts slideRole:"evidence" at position 4 with quote: null — the honest fallback', () => {
  const slides = VALID_RESULT.carousel.slides.map((s, i) => (i === 3 ? { ...s, slideRole: "evidence", quote: null } : s));
  assert.doesNotThrow(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }));
});

test('assertValidSocialMediaResult() still accepts slideRole:"quote" at position 4 with a real quote object — genuinely attributable evidence remains supported', () => {
  // VALID_RESULT's own position-4 slide is already role "quote" with a
  // real quote object — this asserts that baseline stays valid unchanged.
  assert.doesNotThrow(() => assertValidSocialMediaResult(VALID_RESULT));
  assert.equal(VALID_RESULT.carousel.slides[3].slideRole, "quote");
  assert.notEqual(VALID_RESULT.carousel.slides[3].quote, null);
});

test('assertValidSocialMediaResult() throws when position 4\'s slideRole is anything other than "quote" or "evidence"', () => {
  const slides = VALID_RESULT.carousel.slides.map((s, i) => (i === 3 ? { ...s, slideRole: "insight", quote: null } : s));
  try {
    assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } });
    assert.fail("expected MalformedSocialMediaResultError");
  } catch (error) {
    assert.ok(error instanceof MalformedSocialMediaResultError);
    assert.equal(error.field, "carousel.slides[3].slideRole");
  }
});

test('assertValidSocialMediaResult() throws when a quote object accompanies slideRole:"evidence" — a fabricated-looking quote may never be smuggled in under a different label', () => {
  const slides = VALID_RESULT.carousel.slides.map((s, i) =>
    i === 3 ? { ...s, slideRole: "evidence", quote: { quoteText: "A real-sounding line presented as if it were external testimony." } } : s
  );
  try {
    assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } });
    assert.fail("expected MalformedSocialMediaResultError");
  } catch (error) {
    assert.ok(error instanceof MalformedSocialMediaResultError);
    assert.equal(error.field, "carousel.slides[3].quote");
  }
});

test('assertValidSocialMediaResult() throws when a quote object accompanies any non-"quote" role, not only "evidence" — the cross-check applies everywhere', () => {
  const slides = VALID_RESULT.carousel.slides.map((s, i) => (i === 0 ? { ...s, quote: { quoteText: "Smuggled onto the cover slide." } } : s));
  assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides } }), MalformedSocialMediaResultError);
});

test("assertValidSocialMediaResult() still requires exactly 6 slides regardless of which role position 4 uses — the sixth slide is never removed", () => {
  const evidenceSlides = VALID_RESULT.carousel.slides.map((s, i) => (i === 3 ? { ...s, slideRole: "evidence", quote: null } : s));
  assert.equal(evidenceSlides.length, 6);
  assert.doesNotThrow(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides: evidenceSlides } }));
  const truncated = evidenceSlides.slice(0, 5);
  assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, carousel: { ...VALID_RESULT.carousel, slides: truncated } }), MalformedSocialMediaResultError);
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

// --- DC-003-I031.8 — industryContext: an honest evidence container,
// mirroring statistic/quote's own null-or-real pattern. Proves: (1) null
// is accepted — a genuinely general-audience article is never falsely
// assigned an industry; (2) any genuine, non-real-estate industry string
// is accepted just as validly — the contract is generic, not hardcoded
// to any one sector; (3) a blank/wrong-typed value is still rejected.

test("assertValidSocialMediaResult() accepts industryContext: null (no specific industry clearly supported)", () => {
  assert.doesNotThrow(() => assertValidSocialMediaResult({ ...VALID_RESULT, industryContext: null }));
});

test("assertValidSocialMediaResult() accepts a genuine, non-real-estate industryContext string — the contract is generic", () => {
  const boutiqueFitness = { ...VALID_RESULT, industryContext: "Boutique fitness studios and independent personal trainers" };
  assert.doesNotThrow(() => assertValidSocialMediaResult(boutiqueFitness));
  const healthcare = { ...VALID_RESULT, industryContext: "Allied health clinics managing patient rebooking" };
  assert.doesNotThrow(() => assertValidSocialMediaResult(healthcare));
});

test('assertValidSocialMediaResult() reports field:"industryContext" and rejects a blank string', () => {
  try {
    assertValidSocialMediaResult({ ...VALID_RESULT, industryContext: "" });
    assert.fail("expected MalformedSocialMediaResultError");
  } catch (error) {
    assert.equal(error.field, "industryContext");
  }
});

test("assertValidSocialMediaResult() rejects a non-string, non-null industryContext (e.g. a number)", () => {
  assert.throws(() => assertValidSocialMediaResult({ ...VALID_RESULT, industryContext: 42 }), MalformedSocialMediaResultError);
});

import test from "node:test";
import assert from "node:assert/strict";
import { assertValidSocialMediaProvider, assertValidSocialMediaResult } from "../../src/social-media-provider.mjs";
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

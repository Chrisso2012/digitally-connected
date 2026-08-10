import test from "node:test";
import assert from "node:assert/strict";
import { createSocialMediaPackage } from "../../src/social-media-package.mjs";
import { InvalidSocialMediaPackageInputError, SocialMediaPackageValidationError } from "../../src/social-media-package-errors.mjs";

function buildFields(overrides = {}) {
  return {
    editorialPackageId: "ep_a1b2c3d4e5f60708",
    hook: "The hook.",
    callToAction: "Do the thing.",
    tone: "professional and confident",
    audience: "The audience.",
    platforms: {
      linkedin: { postText: "LinkedIn post text.", hashtags: ["one"] },
      facebook: { postText: "Facebook post text.", hashtags: ["two"] },
      x: { postText: "X post text.", hashtags: [] },
      instagram: { caption: "Instagram caption.", hashtags: ["three"] },
    },
    carousel: {
      headings: ["H1", "H2", "H3", "H4", "H5", "H6"],
      slideCopy: ["S1", "S2", "S3", "S4", "S5", "S6"],
      imageGuidance: ["G1", "G2", "G3", "G4", "G5", "G6"],
      slides: ["cover", "insight", "statistic", "quote", "takeaway", "cta"].map((slideRole, index) => ({
        slideNumber: index + 1,
        slideRole,
        heading: `H${index + 1}`,
        body: `S${index + 1}`,
        imageGuidance: `G${index + 1}`,
        statistic: slideRole === "statistic" ? { value: "50%", context: "S3" } : null,
        quote: slideRole === "quote" ? { quoteText: "S4" } : null,
        keyPoints: slideRole === "takeaway" ? ["S5"] : [],
      })),
    },
    llmModel: "mock-social-media-provider-v1",
    promptVersion: "social-media-package.v1",
    schemaVersion: "1.0",
    ...overrides,
  };
}

test("createSocialMediaPackage() builds a valid, immutable record with computed checksum and character counts", () => {
  const record = createSocialMediaPackage(buildFields(), { idGenerator: () => "sm_test00000000001", now: () => "2026-08-07T11:00:00.000Z" });
  assert.equal(record.social_media_package_id, "sm_test00000000001");
  assert.equal(record.editorial_package_id, "ep_a1b2c3d4e5f60708");
  assert.equal(record.status, "generated");
  assert.equal(record.hook, "The hook.");
  assert.equal(record.generated_at, "2026-08-07T11:00:00.000Z");
  assert.equal(record.platforms.linkedin.character_count, "LinkedIn post text.".length);
  assert.equal(record.platforms.facebook.character_count, "Facebook post text.".length);
  assert.equal(record.platforms.x.character_count, "X post text.".length);
  assert.equal(record.platforms.instagram.character_count, "Instagram caption.".length);
  assert.deepEqual(record.carousel.headings, ["H1", "H2", "H3", "H4", "H5", "H6"]);
  assert.deepEqual(record.carousel.slide_copy, ["S1", "S2", "S3", "S4", "S5", "S6"]);
  assert.deepEqual(record.carousel.image_guidance, ["G1", "G2", "G3", "G4", "G5", "G6"]);
  assert.equal(record.metadata, null);
  assert.match(record.checksum, /^[a-f0-9]{64}$/);
  assert.throws(() => {
    record.hook = "changed";
  }, TypeError);
});

test("checksum reflects the record's own content", () => {
  const a = createSocialMediaPackage(buildFields({ hook: "A" }), { idGenerator: () => "sm_aaaaaaaaaaaaaaaa" });
  const b = createSocialMediaPackage(buildFields({ hook: "B" }), { idGenerator: () => "sm_bbbbbbbbbbbbbbbb" });
  assert.notEqual(a.checksum, b.checksum);
});

test("accepts an object metadata value", () => {
  const record = createSocialMediaPackage(buildFields({ metadata: { note: "ok" } }));
  assert.deepEqual(record.metadata, { note: "ok" });
});

test("throws InvalidSocialMediaPackageInputError for a malformed editorialPackageId", () => {
  assert.throws(() => createSocialMediaPackage(buildFields({ editorialPackageId: "not-valid" })), InvalidSocialMediaPackageInputError);
});

for (const field of ["hook", "callToAction", "tone", "audience", "llmModel", "promptVersion", "schemaVersion"]) {
  test(`throws InvalidSocialMediaPackageInputError for a missing ${field}`, () => {
    assert.throws(() => createSocialMediaPackage(buildFields({ [field]: "" })), InvalidSocialMediaPackageInputError);
  });
}

for (const platform of ["linkedin", "facebook", "x"]) {
  test(`throws InvalidSocialMediaPackageInputError when platforms.${platform} is missing`, () => {
    const fields = buildFields();
    delete fields.platforms[platform];
    assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
  });
  test(`throws InvalidSocialMediaPackageInputError when platforms.${platform}.postText is blank`, () => {
    const fields = buildFields();
    fields.platforms[platform] = { ...fields.platforms[platform], postText: "" };
    assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
  });
  test(`throws InvalidSocialMediaPackageInputError when platforms.${platform}.hashtags contains a non-string`, () => {
    const fields = buildFields();
    fields.platforms[platform] = { ...fields.platforms[platform], hashtags: [1] };
    assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
  });
}

test("throws InvalidSocialMediaPackageInputError when platforms.instagram.caption is blank", () => {
  const fields = buildFields();
  fields.platforms.instagram = { ...fields.platforms.instagram, caption: "" };
  assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
});

for (const field of ["headings", "slideCopy", "imageGuidance"]) {
  test(`throws InvalidSocialMediaPackageInputError when carousel.${field} has fewer than 6 entries`, () => {
    const fields = buildFields();
    fields.carousel[field] = fields.carousel[field].slice(0, 5);
    assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
  });
  test(`throws InvalidSocialMediaPackageInputError when carousel.${field} has more than 6 entries`, () => {
    const fields = buildFields();
    fields.carousel[field] = [...fields.carousel[field], "extra"];
    assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
  });
  test(`throws InvalidSocialMediaPackageInputError when carousel.${field} is not an array`, () => {
    assert.throws(() => createSocialMediaPackage(buildFields({ carousel: { ...buildFields().carousel, [field]: "not-an-array" } })), InvalidSocialMediaPackageInputError);
  });
}

test("throws InvalidSocialMediaPackageInputError when metadata is a non-object, non-null value", () => {
  assert.throws(() => createSocialMediaPackage(buildFields({ metadata: "not-an-object" })), InvalidSocialMediaPackageInputError);
});

test("throws SocialMediaPackageValidationError when the assembled record still fails schema validation", () => {
  const fakeValidator = { validate: () => ({ valid: false, errors: [{ path: "(root)", message: "forced failure" }] }) };
  assert.throws(() => createSocialMediaPackage(buildFields(), { validator: fakeValidator }), SocialMediaPackageValidationError);
});

// --- DC-003-I032.1 — carousel.slides persistence -----------------------

test("persists carousel.slides with snake_case keys, statistic/quote/key_points preserved verbatim", () => {
  const record = createSocialMediaPackage(buildFields());
  assert.equal(record.carousel.slides.length, 6);
  const statisticSlide = record.carousel.slides.find((s) => s.slide_role === "statistic");
  assert.deepEqual(statisticSlide.statistic, { value: "50%", context: "S3" });
  const quoteSlide = record.carousel.slides.find((s) => s.slide_role === "quote");
  assert.deepEqual(quoteSlide.quote, { quote_text: "S4" });
  const takeawaySlide = record.carousel.slides.find((s) => s.slide_role === "takeaway");
  assert.deepEqual(takeawaySlide.key_points, ["S5"]);
  const coverSlide = record.carousel.slides.find((s) => s.slide_role === "cover");
  assert.equal(coverSlide.statistic, null);
  assert.equal(coverSlide.quote, null);
  assert.deepEqual(coverSlide.key_points, []);
});

test("throws InvalidSocialMediaPackageInputError when carousel.slides has fewer than 6 entries", () => {
  const fields = buildFields();
  fields.carousel.slides = fields.carousel.slides.slice(0, 5);
  assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
});

test("throws InvalidSocialMediaPackageInputError when a slide's slideRole is out of the fixed positional order", () => {
  const fields = buildFields();
  fields.carousel.slides[2] = { ...fields.carousel.slides[2], slideRole: "quote" };
  assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
});

test("throws InvalidSocialMediaPackageInputError when a slide's heading is blank", () => {
  const fields = buildFields();
  fields.carousel.slides[0] = { ...fields.carousel.slides[0], heading: "" };
  assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
});

test("throws InvalidSocialMediaPackageInputError when statistic is a malformed non-null object", () => {
  const fields = buildFields();
  const index = fields.carousel.slides.findIndex((s) => s.slideRole === "statistic");
  fields.carousel.slides[index] = { ...fields.carousel.slides[index], statistic: { value: "50%" } };
  assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
});

test("throws InvalidSocialMediaPackageInputError when quote is a malformed non-null object", () => {
  const fields = buildFields();
  const index = fields.carousel.slides.findIndex((s) => s.slideRole === "quote");
  fields.carousel.slides[index] = { ...fields.carousel.slides[index], quote: {} };
  assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
});

test("throws InvalidSocialMediaPackageInputError when keyPoints has more than 4 entries", () => {
  const fields = buildFields();
  const index = fields.carousel.slides.findIndex((s) => s.slideRole === "takeaway");
  fields.carousel.slides[index] = { ...fields.carousel.slides[index], keyPoints: ["1", "2", "3", "4", "5"] };
  assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
});

test("accepts statistic: null and quote: null (honest no-evidence fallback) on their respective slides", () => {
  const fields = buildFields();
  const statisticIndex = fields.carousel.slides.findIndex((s) => s.slideRole === "statistic");
  const quoteIndex = fields.carousel.slides.findIndex((s) => s.slideRole === "quote");
  fields.carousel.slides[statisticIndex] = { ...fields.carousel.slides[statisticIndex], statistic: null };
  fields.carousel.slides[quoteIndex] = { ...fields.carousel.slides[quoteIndex], quote: null };
  const record = createSocialMediaPackage(fields);
  assert.equal(record.carousel.slides[statisticIndex].statistic, null);
  assert.equal(record.carousel.slides[quoteIndex].quote, null);
});

// --- DC-003-I031.8 — industryContext: an honest evidence container,
// mirroring statistic/quote's own null-or-real pattern at the domain
// object layer too. --------------------------------------------------

test("industryContext defaults to null when omitted entirely — every existing buildFields()-based test above is unaffected", () => {
  const record = createSocialMediaPackage(buildFields());
  assert.equal(record.industry_context, null);
});

test("accepts an explicit industryContext: null", () => {
  const record = createSocialMediaPackage(buildFields({ industryContext: null }));
  assert.equal(record.industry_context, null);
});

test("persists a genuine, non-real-estate industryContext string verbatim as industry_context — the contract is generic", () => {
  const record = createSocialMediaPackage(buildFields({ industryContext: "Independent veterinary clinics managing appointment no-shows" }));
  assert.equal(record.industry_context, "Independent veterinary clinics managing appointment no-shows");
});

test("throws InvalidSocialMediaPackageInputError for a blank-string industryContext", () => {
  assert.throws(() => createSocialMediaPackage(buildFields({ industryContext: "" })), InvalidSocialMediaPackageInputError);
});

// --- DC-003-I032.6 — position 4 evidence-aware role, at the domain
// object layer. Direct regression coverage for car_3479ca8ac2af40b8's
// fabricated attribution: a quote object may never accompany any role
// but "quote", enforced here too (not only in the provider-facing
// validator), and the six-slide structure is preserved either way.

test('accepts slideRole:"evidence" at position 4 with quote: null — the honest fallback', () => {
  const fields = buildFields();
  const index = fields.carousel.slides.findIndex((s) => s.slideRole === "quote");
  fields.carousel.slides[index] = { ...fields.carousel.slides[index], slideRole: "evidence", quote: null };
  const record = createSocialMediaPackage(fields);
  assert.equal(record.carousel.slides[index].slide_role, "evidence");
  assert.equal(record.carousel.slides[index].quote, null);
});

test('still accepts slideRole:"quote" at position 4 with a real quote object — genuinely attributable evidence remains supported', () => {
  const record = createSocialMediaPackage(buildFields());
  const index = record.carousel.slides.findIndex((s) => s.slide_role === "quote");
  assert.notEqual(index, -1);
  assert.notEqual(record.carousel.slides[index].quote, null);
});

test('throws when position 4\'s slideRole is anything other than "quote" or "evidence"', () => {
  const fields = buildFields();
  const index = fields.carousel.slides.findIndex((s) => s.slideRole === "quote");
  fields.carousel.slides[index] = { ...fields.carousel.slides[index], slideRole: "insight", quote: null };
  assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
});

test('throws when a quote object accompanies slideRole:"evidence" — a fabricated-looking quote may never be smuggled in under a different label', () => {
  const fields = buildFields();
  const index = fields.carousel.slides.findIndex((s) => s.slideRole === "quote");
  fields.carousel.slides[index] = {
    ...fields.carousel.slides[index],
    slideRole: "evidence",
    quote: { quoteText: "A real-sounding line presented as if it were external testimony." },
  };
  assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
});

test('throws when a quote object accompanies any non-"quote" role, not only "evidence"', () => {
  const fields = buildFields();
  fields.carousel.slides[0] = { ...fields.carousel.slides[0], quote: { quoteText: "Smuggled onto the cover slide." } };
  assert.throws(() => createSocialMediaPackage(fields), InvalidSocialMediaPackageInputError);
});

test("six-slide structure is preserved regardless of which role position 4 uses — the sixth slide is never removed", () => {
  const fields = buildFields();
  const index = fields.carousel.slides.findIndex((s) => s.slideRole === "quote");
  fields.carousel.slides[index] = { ...fields.carousel.slides[index], slideRole: "evidence", quote: null };
  const record = createSocialMediaPackage(fields);
  assert.equal(record.carousel.slides.length, 6);
  assert.equal(record.carousel.slides[5].slide_role, "cta");
});

// --- DC-003-I032.8 — revision/supersedes lineage fields, at the domain
// object layer. Ordinary callers (generateSocialMediaPackage()) never
// pass either field — only reviseSocialMediaPackage() does — so the
// default shape (revision: 1, supersedes: null) must be exactly what
// every pre-existing buildFields()-based test above already produces.

test("revision defaults to 1 and supersedes defaults to null when both are omitted", () => {
  const record = createSocialMediaPackage(buildFields());
  assert.equal(record.revision, 1);
  assert.equal(record.supersedes, null);
});

test("accepts an explicit revision > 1 paired with a matching supersedes id", () => {
  const record = createSocialMediaPackage(buildFields({ revision: 2, supersedes: "sm_previousrevision1" }));
  assert.equal(record.revision, 2);
  assert.equal(record.supersedes, "sm_previousrevision1");
});

test("throws InvalidSocialMediaPackageInputError when revision is not a positive integer", () => {
  for (const badRevision of [0, -1, 1.5, "1", null]) {
    assert.throws(() => createSocialMediaPackage(buildFields({ revision: badRevision, supersedes: "sm_previousrevision1" })), InvalidSocialMediaPackageInputError);
  }
});

test("throws InvalidSocialMediaPackageInputError when supersedes is neither null nor a valid sm_... id", () => {
  for (const badSupersedes of ["not-an-id", "ep_wrongprefix00001", 123]) {
    assert.throws(() => createSocialMediaPackage(buildFields({ revision: 2, supersedes: badSupersedes })), InvalidSocialMediaPackageInputError);
  }
});

test("throws InvalidSocialMediaPackageInputError when revision is 1 but supersedes is non-null — V1 can never supersede anything", () => {
  assert.throws(() => createSocialMediaPackage(buildFields({ revision: 1, supersedes: "sm_shouldnotbehere001" })), InvalidSocialMediaPackageInputError);
});

test("throws InvalidSocialMediaPackageInputError when revision is greater than 1 but supersedes is null — every revision beyond V1 must name what it supersedes", () => {
  assert.throws(() => createSocialMediaPackage(buildFields({ revision: 2, supersedes: null })), InvalidSocialMediaPackageInputError);
});

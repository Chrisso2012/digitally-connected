import test from "node:test";
import assert from "node:assert/strict";
import { createProductionPackage } from "../../src/production-package.mjs";
import { InvalidProductionPackageInputError, ProductionPackageValidationError } from "../../src/production-package-errors.mjs";

const SLIDE_ROLES = ["cover", "insight", "statistic", "quote", "takeaway", "cta"];

function buildSlide(overrides = {}) {
  return {
    slideNumber: 1,
    slideRole: "cover",
    headlineMapping: "Headline.",
    bodyCopyMapping: "Body copy.",
    ctaMapping: null,
    imageGuidanceMapping: "Guidance.",
    placeholderTagMapping: { headline: "Headline.", body: "Body copy.", cta: null, image_guidance: "Guidance." },
    structuredContent: { statistic: null, quote: null, keyPoints: [] },
    ...overrides,
  };
}

function buildSlideSequence() {
  const slides = [];
  for (let i = 1; i <= 5; i += 1) {
    slides.push(
      buildSlide({
        slideNumber: i,
        slideRole: SLIDE_ROLES[i - 1],
        headlineMapping: `Headline ${i}.`,
        bodyCopyMapping: `Body ${i}.`,
        imageGuidanceMapping: `Guidance ${i}.`,
        placeholderTagMapping: { headline: `Headline ${i}.`, body: `Body ${i}.`, cta: null, image_guidance: `Guidance ${i}.` },
        structuredContent:
          SLIDE_ROLES[i - 1] === "statistic"
            ? { statistic: { value: "50%", context: "Body 3." }, quote: null, keyPoints: [] }
            : SLIDE_ROLES[i - 1] === "quote"
              ? { statistic: null, quote: { quoteText: "Body 4." }, keyPoints: [] }
              : SLIDE_ROLES[i - 1] === "takeaway"
                ? { statistic: null, quote: null, keyPoints: ["Body 5."] }
                : { statistic: null, quote: null, keyPoints: [] },
      })
    );
  }
  slides.push(
    buildSlide({
      slideNumber: 6,
      slideRole: "cta",
      headlineMapping: "Headline 6.",
      bodyCopyMapping: "Body 6.",
      ctaMapping: "Act now.",
      imageGuidanceMapping: "Guidance 6.",
      placeholderTagMapping: { headline: "Headline 6.", body: "Body 6.", cta: "Act now.", image_guidance: "Guidance 6." },
      structuredContent: { statistic: null, quote: null, keyPoints: [] },
    })
  );
  return slides;
}

function buildFields(overrides = {}) {
  return {
    socialMediaPackageId: "sm_a1b2c3d4e5f60708",
    renderer: "templated",
    platform: null,
    designId: "dc-002-v1",
    templateId: "dc-carousel-v1",
    slideSequence: buildSlideSequence(),
    renderingMetadata: { mappingStrategy: "semantic-six-template-v1", slideCount: 6, generator: "templated-renderer-adapter" },
    validationMetadata: {
      socialMediaPackageChecksum: "d734fd7f65fce3498ee98ef948f538caa02346dfd80498b68b81776e522727c7",
      allSlidesPopulated: true,
      rendererMappingValidated: true,
    },
    schemaVersion: "1.0",
    ...overrides,
  };
}

test("createProductionPackage() builds a valid, immutable record with a computed checksum", () => {
  const record = createProductionPackage(buildFields(), { idGenerator: () => "pp_test00000000001", now: () => "2026-08-07T11:00:00.000Z" });
  assert.equal(record.production_package_id, "pp_test00000000001");
  assert.equal(record.social_media_package_id, "sm_a1b2c3d4e5f60708");
  assert.equal(record.status, "generated");
  assert.equal(record.renderer, "templated");
  assert.equal(record.platform, null);
  assert.equal(record.design_id, "dc-002-v1");
  assert.equal(record.template_id, "dc-carousel-v1");
  assert.equal(record.slide_sequence.length, 6);
  assert.equal(record.slide_sequence[5].cta_mapping, "Act now.");
  assert.equal(record.generated_at, "2026-08-07T11:00:00.000Z");
  assert.match(record.production_checksum, /^[a-f0-9]{64}$/);
  assert.throws(() => {
    record.renderer = "changed";
  }, TypeError);
  assert.throws(() => {
    record.slide_sequence[0].headline_mapping = "changed";
  }, TypeError);
});

test("checksum reflects the record's own content", () => {
  const a = createProductionPackage(buildFields({ platform: "instagram" }), { idGenerator: () => "pp_aaaaaaaaaaaaaaaa" });
  const b = createProductionPackage(buildFields({ platform: "linkedin" }), { idGenerator: () => "pp_bbbbbbbbbbbbbbbb" });
  assert.notEqual(a.production_checksum, b.production_checksum);
});

test("accepts a non-null platform value", () => {
  const record = createProductionPackage(buildFields({ platform: "instagram" }));
  assert.equal(record.platform, "instagram");
});

test("throws InvalidProductionPackageInputError for a malformed socialMediaPackageId", () => {
  assert.throws(() => createProductionPackage(buildFields({ socialMediaPackageId: "not-valid" })), InvalidProductionPackageInputError);
});

for (const field of ["renderer", "designId", "templateId", "schemaVersion"]) {
  test(`throws InvalidProductionPackageInputError for a missing ${field}`, () => {
    assert.throws(() => createProductionPackage(buildFields({ [field]: "" })), InvalidProductionPackageInputError);
  });
}

test("throws InvalidProductionPackageInputError when platform is a non-string, non-null value", () => {
  assert.throws(() => createProductionPackage(buildFields({ platform: 42 })), InvalidProductionPackageInputError);
});

test("throws InvalidProductionPackageInputError when slideSequence does not have exactly 6 entries", () => {
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: buildSlideSequence().slice(0, 5) })), InvalidProductionPackageInputError);
});

test("throws InvalidProductionPackageInputError when a slide's slideNumber is out of order", () => {
  const slides = buildSlideSequence();
  slides[2].slideNumber = 99;
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

for (const field of ["headlineMapping", "bodyCopyMapping", "imageGuidanceMapping"]) {
  test(`throws InvalidProductionPackageInputError when slide[0].${field} is blank`, () => {
    const slides = buildSlideSequence();
    slides[0][field] = "";
    assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
  });
}

test("throws InvalidProductionPackageInputError when the final slide's ctaMapping is missing", () => {
  const slides = buildSlideSequence();
  slides[5].ctaMapping = null;
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

test("throws InvalidProductionPackageInputError when a non-final slide's ctaMapping is set", () => {
  const slides = buildSlideSequence();
  slides[0].ctaMapping = "Not allowed here.";
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

test("throws InvalidProductionPackageInputError when placeholderTagMapping is missing", () => {
  const slides = buildSlideSequence();
  delete slides[0].placeholderTagMapping;
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

test("throws InvalidProductionPackageInputError when renderingMetadata.slideCount is not 6", () => {
  assert.throws(
    () => createProductionPackage(buildFields({ renderingMetadata: { mappingStrategy: "x", slideCount: 5, generator: "g" } })),
    InvalidProductionPackageInputError
  );
});

test("throws InvalidProductionPackageInputError when validationMetadata.socialMediaPackageChecksum is malformed", () => {
  assert.throws(
    () =>
      createProductionPackage(
        buildFields({ validationMetadata: { socialMediaPackageChecksum: "not-a-checksum", allSlidesPopulated: true, rendererMappingValidated: true } })
      ),
    InvalidProductionPackageInputError
  );
});

test("throws InvalidProductionPackageInputError when validationMetadata.allSlidesPopulated is not a boolean", () => {
  assert.throws(
    () =>
      createProductionPackage(
        buildFields({
          validationMetadata: {
            socialMediaPackageChecksum: "d734fd7f65fce3498ee98ef948f538caa02346dfd80498b68b81776e522727c7",
            allSlidesPopulated: "yes",
            rendererMappingValidated: true,
          },
        })
      ),
    InvalidProductionPackageInputError
  );
});

test("throws ProductionPackageValidationError when the assembled record still fails schema validation", () => {
  const fakeValidator = { validate: () => ({ valid: false, errors: [{ path: "(root)", message: "forced failure" }] }) };
  assert.throws(() => createProductionPackage(buildFields(), { validator: fakeValidator }), ProductionPackageValidationError);
});

// --- DC-003-I032.1 — slide_role / structured_content ------------------

test("persists slide_role and structured_content verbatim, snake_cased", () => {
  const record = createProductionPackage(buildFields(), { idGenerator: () => "pp_test00000000002" });
  assert.deepEqual(
    record.slide_sequence.map((s) => s.slide_role),
    SLIDE_ROLES
  );
  const statisticSlide = record.slide_sequence.find((s) => s.slide_role === "statistic");
  assert.deepEqual(statisticSlide.structured_content.statistic, { value: "50%", context: "Body 3." });
  const quoteSlide = record.slide_sequence.find((s) => s.slide_role === "quote");
  assert.deepEqual(quoteSlide.structured_content.quote, { quote_text: "Body 4." });
  const takeawaySlide = record.slide_sequence.find((s) => s.slide_role === "takeaway");
  assert.deepEqual(takeawaySlide.structured_content.key_points, ["Body 5."]);
  const coverSlide = record.slide_sequence.find((s) => s.slide_role === "cover");
  assert.equal(coverSlide.structured_content.statistic, null);
  assert.equal(coverSlide.structured_content.quote, null);
  assert.deepEqual(coverSlide.structured_content.key_points, []);
});

test("throws InvalidProductionPackageInputError when a slide's slideRole deviates from the fixed positional order", () => {
  const slides = buildSlideSequence();
  slides[2] = { ...slides[2], slideRole: "quote" };
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

// --- DC-003-I032.6 — position 4 is evidence-aware at the I033 domain
// object layer too. Direct regression coverage for car_3479ca8ac2af40b8's
// fabricated attribution: a quote object may never accompany any role
// but "quote" here either, and the six-slide structure is preserved.

test('accepts slideRole:"evidence" at position 4 with quote: null — the honest fallback', () => {
  const slides = buildSlideSequence();
  const index = slides.findIndex((s) => s.slideRole === "quote");
  slides[index] = { ...slides[index], slideRole: "evidence", structuredContent: { statistic: null, quote: null, keyPoints: [] } };
  const record = createProductionPackage(buildFields({ slideSequence: slides }));
  assert.equal(record.slide_sequence[index].slide_role, "evidence");
  assert.equal(record.slide_sequence[index].structured_content.quote, null);
});

test('still accepts slideRole:"quote" at position 4 with a real quote object — genuinely attributable evidence remains supported', () => {
  const record = createProductionPackage(buildFields());
  const index = record.slide_sequence.findIndex((s) => s.slide_role === "quote");
  assert.notEqual(index, -1);
  assert.notEqual(record.slide_sequence[index].structured_content.quote, null);
});

test('throws when position 4\'s slideRole is anything other than "quote" or "evidence"', () => {
  const slides = buildSlideSequence();
  const index = slides.findIndex((s) => s.slideRole === "quote");
  slides[index] = { ...slides[index], slideRole: "insight", structuredContent: { statistic: null, quote: null, keyPoints: [] } };
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

test('throws when a quote object accompanies slideRole:"evidence" — a fabricated-looking quote may never be smuggled in under a different label', () => {
  const slides = buildSlideSequence();
  const index = slides.findIndex((s) => s.slideRole === "quote");
  slides[index] = {
    ...slides[index],
    slideRole: "evidence",
    structuredContent: { statistic: null, quote: { quoteText: "A real-sounding line presented as if it were external testimony." }, keyPoints: [] },
  };
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

test('throws when a quote object accompanies any non-"quote" role, not only "evidence"', () => {
  const slides = buildSlideSequence();
  slides[0] = { ...slides[0], structuredContent: { statistic: null, quote: { quoteText: "Smuggled onto the cover slide." }, keyPoints: [] } };
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

test("six-slide structure is preserved regardless of which role position 4 uses", () => {
  const slides = buildSlideSequence();
  const index = slides.findIndex((s) => s.slideRole === "quote");
  slides[index] = { ...slides[index], slideRole: "evidence", structuredContent: { statistic: null, quote: null, keyPoints: [] } };
  const record = createProductionPackage(buildFields({ slideSequence: slides }));
  assert.equal(record.slide_sequence.length, 6);
  assert.equal(record.slide_sequence[5].slide_role, "cta");
});

test("throws InvalidProductionPackageInputError when structuredContent is missing", () => {
  const slides = buildSlideSequence();
  delete slides[0].structuredContent;
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

test("throws InvalidProductionPackageInputError when structuredContent.statistic is a malformed non-null object", () => {
  const slides = buildSlideSequence();
  const index = slides.findIndex((s) => s.slideRole === "statistic");
  slides[index] = { ...slides[index], structuredContent: { statistic: { value: "50%" }, quote: null, keyPoints: [] } };
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

test("throws InvalidProductionPackageInputError when structuredContent.keyPoints has more than 4 entries", () => {
  const slides = buildSlideSequence();
  const index = slides.findIndex((s) => s.slideRole === "takeaway");
  slides[index] = { ...slides[index], structuredContent: { statistic: null, quote: null, keyPoints: ["1", "2", "3", "4", "5"] } };
  assert.throws(() => createProductionPackage(buildFields({ slideSequence: slides })), InvalidProductionPackageInputError);
});

test("accepts null statistic/quote on their own slides (honest no-evidence fallback carried through unchanged)", () => {
  const slides = buildSlideSequence();
  const statisticIndex = slides.findIndex((s) => s.slideRole === "statistic");
  slides[statisticIndex] = { ...slides[statisticIndex], structuredContent: { statistic: null, quote: null, keyPoints: [] } };
  const record = createProductionPackage(buildFields({ slideSequence: slides }));
  assert.equal(record.slide_sequence[statisticIndex].structured_content.statistic, null);
});

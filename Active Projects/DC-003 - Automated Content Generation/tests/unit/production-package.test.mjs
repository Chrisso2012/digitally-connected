import test from "node:test";
import assert from "node:assert/strict";
import { createProductionPackage } from "../../src/production-package.mjs";
import { InvalidProductionPackageInputError, ProductionPackageValidationError } from "../../src/production-package-errors.mjs";

function buildSlide(overrides = {}) {
  return {
    slideNumber: 1,
    headlineMapping: "Headline.",
    bodyCopyMapping: "Body copy.",
    ctaMapping: null,
    imageGuidanceMapping: "Guidance.",
    placeholderTagMapping: { headline: "Headline.", body: "Body copy.", cta: null, image_guidance: "Guidance." },
    ...overrides,
  };
}

function buildSlideSequence() {
  const slides = [];
  for (let i = 1; i <= 5; i += 1) {
    slides.push(buildSlide({ slideNumber: i, headlineMapping: `Headline ${i}.`, bodyCopyMapping: `Body ${i}.`, imageGuidanceMapping: `Guidance ${i}.`, placeholderTagMapping: { headline: `Headline ${i}.`, body: `Body ${i}.`, cta: null, image_guidance: `Guidance ${i}.` } }));
  }
  slides.push(
    buildSlide({
      slideNumber: 6,
      headlineMapping: "Headline 6.",
      bodyCopyMapping: "Body 6.",
      ctaMapping: "Act now.",
      imageGuidanceMapping: "Guidance 6.",
      placeholderTagMapping: { headline: "Headline 6.", body: "Body 6.", cta: "Act now.", image_guidance: "Guidance 6." },
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
    renderingMetadata: { mappingStrategy: "uniform-cover-cta-v1", slideCount: 6, generator: "templated-renderer-adapter" },
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

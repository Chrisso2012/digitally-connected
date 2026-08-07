import test from "node:test";
import assert from "node:assert/strict";
import { createTemplatedRendererAdapter } from "../../src/templated-renderer-adapter.mjs";
import { RequiredRendererMappingMissingError, InvalidTemplateMappingError } from "../../src/production-package-errors.mjs";

function buildSocialMediaPackage(overrides = {}) {
  return {
    social_media_package_id: "sm_a1b2c3d4e5f60708",
    call_to_action: "Learn more today.",
    carousel: {
      headings: ["H1", "H2", "H3", "H4", "H5", "H6"],
      slide_copy: ["S1", "S2", "S3", "S4", "S5", "S6"],
      image_guidance: ["G1", "G2", "G3", "G4", "G5", "G6"],
    },
    ...overrides,
  };
}

const FAKE_TEMPLATES_CONFIG = {
  templates: {
    cover: { template_id: "cover-template-id", template_version: "v1", format: "png" },
    cta: { template_id: "cta-template-id", template_version: "v1", format: "png" },
  },
};

test("createTemplatedRendererAdapter() implements the Renderer Adapter interface", () => {
  const adapter = createTemplatedRendererAdapter();
  assert.equal(adapter.renderer, "templated");
  assert.equal(typeof adapter.name, "string");
  assert.equal(typeof adapter.buildSlideSequence, "function");
  assert.equal(typeof adapter.mapToRendererPayload, "function");
});

test("buildSlideSequence() maps all 6 slides 1:1 from the Social Media Package's own carousel content, verbatim", () => {
  const adapter = createTemplatedRendererAdapter();
  const smp = buildSocialMediaPackage();
  const { slideSequence, templateId, renderingMetadata } = adapter.buildSlideSequence(smp);

  assert.equal(slideSequence.length, 6);
  assert.equal(templateId, "dc-carousel-v1");
  assert.equal(renderingMetadata.slideCount, 6);
  assert.equal(renderingMetadata.generator, "templated-renderer-adapter");

  slideSequence.forEach((slide, index) => {
    assert.equal(slide.slideNumber, index + 1);
    assert.equal(slide.headlineMapping, smp.carousel.headings[index]);
    assert.equal(slide.bodyCopyMapping, smp.carousel.slide_copy[index]);
    assert.equal(slide.imageGuidanceMapping, smp.carousel.image_guidance[index]);
    assert.equal(slide.placeholderTagMapping.headline, smp.carousel.headings[index]);
  });
});

test("buildSlideSequence() sets cta_mapping only on the final slide, from the Social Media Package's own call_to_action", () => {
  const adapter = createTemplatedRendererAdapter();
  const smp = buildSocialMediaPackage({ call_to_action: "A distinct CTA." });
  const { slideSequence } = adapter.buildSlideSequence(smp);

  for (let i = 0; i < 5; i += 1) assert.equal(slideSequence[i].ctaMapping, null);
  assert.equal(slideSequence[5].ctaMapping, "A distinct CTA.");
  assert.equal(slideSequence[5].placeholderTagMapping.cta, "A distinct CTA.");
});

test("buildSlideSequence() never fabricates content — every mapped value is a real, verbatim substring of the source", () => {
  const adapter = createTemplatedRendererAdapter();
  const smp = buildSocialMediaPackage();
  const { slideSequence } = adapter.buildSlideSequence(smp);

  slideSequence.forEach((slide, index) => {
    assert.ok(smp.carousel.headings.includes(slide.headlineMapping));
    assert.ok(smp.carousel.slide_copy.includes(slide.bodyCopyMapping));
    assert.ok(smp.carousel.image_guidance.includes(slide.imageGuidanceMapping));
  });
});

test("buildSlideSequence() throws RequiredRendererMappingMissingError when carousel arrays are malformed (defense in depth)", () => {
  const adapter = createTemplatedRendererAdapter();
  assert.throws(
    () => adapter.buildSlideSequence(buildSocialMediaPackage({ carousel: { headings: ["only one"], slide_copy: [], image_guidance: [] } })),
    RequiredRendererMappingMissingError
  );
});

test("buildSlideSequence() throws RequiredRendererMappingMissingError when call_to_action is blank", () => {
  const adapter = createTemplatedRendererAdapter();
  assert.throws(() => adapter.buildSlideSequence(buildSocialMediaPackage({ call_to_action: "" })), RequiredRendererMappingMissingError);
});

test("mapToRendererPayload() resolves real per-slide Templated template IDs — cover for slides 1-5, cta for slide 6", () => {
  const adapter = createTemplatedRendererAdapter();
  const smp = buildSocialMediaPackage();
  const { slideSequence } = adapter.buildSlideSequence(smp);
  const snakeCaseSlides = slideSequence.map((s) => ({ slide_number: s.slideNumber, headline_mapping: s.headlineMapping, body_copy_mapping: s.bodyCopyMapping, cta_mapping: s.ctaMapping }));

  const payloads = adapter.mapToRendererPayload({ slide_sequence: snakeCaseSlides }, { templatesConfig: FAKE_TEMPLATES_CONFIG });

  assert.equal(payloads.length, 6);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(payloads[i].template_id, "cover-template-id");
    assert.equal(payloads[i].slide_type, "cover");
    assert.equal(payloads[i].slide_number, i + 1);
    assert.equal(payloads[i].layers.headline_text.text, snakeCaseSlides[i].headline_mapping);
    assert.equal(payloads[i].layers.body_text.text, snakeCaseSlides[i].body_copy_mapping);
    assert.equal("button_label" in payloads[i].layers, false);
  }
  assert.equal(payloads[5].template_id, "cta-template-id");
  assert.equal(payloads[5].slide_type, "cta");
  assert.equal(payloads[5].layers.button_label.text, snakeCaseSlides[5].cta_mapping);
});

test("mapToRendererPayload() throws InvalidTemplateMappingError when the template registry is missing a required key", () => {
  const adapter = createTemplatedRendererAdapter();
  assert.throws(
    () =>
      adapter.mapToRendererPayload(
        { slide_sequence: [{ slide_number: 1, headline_mapping: "H", body_copy_mapping: "B", cta_mapping: null }] },
        { templatesConfig: { templates: {} } }
      ),
    InvalidTemplateMappingError
  );
});

test("mapToRendererPayload() throws RequiredRendererMappingMissingError when a slide's own mapping content is blank", () => {
  const adapter = createTemplatedRendererAdapter();
  assert.throws(
    () =>
      adapter.mapToRendererPayload(
        { slide_sequence: [{ slide_number: 1, headline_mapping: "", body_copy_mapping: "B", cta_mapping: null }] },
        { templatesConfig: FAKE_TEMPLATES_CONFIG }
      ),
    RequiredRendererMappingMissingError
  );
});

test("mapToRendererPayload() throws RequiredRendererMappingMissingError when the final slide's cta_mapping is blank", () => {
  const adapter = createTemplatedRendererAdapter();
  assert.throws(
    () =>
      adapter.mapToRendererPayload(
        { slide_sequence: [{ slide_number: 6, headline_mapping: "H", body_copy_mapping: "B", cta_mapping: null }] },
        { templatesConfig: FAKE_TEMPLATES_CONFIG }
      ),
    RequiredRendererMappingMissingError
  );
});

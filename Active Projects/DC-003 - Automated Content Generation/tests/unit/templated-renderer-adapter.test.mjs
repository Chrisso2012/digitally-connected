import test from "node:test";
import assert from "node:assert/strict";
import { createTemplatedRendererAdapter } from "../../src/templated-renderer-adapter.mjs";
import { RequiredRendererMappingMissingError, InvalidTemplateMappingError } from "../../src/production-package-errors.mjs";

const SLIDE_ROLES = ["cover", "insight", "statistic", "quote", "takeaway", "cta"];

function buildCarouselSlide(index, overrides = {}) {
  const n = index + 1;
  return {
    slide_number: n,
    slide_role: SLIDE_ROLES[index],
    heading: `H${n}`,
    body: `S${n}`,
    image_guidance: `G${n}`,
    statistic: null,
    quote: null,
    key_points: [],
    ...overrides,
  };
}

// DC-003-I032.1 — one slide WITH real evidence per evidence-bearing role,
// so the default fixture exercises the "real evidence present" path
// end-to-end (the "no evidence" fallback path is covered by its own
// dedicated tests below).
function buildCarouselSlides() {
  return SLIDE_ROLES.map((role, index) => {
    if (role === "statistic") return buildCarouselSlide(index, { statistic: { value: "73%", context: "S3" } });
    if (role === "quote") return buildCarouselSlide(index, { quote: { quote_text: "S4" } });
    if (role === "takeaway") return buildCarouselSlide(index, { key_points: ["S5 point one", "S5 point two"] });
    return buildCarouselSlide(index);
  });
}

function buildSocialMediaPackage(overrides = {}) {
  return {
    social_media_package_id: "sm_a1b2c3d4e5f60708",
    call_to_action: "Learn more today.",
    carousel: {
      headings: ["H1", "H2", "H3", "H4", "H5", "H6"],
      slide_copy: ["S1", "S2", "S3", "S4", "S5", "S6"],
      image_guidance: ["G1", "G2", "G3", "G4", "G5", "G6"],
      slides: buildCarouselSlides(),
    },
    ...overrides,
  };
}

const FAKE_TEMPLATES_CONFIG = {
  templates: {
    cover: { template_id: "cover-template-id", template_version: "v1", format: "png" },
    content: { template_id: "content-template-id", template_version: "v1", format: "png" },
    statistic: { template_id: "statistic-template-id", template_version: "v1", format: "png" },
    quote: { template_id: "quote-template-id", template_version: "v1", format: "png" },
    infographic: { template_id: "infographic-template-id", template_version: "v1", format: "png" },
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

test("buildSlideSequence() maps all 6 slides 1:1 from the Social Media Package's own carousel.slides content, verbatim, with slideRole in fixed order", () => {
  const adapter = createTemplatedRendererAdapter();
  const smp = buildSocialMediaPackage();
  const { slideSequence, templateId, renderingMetadata } = adapter.buildSlideSequence(smp);

  assert.equal(slideSequence.length, 6);
  assert.equal(templateId, "dc-carousel-v1");
  assert.equal(renderingMetadata.slideCount, 6);
  assert.equal(renderingMetadata.mappingStrategy, "semantic-six-template-v1");
  assert.equal(renderingMetadata.generator, "templated-renderer-adapter");

  slideSequence.forEach((slide, index) => {
    assert.equal(slide.slideNumber, index + 1);
    assert.equal(slide.slideRole, SLIDE_ROLES[index]);
    assert.equal(slide.headlineMapping, smp.carousel.slides[index].heading);
    assert.equal(slide.bodyCopyMapping, smp.carousel.slides[index].body);
    assert.equal(slide.imageGuidanceMapping, smp.carousel.slides[index].image_guidance);
    assert.equal(slide.placeholderTagMapping.headline, smp.carousel.slides[index].heading);
  });
});

test("buildSlideSequence() carries statistic/quote/keyPoints through verbatim, converting quote_text to camelCase quoteText", () => {
  const adapter = createTemplatedRendererAdapter();
  const smp = buildSocialMediaPackage();
  const { slideSequence } = adapter.buildSlideSequence(smp);

  const statisticSlide = slideSequence.find((s) => s.slideRole === "statistic");
  assert.deepEqual(statisticSlide.structuredContent.statistic, { value: "73%", context: "S3" });

  const quoteSlide = slideSequence.find((s) => s.slideRole === "quote");
  assert.deepEqual(quoteSlide.structuredContent.quote, { quoteText: "S4" });

  const takeawaySlide = slideSequence.find((s) => s.slideRole === "takeaway");
  assert.deepEqual(takeawaySlide.structuredContent.keyPoints, ["S5 point one", "S5 point two"]);

  const coverSlide = slideSequence.find((s) => s.slideRole === "cover");
  assert.equal(coverSlide.structuredContent.statistic, null);
  assert.equal(coverSlide.structuredContent.quote, null);
  assert.deepEqual(coverSlide.structuredContent.keyPoints, []);
});

test("buildSlideSequence() carries a null statistic/quote through as null — never invents a substitute", () => {
  const adapter = createTemplatedRendererAdapter();
  const smp = buildSocialMediaPackage({
    carousel: {
      ...buildSocialMediaPackage().carousel,
      slides: SLIDE_ROLES.map((role, index) => buildCarouselSlide(index)), // no evidence anywhere
    },
  });
  const { slideSequence } = adapter.buildSlideSequence(smp);
  const statisticSlide = slideSequence.find((s) => s.slideRole === "statistic");
  const quoteSlide = slideSequence.find((s) => s.slideRole === "quote");
  assert.equal(statisticSlide.structuredContent.statistic, null);
  assert.equal(quoteSlide.structuredContent.quote, null);
});

test("buildSlideSequence() sets cta_mapping only on the final slide, from the Social Media Package's own call_to_action", () => {
  const adapter = createTemplatedRendererAdapter();
  const smp = buildSocialMediaPackage({ call_to_action: "A distinct CTA." });
  const { slideSequence } = adapter.buildSlideSequence(smp);

  for (let i = 0; i < 5; i += 1) assert.equal(slideSequence[i].ctaMapping, null);
  assert.equal(slideSequence[5].ctaMapping, "A distinct CTA.");
  assert.equal(slideSequence[5].placeholderTagMapping.cta, "A distinct CTA.");
});

test("buildSlideSequence() throws RequiredRendererMappingMissingError when carousel.slides is malformed (defense in depth)", () => {
  const adapter = createTemplatedRendererAdapter();
  assert.throws(
    () => adapter.buildSlideSequence(buildSocialMediaPackage({ carousel: { ...buildSocialMediaPackage().carousel, slides: [buildCarouselSlide(0)] } })),
    RequiredRendererMappingMissingError
  );
});

test("buildSlideSequence() throws RequiredRendererMappingMissingError when a slide's slide_role deviates from the fixed positional order", () => {
  const adapter = createTemplatedRendererAdapter();
  const slides = buildCarouselSlides();
  slides[2] = { ...slides[2], slide_role: "quote" };
  assert.throws(
    () => adapter.buildSlideSequence(buildSocialMediaPackage({ carousel: { ...buildSocialMediaPackage().carousel, slides } })),
    RequiredRendererMappingMissingError
  );
});

test("buildSlideSequence() throws RequiredRendererMappingMissingError when call_to_action is blank", () => {
  const adapter = createTemplatedRendererAdapter();
  assert.throws(() => adapter.buildSlideSequence(buildSocialMediaPackage({ call_to_action: "" })), RequiredRendererMappingMissingError);
});

// --- mapToRendererPayload(): all six real templates, by fixed position -

function buildProductionSlideSequence() {
  const adapter = createTemplatedRendererAdapter();
  const { slideSequence } = adapter.buildSlideSequence(buildSocialMediaPackage());
  return slideSequence.map((s) => ({
    slide_number: s.slideNumber,
    headline_mapping: s.headlineMapping,
    body_copy_mapping: s.bodyCopyMapping,
    cta_mapping: s.ctaMapping,
    structured_content: {
      statistic: s.structuredContent.statistic,
      quote: s.structuredContent.quote ? { quote_text: s.structuredContent.quote.quoteText } : null,
      key_points: s.structuredContent.keyPoints,
    },
  }));
}

test("mapToRendererPayload() resolves all six real per-slide Templated templates by fixed position", () => {
  const adapter = createTemplatedRendererAdapter();
  const payloads = adapter.mapToRendererPayload({ slide_sequence: buildProductionSlideSequence() }, { templatesConfig: FAKE_TEMPLATES_CONFIG });

  assert.equal(payloads.length, 6);
  const expectedTemplateIds = ["cover-template-id", "content-template-id", "statistic-template-id", "quote-template-id", "infographic-template-id", "cta-template-id"];
  payloads.forEach((payload, index) => {
    assert.equal(payload.slide_type, SLIDE_ROLES[index] === "insight" ? "content" : SLIDE_ROLES[index] === "takeaway" ? "infographic" : SLIDE_ROLES[index]);
    assert.equal(payload.template_id, expectedTemplateIds[index]);
    assert.equal(payload.slide_number, index + 1);
  });
});

test("mapToRendererPayload() cover/content/cta layers use headline_text/body_text, never eyebrow_text", () => {
  const adapter = createTemplatedRendererAdapter();
  const slides = buildProductionSlideSequence();
  const payloads = adapter.mapToRendererPayload({ slide_sequence: slides }, { templatesConfig: FAKE_TEMPLATES_CONFIG });

  for (const index of [0, 1]) {
    assert.equal(payloads[index].layers.headline_text.text, slides[index].headline_mapping);
    assert.equal(payloads[index].layers.body_text.text, slides[index].body_copy_mapping);
    assert.equal("eyebrow_text" in payloads[index].layers, false);
  }
  assert.equal(payloads[5].layers.button_label.text, slides[5].cta_mapping);
});

test("mapToRendererPayload() statistic slide, WITH evidence, maps stat_value/supporting_stat_text — never stat_caption or eyebrow_text", () => {
  const adapter = createTemplatedRendererAdapter();
  const slides = buildProductionSlideSequence();
  const payloads = adapter.mapToRendererPayload({ slide_sequence: slides }, { templatesConfig: FAKE_TEMPLATES_CONFIG });
  const statisticPayload = payloads[2];
  assert.equal(statisticPayload.layers.stat_value.text, "73%");
  assert.equal(statisticPayload.layers.supporting_stat_text.text, "S3");
  assert.equal("stat_caption" in statisticPayload.layers, false);
  assert.equal("eyebrow_text" in statisticPayload.layers, false);
  assert.equal("headline_text" in statisticPayload.layers, false, "statistic template has no headline_text layer");
});

test("mapToRendererPayload() statistic slide, WITHOUT evidence, sends an empty layers object — honest fallback, never fabricated stat text", () => {
  const adapter = createTemplatedRendererAdapter();
  const slides = buildProductionSlideSequence();
  slides[2] = { ...slides[2], structured_content: { statistic: null, quote: null, key_points: [] } };
  const payloads = adapter.mapToRendererPayload({ slide_sequence: slides }, { templatesConfig: FAKE_TEMPLATES_CONFIG });
  assert.deepEqual(payloads[2].layers, {});
});

test("mapToRendererPayload() quote slide, WITH evidence, maps quote_text — never attribution_name/attribution_role", () => {
  const adapter = createTemplatedRendererAdapter();
  const slides = buildProductionSlideSequence();
  const payloads = adapter.mapToRendererPayload({ slide_sequence: slides }, { templatesConfig: FAKE_TEMPLATES_CONFIG });
  const quotePayload = payloads[3];
  assert.equal(quotePayload.layers.quote_text.text, "S4");
  assert.equal("attribution_name" in quotePayload.layers, false);
  assert.equal("attribution_role" in quotePayload.layers, false);
});

test("mapToRendererPayload() quote slide, WITHOUT evidence, sends an empty layers object — honest fallback, never a fabricated quote", () => {
  const adapter = createTemplatedRendererAdapter();
  const slides = buildProductionSlideSequence();
  slides[3] = { ...slides[3], structured_content: { statistic: null, quote: null, key_points: [] } };
  const payloads = adapter.mapToRendererPayload({ slide_sequence: slides }, { templatesConfig: FAKE_TEMPLATES_CONFIG });
  assert.deepEqual(payloads[3].layers, {});
});

test("mapToRendererPayload() takeaway/infographic slide maps up to 4 step_N_title/description layers from real key_points, mechanically truncating only the title", () => {
  const adapter = createTemplatedRendererAdapter();
  const slides = buildProductionSlideSequence();
  const payloads = adapter.mapToRendererPayload({ slide_sequence: slides }, { templatesConfig: FAKE_TEMPLATES_CONFIG });
  const infographicPayload = payloads[4];
  assert.equal(infographicPayload.layers.headline_text.text, slides[4].headline_mapping);
  assert.equal(infographicPayload.layers.step_1_title.text, "S5 point one");
  assert.equal(infographicPayload.layers.step_1_description.text, "S5 point one");
  assert.equal(infographicPayload.layers.step_2_title.text, "S5 point two");
  assert.equal("step_3_title" in infographicPayload.layers, false, "no 3rd real key point exists — never padded");
  assert.equal("step_3_description" in infographicPayload.layers, false);
  assert.equal("step_4_title" in infographicPayload.layers, false);
});

test("mapToRendererPayload() takeaway slide with zero real key_points sends only headline_text, no step_N layers at all", () => {
  const adapter = createTemplatedRendererAdapter();
  const slides = buildProductionSlideSequence();
  slides[4] = { ...slides[4], structured_content: { statistic: null, quote: null, key_points: [] } };
  const payloads = adapter.mapToRendererPayload({ slide_sequence: slides }, { templatesConfig: FAKE_TEMPLATES_CONFIG });
  assert.deepEqual(Object.keys(payloads[4].layers), ["headline_text"]);
});

test("mapToRendererPayload() throws InvalidTemplateMappingError when the template registry is missing a required key", () => {
  const adapter = createTemplatedRendererAdapter();
  assert.throws(
    () =>
      adapter.mapToRendererPayload(
        { slide_sequence: [{ slide_number: 1, headline_mapping: "H", body_copy_mapping: "B", cta_mapping: null, structured_content: { statistic: null, quote: null, key_points: [] } }] },
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
        { slide_sequence: [{ slide_number: 1, headline_mapping: "", body_copy_mapping: "B", cta_mapping: null, structured_content: { statistic: null, quote: null, key_points: [] } }] },
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
        { slide_sequence: [{ slide_number: 6, headline_mapping: "H", body_copy_mapping: "B", cta_mapping: null, structured_content: { statistic: null, quote: null, key_points: [] } }] },
        { templatesConfig: FAKE_TEMPLATES_CONFIG }
      ),
    RequiredRendererMappingMissingError
  );
});

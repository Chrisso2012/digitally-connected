// DC-003-I032.10.1 — regression coverage for createCarouselContentPackage():
// the seven-slide positional sequence, image-mode rules, emphasis
// wiring, production_authority enforcement, and "copy survives
// ingestion byte-for-byte" — this object's own central promise.

import test from "node:test";
import assert from "node:assert/strict";
import { createCarouselContentPackage } from "../../src/carousel-content-package.mjs";
import {
  InvalidCarouselContentPackageInputError,
  CarouselContentPackageValidationError,
  EmphasisPhraseNotFoundError,
  ConflictingEmphasisInstructionsError,
} from "../../src/carousel-content-package-errors.mjs";

const INDUSTRY_SERIES = "Real Estate Industry Series";

function image(overrides = {}) {
  return { mode: "none", asset_reference: null, direction: null, ...overrides };
}

function coverSlide(overrides = {}) {
  return {
    slide_number: 1,
    role: "cover",
    template: "cover_black",
    industry_series: INDUSTRY_SERIES,
    headline: "The Myth of the Dead Database",
    supporting_line: "Why timing, not interest, is the real reason old enquiries go quiet.",
    image: image({ mode: "provided", asset_reference: "fixtures/images/cover.png" }),
    ...overrides,
  };
}

function contentSlide(slideNumber, template, overrides = {}) {
  return {
    slide_number: slideNumber,
    role: "content",
    template,
    industry_series: INDUSTRY_SERIES,
    headline: `Headline ${slideNumber}`,
    body: `Body copy for slide ${slideNumber}, written entirely upstream.`,
    image: image(),
    image_layout: "none",
    emphasis_instructions: [],
    ...overrides,
  };
}

function closeSlide(overrides = {}) {
  return {
    slide_number: 7,
    role: "close",
    template: "close_black",
    industry_series: INDUSTRY_SERIES,
    headline: "One Question Reopens the Conversation",
    body: "Ask every old enquiry the same simple question: has anything changed since we last spoke?",
    soft_cta: "See what's already in your CRM.",
    image: image({ mode: "provided", asset_reference: "fixtures/images/close.png" }),
    emphasis_instructions: [],
    ...overrides,
  };
}

function buildDefaultSlides() {
  return [
    coverSlide(),
    contentSlide(2, "content_white", { image_layout: "corner", image: image({ mode: "provided", asset_reference: "fixtures/images/s2.png" }) }),
    contentSlide(3, "content_orange"),
    contentSlide(4, "content_white"),
    contentSlide(5, "content_orange"),
    contentSlide(6, "content_white", { image_layout: "strip", image: image({ mode: "provided", asset_reference: "fixtures/images/s6.png" }) }),
    closeSlide(),
  ];
}

function buildFields(overrides = {}) {
  return {
    sourceArticleTitle: "The Myth of the Dead Database",
    sourceArticleReference: "cowork://articles/myth-dead-database",
    industryName: "Real Estate",
    industrySeries: INDUSTRY_SERIES,
    carouselTitle: "The Myth of the Dead Database",
    approvedBy: "chris@digitallyconnected.net",
    approvedAt: "2026-08-11T09:00:00.000Z",
    schemaVersion: "1.0",
    slides: buildDefaultSlides(),
    ...overrides,
  };
}

test("builds a valid, immutable record with a computed id/checksum and fixed package_type/package_version", () => {
  const record = createCarouselContentPackage(buildFields(), { idGenerator: () => "ccp_test0000000001", now: () => "2026-08-11T09:05:00.000Z" });
  assert.equal(record.carousel_content_package_id, "ccp_test0000000001");
  assert.equal(record.package_type, "carousel_content_package");
  assert.equal(record.package_version, "v1");
  assert.equal(record.created_at, "2026-08-11T09:05:00.000Z");
  assert.equal(record.total_slides, 7);
  assert.match(record.checksum, /^[a-f0-9]{64}$/);
  assert.throws(() => {
    record.carousel_title = "changed";
  }, TypeError);
});

test("copy survives ingestion byte-for-byte — every slide's own text fields are stored verbatim, never rewritten/shortened", () => {
  const fields = buildFields();
  const record = createCarouselContentPackage(fields);
  for (let i = 0; i < 7; i++) {
    const input = fields.slides[i];
    const output = record.slides[i];
    if (input.headline) assert.equal(output.headline, input.headline);
    if (input.body) assert.equal(output.body, input.body);
    if (input.supporting_line) assert.equal(output.supporting_line, input.supporting_line);
    if (input.soft_cta) assert.equal(output.soft_cta, input.soft_cta);
  }
  assert.equal(record.source_article_title, fields.sourceArticleTitle);
  assert.equal(record.carousel_title, fields.carouselTitle);
});

test("throws InvalidCarouselContentPackageInputError when fewer than 7 slides are supplied", () => {
  const fields = buildFields({ slides: buildDefaultSlides().slice(0, 6) });
  assert.throws(() => createCarouselContentPackage(fields), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError when more than 7 slides are supplied", () => {
  const fields = buildFields({ slides: [...buildDefaultSlides(), contentSlide(8, "content_white")] });
  assert.throws(() => createCarouselContentPackage(fields), InvalidCarouselContentPackageInputError);
});

// --- Positional template sequence is enforced, never inferred ---------

test("throws InvalidCarouselContentPackageInputError when slide 1's template is not cover_black", () => {
  const slides = buildDefaultSlides();
  slides[0] = { ...slides[0], template: "content_white" };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError when position 2 (must be content_white) is content_orange", () => {
  const slides = buildDefaultSlides();
  slides[1] = { ...slides[1], template: "content_orange" };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError when position 3 (must be content_orange) is content_white", () => {
  const slides = buildDefaultSlides();
  slides[2] = { ...slides[2], template: "content_white" };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError when slide 7's template is not close_black", () => {
  const slides = buildDefaultSlides();
  slides[6] = { ...slides[6], template: "content_white" };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError when a slide's own slide_number disagrees with its array position", () => {
  const slides = buildDefaultSlides();
  slides[1] = { ...slides[1], slide_number: 99 };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError when a slide's own industry_series disagrees with the package-level value", () => {
  const slides = buildDefaultSlides();
  slides[3] = { ...slides[3], industry_series: "Healthcare Industry Series" };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

// --- Image mode rules ----------------------------------------------------

test("no-image slides (mode: none) validate correctly", () => {
  const record = createCarouselContentPackage(buildFields());
  assert.equal(record.slides[2].image.mode, "none");
  assert.equal(record.slides[2].image.asset_reference, null);
});

test("throws InvalidCarouselContentPackageInputError when mode is 'provided' but asset_reference is absent — a required provided image can never be missing", () => {
  const slides = buildDefaultSlides();
  slides[1] = { ...slides[1], image: image({ mode: "provided", asset_reference: null }) };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError when mode is 'none' but asset_reference is non-null", () => {
  const slides = buildDefaultSlides();
  slides[2] = { ...slides[2], image: image({ mode: "none", asset_reference: "should-not-be-here.png" }) };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError for an unsupported image mode (e.g. a future 'generate' is not implemented in V1)", () => {
  const slides = buildDefaultSlides();
  slides[1] = { ...slides[1], image: { mode: "generate", asset_reference: null, direction: null } };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

// --- image_layout enum enforced on content slides -----------------------

test("throws InvalidCarouselContentPackageInputError for an unsupported image_layout value", () => {
  const slides = buildDefaultSlides();
  slides[3] = { ...slides[3], image_layout: "fullscreen" };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError when a content_orange slide declares any image_layout other than none", () => {
  const slides = buildDefaultSlides();
  slides[2] = { ...slides[2], image_layout: "corner" };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError when a content_orange slide declares image.mode 'provided' — that template has a fixed no-image design", () => {
  const slides = buildDefaultSlides();
  slides[4] = { ...slides[4], image: image({ mode: "provided", asset_reference: "fixtures/images/should-not-be-allowed.png" }) };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("accepts corner/strip image_layout on content_white slides", () => {
  const record = createCarouselContentPackage(buildFields());
  assert.equal(record.slides[1].image_layout, "corner");
  assert.equal(record.slides[5].image_layout, "strip");
});

// --- Emphasis instructions -----------------------------------------------

test("emphasis phrase validation works deterministically — a phrase genuinely present in the slide's own text succeeds", () => {
  const slides = buildDefaultSlides();
  slides[4] = {
    ...slides[4],
    headline: "Ready vs. Not Ready Yet",
    body: "The old lens was interested or not. The better lens is ready or not ready yet.",
    emphasis_instructions: [
      { phrase: "ready or not ready yet", style: "highlight" },
      { phrase: "interested or not", style: "strike" },
    ],
  };
  const record = createCarouselContentPackage(buildFields({ slides }));
  assert.deepEqual(record.slides[4].emphasis_instructions, [
    { phrase: "ready or not ready yet", style: "highlight" },
    { phrase: "interested or not", style: "strike" },
  ]);
});

test("throws EmphasisPhraseNotFoundError when the phrase does not exist in the slide's own text", () => {
  const slides = buildDefaultSlides();
  slides[4] = { ...slides[4], emphasis_instructions: [{ phrase: "a phrase nowhere in this text", style: "highlight" }] };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), EmphasisPhraseNotFoundError);
});

test("throws ConflictingEmphasisInstructionsError when two instructions on the same slide have overlapping matched text", () => {
  const slides = buildDefaultSlides();
  slides[4] = {
    ...slides[4],
    headline: "ready or not ready yet, act now",
    body: "Body copy.",
    emphasis_instructions: [
      { phrase: "ready or not ready yet", style: "highlight" },
      { phrase: "not ready yet", style: "strike" }, // overlaps the first
    ],
  };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), ConflictingEmphasisInstructionsError);
});

test("throws InvalidCarouselContentPackageInputError for an unsupported emphasis style", () => {
  const slides = buildDefaultSlides();
  slides[4] = { ...slides[4], emphasis_instructions: [{ phrase: "Headline 5", style: "italic" }] };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError for a malformed emphasis instruction (missing phrase)", () => {
  const slides = buildDefaultSlides();
  slides[4] = { ...slides[4], emphasis_instructions: [{ style: "highlight" }] };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError for a malformed emphasis instruction (blank phrase)", () => {
  const slides = buildDefaultSlides();
  slides[4] = { ...slides[4], emphasis_instructions: [{ phrase: "   ", style: "highlight" }] };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), InvalidCarouselContentPackageInputError);
});

test("emphasis_instructions defaults to [] when omitted", () => {
  const record = createCarouselContentPackage(buildFields());
  assert.deepEqual(record.slides[3].emphasis_instructions, []);
});

// --- DC-003-I035.1 — headline-only emphasis (the real production defect) ---
// A real render of ccp_c1894dc4d8b04563 crashed because this factory used
// to validate emphasis phrases against `${headline} ${body}` concatenated,
// while the renderer only ever applied emphasis to `body` — a phrase
// genuinely present only in the headline passed here but then crashed
// rendering. These tests prove the factory now agrees with the renderer:
// a headline-only phrase is valid, and a phrase that only exists by
// spanning the headline/body boundary is rejected here instead of
// surviving to crash a future render.

test("a headline-only emphasis phrase on a content slide now validates successfully (the real reported defect)", () => {
  const slides = buildDefaultSlides();
  slides[5] = {
    ...slides[5],
    headline: "Your appraisal history is a source of future listings.",
    body: "Not a record of past misses.",
    emphasis_instructions: [{ phrase: "source of future listings", style: "highlight" }],
  };
  const record = createCarouselContentPackage(buildFields({ slides }));
  assert.deepEqual(record.slides[5].emphasis_instructions, [{ phrase: "source of future listings", style: "highlight" }]);
});

test("a headline-only emphasis phrase on the close slide now validates successfully", () => {
  const slides = buildDefaultSlides();
  slides[6] = {
    ...slides[6],
    headline: "Not mass outreach. Not pressure.",
    body: "Just a structured, respectful way of finding out who's still interested.",
    emphasis_instructions: [{ phrase: "Not mass outreach", style: "highlight" }],
  };
  const record = createCarouselContentPackage(buildFields({ slides }));
  assert.deepEqual(record.slides[6].emphasis_instructions, [{ phrase: "Not mass outreach", style: "highlight" }]);
});

test("throws EmphasisPhraseNotFoundError for a phrase that only matches by spanning the headline/body boundary (closes the latent edge case)", () => {
  const slides = buildDefaultSlides();
  slides[3] = {
    ...slides[3],
    headline: "Your appraisal is a",
    body: "genuine asset worth revisiting.",
    // "is a genuine" is not a real substring of either field alone — it
    // only existed in the OLD concatenated `${headline} ${body}` check.
    emphasis_instructions: [{ phrase: "is a genuine", style: "highlight" }],
  };
  assert.throws(() => createCarouselContentPackage(buildFields({ slides })), EmphasisPhraseNotFoundError);
});

// --- Production authority — enforced, never caller-suppliable -----------

test("production_authority is always stamped with the fixed V1 contract values — publishing_authorized remains false", () => {
  const record = createCarouselContentPackage(buildFields());
  assert.deepEqual(record.production_authority, {
    preserve_copy_exactly: true,
    allow_editorial_rewriting: false,
    allow_copy_truncation: false,
    allow_template_substitution: false,
    allow_unapproved_content_generation: false,
    capacity_validation_required: true,
    visual_approval_required: true,
    publishing_authorized: false,
  });
});

test("production_authority cannot be overridden via fields — a caller-supplied value is silently ignored, never trusted", () => {
  const record = createCarouselContentPackage(
    buildFields({ production_authority: { publishing_authorized: true, preserve_copy_exactly: false } })
  );
  assert.equal(record.production_authority.publishing_authorized, false);
  assert.equal(record.production_authority.preserve_copy_exactly, true);
});

// --- Approval ------------------------------------------------------------

test("approval.approved is always true, approved_by/approved_at reflect the real upstream approval event, not ingestion time", () => {
  const record = createCarouselContentPackage(buildFields(), { now: () => "2099-01-01T00:00:00.000Z" });
  assert.equal(record.approval.approved, true);
  assert.equal(record.approval.approved_by, "chris@digitallyconnected.net");
  assert.equal(record.approval.approved_at, "2026-08-11T09:00:00.000Z");
  assert.notEqual(record.approval.approved_at, record.created_at);
});

test("throws InvalidCarouselContentPackageInputError when approvedBy is missing", () => {
  const fields = buildFields();
  delete fields.approvedBy;
  assert.throws(() => createCarouselContentPackage(fields), InvalidCarouselContentPackageInputError);
});

test("throws InvalidCarouselContentPackageInputError when approvedAt is missing", () => {
  const fields = buildFields();
  delete fields.approvedAt;
  assert.throws(() => createCarouselContentPackage(fields), InvalidCarouselContentPackageInputError);
});

// --- General required-field checks ---------------------------------------

for (const field of ["sourceArticleTitle", "industryName", "industrySeries", "carouselTitle", "schemaVersion"]) {
  test(`throws InvalidCarouselContentPackageInputError for a missing ${field}`, () => {
    const fields = buildFields({ [field]: "" });
    assert.throws(() => createCarouselContentPackage(fields), InvalidCarouselContentPackageInputError);
  });
}

test("sourceArticleReference defaults to null and accepts an explicit null", () => {
  const fields = buildFields();
  delete fields.sourceArticleReference;
  const record = createCarouselContentPackage(fields);
  assert.equal(record.source_article_reference, null);
});

test("throws CarouselContentPackageValidationError when the assembled record still fails schema validation", () => {
  const fakeValidator = { validate: () => ({ valid: false, errors: [{ path: "(root)", message: "forced failure" }] }) };
  assert.throws(() => createCarouselContentPackage(buildFields(), { validator: fakeValidator }), CarouselContentPackageValidationError);
});

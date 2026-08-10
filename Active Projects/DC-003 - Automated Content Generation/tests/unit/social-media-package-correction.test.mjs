// DC-003-I032.9 — regression coverage for correctSocialMediaPackageSlideField():
// pure, dependency-free, no filesystem/store/network involved. Mirrors
// carousel-approval.test.mjs's own "build a valid input, assert the
// transition" style.

import test from "node:test";
import assert from "node:assert/strict";
import { createSocialMediaPackage } from "../../src/social-media-package.mjs";
import { correctSocialMediaPackageSlideField } from "../../src/social-media-package-correction.mjs";
import {
  InvalidSocialMediaPackageCorrectionError,
  SocialMediaPackageCorrectionCapacityExceededError,
} from "../../src/social-media-package-errors.mjs";

function buildRecord(overrides = {}) {
  return createSocialMediaPackage(
    {
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
      schemaVersion: "1.5",
      ...overrides,
    },
    { idGenerator: () => "sm_correctiontest001" }
  );
}

test("corrects a slide's body — both carousel.slide_copy[i] and carousel.slides[i].body updated identically", () => {
  const record = buildRecord();
  // Deliberately a genuinely COMPLIANT replacement here (well within the
  // cta body's 67-char canonical limit) — this test checks the update
  // mechanics only. The real DC-003-I032.9 over-limit CTA string is
  // exercised separately, below, by the dedicated capacity-gate tests.
  const corrected = correctSocialMediaPackageSlideField({
    socialMediaPackage: record,
    slideNumber: 6, // cta
    field: "body",
    replacementText: "Audit your CRM for old enquiries.",
    reason: "Strategy Office authorisation — DC-003-I032.9",
  });

  assert.equal(corrected.carousel.slides[5].body, "Audit your CRM for old enquiries.");
  assert.equal(corrected.carousel.slide_copy[5], "Audit your CRM for old enquiries.");
});

test("corrects a slide's heading — both carousel.headings[i] and carousel.slides[i].heading updated identically", () => {
  const record = buildRecord();
  const corrected = correctSocialMediaPackageSlideField({
    socialMediaPackage: record,
    slideNumber: 1,
    field: "heading",
    replacementText: "A New Heading",
    reason: "test",
  });
  assert.equal(corrected.carousel.slides[0].heading, "A New Heading");
  assert.equal(corrected.carousel.headings[0], "A New Heading");
});

test("corrects a slide's imageGuidance — both carousel.image_guidance[i] and carousel.slides[i].image_guidance updated identically", () => {
  const record = buildRecord();
  const corrected = correctSocialMediaPackageSlideField({
    socialMediaPackage: record,
    slideNumber: 2,
    field: "imageGuidance",
    replacementText: "A completely different, much longer image guidance description that would never fit any real capacity limit if one existed for this field at all.",
    reason: "test",
  });
  assert.equal(
    corrected.carousel.slides[1].image_guidance,
    "A completely different, much longer image guidance description that would never fit any real capacity limit if one existed for this field at all."
  );
  assert.equal(
    corrected.carousel.image_guidance[1],
    "A completely different, much longer image guidance description that would never fit any real capacity limit if one existed for this field at all."
  );
});

test("never rewrites unrelated content — every other slide and every other field on the target slide are byte-identical", () => {
  const record = buildRecord();
  const corrected = correctSocialMediaPackageSlideField({
    socialMediaPackage: record,
    slideNumber: 6,
    field: "body",
    replacementText: "Short CTA.",
    reason: "test",
  });

  for (let i = 0; i < 5; i++) {
    assert.deepEqual(corrected.carousel.slides[i], record.carousel.slides[i]);
  }
  assert.equal(corrected.carousel.slides[5].heading, record.carousel.slides[5].heading);
  assert.equal(corrected.carousel.slides[5].image_guidance, record.carousel.slides[5].image_guidance);
  assert.equal(corrected.carousel.slides[5].slide_role, record.carousel.slides[5].slide_role);
  assert.equal(corrected.hook, record.hook);
  assert.equal(corrected.call_to_action, record.call_to_action);
  assert.equal(corrected.tone, record.tone);
  assert.equal(corrected.audience, record.audience);
  assert.equal(corrected.industry_context, record.industry_context);
  assert.deepEqual(corrected.platforms, record.platforms);
  assert.equal(corrected.social_media_package_id, record.social_media_package_id);
  assert.equal(corrected.editorial_package_id, record.editorial_package_id);
  assert.equal(corrected.revision, record.revision);
  assert.equal(corrected.supersedes, record.supersedes);
  assert.equal(corrected.generated_at, record.generated_at);
});

test("never mutates the input record", () => {
  const record = buildRecord();
  const originalBody = record.carousel.slides[5].body;
  correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: 6, field: "body", replacementText: "Different.", reason: "test" });
  assert.equal(record.carousel.slides[5].body, originalBody);
});

test("appends exactly one entry to corrections, recording slide_number/field/previous_value/corrected_value/reason", () => {
  const record = buildRecord();
  const corrected = correctSocialMediaPackageSlideField({
    socialMediaPackage: record,
    slideNumber: 6,
    field: "body",
    replacementText: "New CTA body.",
    reason: "CEO-authorised correction",
  });

  assert.equal(corrected.corrections.length, 1);
  assert.deepEqual(corrected.corrections[0], {
    slide_number: 6,
    field: "body",
    previous_value: "S6",
    corrected_value: "New CTA body.",
    corrected_at: corrected.corrections[0].corrected_at,
    reason: "CEO-authorised correction",
  });
});

test("a second correction appends a second entry, never overwriting or removing the first", () => {
  const record = buildRecord();
  const first = correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: 6, field: "body", replacementText: "First fix.", reason: "one" });
  const second = correctSocialMediaPackageSlideField({ socialMediaPackage: first, slideNumber: 1, field: "heading", replacementText: "Second fix.", reason: "two" });

  assert.equal(second.corrections.length, 2);
  assert.equal(second.corrections[0].reason, "one");
  assert.equal(second.corrections[1].reason, "two");
});

test("recomputes checksum — differs from the input's own checksum", () => {
  const record = buildRecord();
  const corrected = correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: 6, field: "body", replacementText: "Different.", reason: "test" });
  assert.notEqual(corrected.checksum, record.checksum);
  assert.match(corrected.checksum, /^[a-f0-9]{64}$/);
});

test("returns an immutable (deep-frozen) record", () => {
  const record = buildRecord();
  const corrected = correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: 6, field: "body", replacementText: "Different.", reason: "test" });
  assert.throws(() => {
    corrected.hook = "changed";
  }, TypeError);
});

// --- Template Capacity Contract gate — never bypassable ----------------
// Direct regression coverage for the real DC-003-I032.9 finding: the
// CEO-authorised replacement text for sm_3b859b1d314c4c41's own CTA body
// ("Find old appraisal, buyer & landlord enquiries with no recent
// follow-up.", 72 characters) genuinely exceeds the canonical CTA body
// limit (67 characters, template-capacity-contract.mjs) — this is the
// exact real string, not a synthetic stand-in.

test("rejects a replacement that exceeds the Template Capacity Contract's own canonical limit for that slide role + field", () => {
  const record = buildRecord();
  assert.throws(
    () =>
      correctSocialMediaPackageSlideField({
        socialMediaPackage: record,
        slideNumber: 6, // cta — body max 67 chars
        field: "body",
        replacementText: "Find old appraisal, buyer & landlord enquiries with no recent follow-up.", // 72 chars
        reason: "test",
      }),
    SocialMediaPackageCorrectionCapacityExceededError
  );
});

test("the capacity error names the exact slide/field/length/limit, and applies nothing", () => {
  const record = buildRecord();
  try {
    correctSocialMediaPackageSlideField({
      socialMediaPackage: record,
      slideNumber: 6,
      field: "body",
      replacementText: "Find old appraisal, buyer & landlord enquiries with no recent follow-up.",
      reason: "test",
    });
    assert.fail("expected SocialMediaPackageCorrectionCapacityExceededError");
  } catch (error) {
    assert.ok(error instanceof SocialMediaPackageCorrectionCapacityExceededError);
    assert.equal(error.slideNumber, 6);
    assert.equal(error.slideRole, "cta");
    assert.equal(error.field, "body");
    assert.equal(error.length, 72);
    assert.equal(error.maxChars, 67);
  }
});

test("a replacement exactly AT the canonical limit is accepted (boundary is inclusive)", () => {
  const record = buildRecord();
  const exactly67Chars = "x".repeat(67);
  const corrected = correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: 6, field: "body", replacementText: exactly67Chars, reason: "test" });
  assert.equal(corrected.carousel.slides[5].body, exactly67Chars);
});

test("a genuinely compliant, shorter replacement for the same slide/field succeeds", () => {
  const record = buildRecord();
  const corrected = correctSocialMediaPackageSlideField({
    socialMediaPackage: record,
    slideNumber: 6,
    field: "body",
    replacementText: "Audit your CRM today.",
    reason: "test",
  });
  assert.equal(corrected.carousel.slides[5].body, "Audit your CRM today.");
  assert.equal(corrected.corrections.length, 1);
});

test("imageGuidance has no canonical capacity entry — an arbitrarily long replacement is never rejected on capacity grounds", () => {
  const record = buildRecord();
  const longText = "A".repeat(500);
  const corrected = correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: 6, field: "imageGuidance", replacementText: longText, reason: "test" });
  assert.equal(corrected.carousel.slides[5].image_guidance, longText);
});

// --- Input validation — thrown before any mutation ----------------------

test("throws InvalidSocialMediaPackageCorrectionError for a malformed socialMediaPackage", () => {
  assert.throws(() => correctSocialMediaPackageSlideField({ socialMediaPackage: null, slideNumber: 1, field: "heading", replacementText: "x", reason: "y" }), InvalidSocialMediaPackageCorrectionError);
});

for (const badSlideNumber of [0, 7, -1, 1.5, "1", null, undefined]) {
  test(`throws InvalidSocialMediaPackageCorrectionError for slideNumber ${JSON.stringify(badSlideNumber)}`, () => {
    const record = buildRecord();
    assert.throws(
      () => correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: badSlideNumber, field: "heading", replacementText: "x", reason: "y" }),
      InvalidSocialMediaPackageCorrectionError
    );
  });
}

for (const badField of ["quote", "statistic", "keyPoints", "callToAction", "platforms", "", null, undefined]) {
  test(`throws InvalidSocialMediaPackageCorrectionError for an unsupported field ${JSON.stringify(badField)}`, () => {
    const record = buildRecord();
    assert.throws(
      () => correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: 1, field: badField, replacementText: "x", reason: "y" }),
      InvalidSocialMediaPackageCorrectionError
    );
  });
}

test("throws InvalidSocialMediaPackageCorrectionError for a blank replacementText", () => {
  const record = buildRecord();
  assert.throws(
    () => correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: 1, field: "heading", replacementText: "  ", reason: "y" }),
    InvalidSocialMediaPackageCorrectionError
  );
});

test("throws InvalidSocialMediaPackageCorrectionError for a missing/blank reason — the audit trail can never be skipped", () => {
  const record = buildRecord();
  assert.throws(
    () => correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: 1, field: "heading", replacementText: "x", reason: "" }),
    InvalidSocialMediaPackageCorrectionError
  );
  assert.throws(
    () => correctSocialMediaPackageSlideField({ socialMediaPackage: record, slideNumber: 1, field: "heading", replacementText: "x" }),
    InvalidSocialMediaPackageCorrectionError
  );
});

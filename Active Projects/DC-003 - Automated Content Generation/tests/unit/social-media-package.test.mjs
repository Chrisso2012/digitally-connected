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

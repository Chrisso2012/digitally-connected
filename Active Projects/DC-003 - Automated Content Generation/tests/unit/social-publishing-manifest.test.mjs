import test from "node:test";
import assert from "node:assert/strict";
import { createSocialPublishingManifest } from "../../src/social-publishing-manifest.mjs";
import { InvalidSocialPublishingManifestInputError, SocialPublishingManifestValidationError } from "../../src/social-publishing-manifest-errors.mjs";

function validFields(overrides = {}) {
  return {
    carouselId: "car_manifesttest0001",
    assetPackageId: "pkg_manifesttest0001",
    approvedBy: "chris@digitallyconnected.net",
    instagram: { enabled: true, caption: "Approved IG caption", altText: "Approved alt text" },
    linkedin: { enabled: false },
    ...overrides,
  };
}

// --- successful construction, immutability, determinism ------------------

test("builds a valid, schema-conforming, already-approved manifest", () => {
  const manifest = createSocialPublishingManifest(validFields(), {
    now: () => "2026-08-05T12:00:00.000Z",
    idGenerator: () => "spm_deterministictest01",
  });
  assert.equal(manifest.manifest_id, "spm_deterministictest01");
  assert.equal(manifest.carousel_id, "car_manifesttest0001");
  assert.equal(manifest.asset_package_id, "pkg_manifesttest0001");
  assert.equal(manifest.created_at, "2026-08-05T12:00:00.000Z");
  assert.equal(manifest.approval.approved, true);
  assert.equal(manifest.approval.approved_by, "chris@digitallyconnected.net");
  assert.equal(manifest.approval.approved_at, "2026-08-05T12:00:00.000Z");
  assert.equal(manifest.destinations.instagram.enabled, true);
  assert.equal(manifest.destinations.instagram.caption, "Approved IG caption");
  assert.equal(manifest.destinations.linkedin.enabled, false);
  assert.equal(manifest.destinations.linkedin.commentary, null);
});

test("returns a fully frozen (immutable) object, including nested sub-objects", () => {
  const manifest = createSocialPublishingManifest(validFields());
  assert.throws(() => {
    manifest.approval.approved = false;
  }, TypeError);
  assert.throws(() => {
    manifest.destinations.instagram.caption = "rewritten";
  }, TypeError);
});

test("never rewrites or normalises the supplied caption/commentary — stored verbatim", () => {
  const weirdCaption = "  Weird   spacing\nand a newline — approved as-is 🎉  ";
  const manifest = createSocialPublishingManifest(validFields({ instagram: { enabled: true, caption: weirdCaption, altText: "alt" } }));
  assert.equal(manifest.destinations.instagram.caption, weirdCaption);
});

test("generates a unique manifest_id per call when no idGenerator is injected", () => {
  const a = createSocialPublishingManifest(validFields());
  const b = createSocialPublishingManifest(validFields());
  assert.notEqual(a.manifest_id, b.manifest_id);
  assert.match(a.manifest_id, /^spm_[A-Za-z0-9]+$/);
});

// --- composition-only input validation ---------------------------------

for (const field of ["carouselId", "assetPackageId", "approvedBy"]) {
  test(`throws InvalidSocialPublishingManifestInputError when ${field} is missing`, () => {
    const fields = validFields();
    delete fields[field];
    assert.throws(() => createSocialPublishingManifest(fields), InvalidSocialPublishingManifestInputError);
  });

  test(`throws InvalidSocialPublishingManifestInputError when ${field} is a blank string`, () => {
    assert.throws(() => createSocialPublishingManifest(validFields({ [field]: "   " })), InvalidSocialPublishingManifestInputError);
  });
}

test("throws InvalidSocialPublishingManifestInputError when instagram/linkedin fields are not plain objects", () => {
  assert.throws(() => createSocialPublishingManifest(validFields({ instagram: "not an object" })), InvalidSocialPublishingManifestInputError);
  assert.throws(() => createSocialPublishingManifest(validFields({ linkedin: "not an object" })), InvalidSocialPublishingManifestInputError);
});

// --- schema validation: the real repository-evidence gap this manifest closes

test("throws SocialPublishingManifestValidationError when no destination is enabled", () => {
  assert.throws(
    () => createSocialPublishingManifest(validFields({ instagram: { enabled: false }, linkedin: { enabled: false } })),
    SocialPublishingManifestValidationError
  );
});

test("throws SocialPublishingManifestValidationError when Instagram is enabled with no caption", () => {
  assert.throws(
    () => createSocialPublishingManifest(validFields({ instagram: { enabled: true }, linkedin: { enabled: false } })),
    SocialPublishingManifestValidationError
  );
});

test("throws SocialPublishingManifestValidationError when LinkedIn is enabled with no commentary", () => {
  assert.throws(
    () => createSocialPublishingManifest(validFields({ instagram: { enabled: false }, linkedin: { enabled: true } })),
    SocialPublishingManifestValidationError
  );
});

test("both destinations enabled with their own approved copy validates successfully", () => {
  const manifest = createSocialPublishingManifest(
    validFields({ instagram: { enabled: true, caption: "IG", altText: "alt" }, linkedin: { enabled: true, commentary: "LI commentary" } })
  );
  assert.equal(manifest.destinations.instagram.enabled, true);
  assert.equal(manifest.destinations.linkedin.enabled, true);
});

test("carries no platform credentials and no raw image data — the object has exactly the documented top-level fields", () => {
  const manifest = createSocialPublishingManifest(validFields());
  assert.deepEqual(
    Object.keys(manifest).sort(),
    ["manifest_id", "carousel_id", "asset_package_id", "created_at", "approval", "destinations"].sort()
  );
});

// DC-003-I032.7 — regression coverage for the Social Media Package
// historical schema archive: the direct fix for sm_cb4c4bcf72b14c9f
// being falsely reported as corrupted merely because the CURRENT schema
// evolved (added `industry_context` as required) after that record was
// genuinely, honestly persisted under schema_version "1.1".

import test from "node:test";
import assert from "node:assert/strict";
import { createSocialMediaPackageSchemaHistory, applyCompatibilityView } from "../../src/social-media-package-schema-history.mjs";

function buildTextVariation(text) {
  return { post_text: text, hashtags: [], character_count: text.length };
}

// A genuine, minimal 1.1-shaped record — every field 1.1's own real
// archived schema requires, nothing 1.1 didn't have yet (no
// industry_context, additionalProperties:false at every level of that
// version). Mirrors the real sm_cb4c4bcf72b14c9f record's own shape.
function buildV11Record(overrides = {}) {
  return {
    social_media_package_id: "sm_historicaltest0001",
    editorial_package_id: "ep_a1b2c3d4e5f60708",
    status: "generated",
    hook: "H",
    call_to_action: "CTA",
    tone: "T",
    audience: "A",
    platforms: {
      linkedin: buildTextVariation("L"),
      facebook: buildTextVariation("F"),
      x: buildTextVariation("X"),
      instagram: { caption: "I", hashtags: [], character_count: 1 },
    },
    carousel: {
      headings: ["H1", "H2", "H3", "H4", "H5", "H6"],
      slide_copy: ["S1", "S2", "S3", "S4", "S5", "S6"],
      image_guidance: ["G1", "G2", "G3", "G4", "G5", "G6"],
      slides: ["cover", "insight", "statistic", "quote", "takeaway", "cta"].map((role, i) => ({
        slide_number: i + 1,
        slide_role: role,
        heading: `H${i + 1}`,
        body: `S${i + 1}`,
        image_guidance: `G${i + 1}`,
        statistic: role === "statistic" ? { value: "50%", context: "S3" } : null,
        quote: role === "quote" ? { quote_text: "S4" } : null,
        key_points: role === "takeaway" ? ["S5"] : [],
      })),
    },
    metadata: null,
    generated_at: "2026-01-01T00:00:00.000Z",
    llm_model: "mock-social-media-provider-v1",
    prompt_version: "social-media-package.v1",
    schema_version: "1.1",
    checksum: "0".repeat(64),
    ...overrides,
  };
}

// A genuine, minimal 1.0-shaped record — 1.0's own real archived schema
// has no `carousel.slides` field at all (additionalProperties:false on
// that object), so this is deliberately a DIFFERENT shape from 1.1, not
// just buildV11Record() with one field removed.
function buildV10Record(overrides = {}) {
  return {
    social_media_package_id: "sm_historicaltest0002",
    editorial_package_id: "ep_a1b2c3d4e5f60708",
    status: "generated",
    hook: "H",
    call_to_action: "CTA",
    tone: "T",
    audience: "A",
    platforms: {
      linkedin: buildTextVariation("L"),
      facebook: buildTextVariation("F"),
      x: buildTextVariation("X"),
      instagram: { caption: "I", hashtags: [], character_count: 1 },
    },
    carousel: {
      headings: ["H1", "H2", "H3", "H4", "H5", "H6"],
      slide_copy: ["S1", "S2", "S3", "S4", "S5", "S6"],
      image_guidance: ["G1", "G2", "G3", "G4", "G5", "G6"],
    },
    metadata: null,
    generated_at: "2026-01-01T00:00:00.000Z",
    llm_model: "mock-social-media-provider-v1",
    prompt_version: "social-media-package.v1",
    schema_version: "1.0",
    checksum: "0".repeat(64),
    ...overrides,
  };
}

// --- One canonical, disclosed set of known historical versions --------

test("knows exactly the three retired versions (1.0, 1.1, 1.2) — 1.3 is current, not archived here", () => {
  const history = createSocialMediaPackageSchemaHistory();
  assert.deepEqual(history.knownVersions, ["1.0", "1.1", "1.2"]);
});

test("isKnownHistoricalVersion() is true only for archived versions", () => {
  const history = createSocialMediaPackageSchemaHistory();
  assert.equal(history.isKnownHistoricalVersion("1.0"), true);
  assert.equal(history.isKnownHistoricalVersion("1.1"), true);
  assert.equal(history.isKnownHistoricalVersion("1.2"), true);
  assert.equal(history.isKnownHistoricalVersion("1.3"), false, "1.3 is current, not archived — the store's own current-schema path handles it");
  assert.equal(history.isKnownHistoricalVersion("9.9"), false);
  assert.equal(history.isKnownHistoricalVersion(undefined), false);
});

// --- A historical record validates under its own schema version -------

test("a genuine 1.1-shaped record (no industry_context, matching the real sm_cb4c4bcf72b14c9f) validates against archived schema 1.1", () => {
  const history = createSocialMediaPackageSchemaHistory();
  const result = history.validate("1.1", buildV11Record());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("a genuine 1.0-shaped record (no carousel.slides at all) validates against archived schema 1.0", () => {
  const history = createSocialMediaPackageSchemaHistory();
  const result = history.validate("1.0", buildV10Record());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

// --- Not falsely marked corrupted for a field that did not previously
// exist — the direct regression test for the actual defect -------------

test("a 1.1-shaped record is NOT falsely rejected for lacking industry_context — that field did not exist in schema 1.1", () => {
  const history = createSocialMediaPackageSchemaHistory();
  const record = buildV11Record();
  assert.equal("industry_context" in record, false);
  const result = history.validate("1.1", record);
  assert.equal(result.valid, true);
});

test("conversely, a 1.1-shaped record WOULD fail if it declared itself 1.2 without industry_context — proving the check is genuinely version-specific, not merely lenient", () => {
  const history = createSocialMediaPackageSchemaHistory();
  const result = history.validate("1.2", buildV11Record({ schema_version: "1.2" }));
  assert.equal(result.valid, false);
});

// --- A genuinely corrupted historical record still fails ---------------

test("a genuinely malformed 1.1 record (missing a real required field for THAT version) still fails — version-awareness never means lenient", () => {
  const history = createSocialMediaPackageSchemaHistory();
  const { hook, ...withoutHook } = buildV11Record();
  const result = history.validate("1.1", withoutHook);
  assert.equal(result.valid, false);
});

test("a 1.0 record with a slide_role value 1.0 never had (e.g. carousel.slides at all) still fails 1.0's own real schema", () => {
  const history = createSocialMediaPackageSchemaHistory();
  const record = { ...buildV10Record(), carousel: { ...buildV10Record().carousel, slides: [] } };
  const result = history.validate("1.0", record);
  assert.equal(result.valid, false, "1.0's own real carousel object has additionalProperties:false and no slides property at all");
});

// --- Unknown/unsupported version fails explicitly (validate() itself) -

test("validate() throws for a version this archive does not know — a caller bug, mirrors validator.mjs's own UnknownSchemaError discipline", () => {
  const history = createSocialMediaPackageSchemaHistory();
  assert.throws(() => history.validate("9.9", buildV11Record()), RangeError);
});

// --- Compatibility view: additive only, never overwrites, never
// touches a version at or after the field's own introduction ----------

test('applyCompatibilityView() adds industry_context: null for a version before 1.2 (the version that introduced it)', () => {
  const record = buildV11Record();
  const view = applyCompatibilityView(record, "1.1");
  assert.equal(view.industry_context, null);
});

test("applyCompatibilityView() does not mutate the original record — a new object only", () => {
  const record = buildV11Record();
  const view = applyCompatibilityView(record, "1.1");
  assert.equal("industry_context" in record, false, "the original object passed in must remain untouched");
  assert.notEqual(view, record);
});

test("applyCompatibilityView() never overwrites a genuinely present value, even on an older version", () => {
  const record = buildV11Record({ industry_context: "Should never happen, but if present, must never be clobbered" });
  const view = applyCompatibilityView(record, "1.1");
  assert.equal(view.industry_context, "Should never happen, but if present, must never be clobbered");
});

test('applyCompatibilityView()\'s own "before" boundary is exact — at version 1.2 itself (not merely "1.2 or later"), the field is never backfilled', () => {
  // Deliberately calling this pure function in isolation with data that
  // would never reach it through the real store (which validates the
  // schema FIRST, so a genuine 1.2 record always already has
  // industry_context) — this exercises applyCompatibilityView()'s own
  // exact version-comparison boundary, not a realistic end-to-end case.
  const recordMissingTheFieldAnyway = buildV11Record({ schema_version: "1.2" });
  const view = applyCompatibilityView(recordMissingTheFieldAnyway, "1.2");
  assert.equal(view, recordMissingTheFieldAnyway, 'version "1.2" is not BEFORE "1.2" — the exact same reference is returned, no backfill attempted');
});

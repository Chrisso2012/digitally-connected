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

// A genuine, minimal 1.2-shaped record — has industry_context (added at
// 1.2) but no revision/supersedes (added at 1.4).
function buildV12Record(overrides = {}) {
  return {
    ...buildV11Record(),
    social_media_package_id: "sm_historicaltest0003",
    industry_context: null,
    schema_version: "1.2",
    ...overrides,
  };
}

// A genuine, minimal 1.3-shaped record (DC-003-I032.6's own shape — the
// real sm_cb4c4bcf72b14c9f/pp_95be2c6a4b424803/car_3479ca8ac2af40b8
// lineage was generated under this version) — has industry_context, the
// "evidence" slide_role, but no revision/supersedes (added at 1.4).
function buildV13Record(overrides = {}) {
  return {
    ...buildV12Record(),
    social_media_package_id: "sm_historicaltest0004",
    schema_version: "1.3",
    ...overrides,
  };
}

// --- One canonical, disclosed set of known historical versions --------

test("knows exactly the four retired versions (1.0, 1.1, 1.2, 1.3) — 1.4 is current, not archived here", () => {
  const history = createSocialMediaPackageSchemaHistory();
  assert.deepEqual(history.knownVersions, ["1.0", "1.1", "1.2", "1.3"]);
});

test("isKnownHistoricalVersion() is true only for archived versions", () => {
  const history = createSocialMediaPackageSchemaHistory();
  assert.equal(history.isKnownHistoricalVersion("1.0"), true);
  assert.equal(history.isKnownHistoricalVersion("1.1"), true);
  assert.equal(history.isKnownHistoricalVersion("1.2"), true);
  assert.equal(history.isKnownHistoricalVersion("1.3"), true);
  assert.equal(history.isKnownHistoricalVersion("1.4"), false, "1.4 is current, not archived — the store's own current-schema path handles it");
  assert.equal(history.isKnownHistoricalVersion("9.9"), false);
  assert.equal(history.isKnownHistoricalVersion(undefined), false);
});

test("a genuine 1.2-shaped record (has industry_context, no revision/supersedes) validates against archived schema 1.2", () => {
  const history = createSocialMediaPackageSchemaHistory();
  const result = history.validate("1.2", buildV12Record());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("a genuine 1.3-shaped record (the real sm_cb4c4bcf72b14c9f lineage's own shape) validates against archived schema 1.3", () => {
  const history = createSocialMediaPackageSchemaHistory();
  const result = history.validate("1.3", buildV13Record());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("a 1.3-shaped record is NOT falsely rejected for lacking revision/supersedes — those fields did not exist in schema 1.3", () => {
  const history = createSocialMediaPackageSchemaHistory();
  const record = buildV13Record();
  assert.equal("revision" in record, false);
  assert.equal("supersedes" in record, false);
  const result = history.validate("1.3", record);
  assert.equal(result.valid, true);
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

test('applyCompatibilityView()\'s own "before" boundary is exact — at version 1.2 itself (not merely "1.2 or later"), industry_context is never backfilled', () => {
  // Deliberately calling this pure function in isolation with data that
  // would never reach it through the real store (which validates the
  // schema FIRST, so a genuine 1.2 record always already has
  // industry_context) — this exercises applyCompatibilityView()'s own
  // exact version-comparison boundary, not a realistic end-to-end case.
  // revision/supersedes are supplied explicitly here (DC-003-I032.8) so
  // THIS test isolates the industry_context boundary specifically — a
  // genuine 1.2 record predates 1.4 too and would otherwise still get
  // those two fields backfilled, which is correct behaviour but not what
  // this particular test is checking (see the dedicated 1.2/1.3
  // revision-backfill tests below instead).
  const recordMissingTheFieldAnyway = buildV11Record({ schema_version: "1.2", revision: 1, supersedes: null });
  const view = applyCompatibilityView(recordMissingTheFieldAnyway, "1.2");
  assert.equal(view, recordMissingTheFieldAnyway, 'version "1.2" is not BEFORE "1.2" — the exact same reference is returned, no backfill attempted');
});

// --- DC-003-I032.8 — revision/supersedes compatibility view -----------
// Direct regression coverage for the real sm_cb4c4bcf72b14c9f (schema
// 1.3, no revision/supersedes at all): must appear as revision: 1,
// supersedes: null in memory, never guessed to be anything else, never
// written back.

test("applyCompatibilityView() adds revision: 1, supersedes: null for a version before 1.4 (the version that introduced them)", () => {
  const record = buildV13Record();
  const view = applyCompatibilityView(record, "1.3");
  assert.equal(view.revision, 1);
  assert.equal(view.supersedes, null);
});

test("applyCompatibilityView() adds revision/supersedes for every earlier version too (1.0, 1.1, 1.2), not only 1.3", () => {
  assert.equal(applyCompatibilityView(buildV10Record(), "1.0").revision, 1);
  assert.equal(applyCompatibilityView(buildV11Record(), "1.1").revision, 1);
  assert.equal(applyCompatibilityView(buildV12Record(), "1.2").revision, 1);
});

test("applyCompatibilityView() never overwrites a genuinely present revision/supersedes, even on an older version", () => {
  const record = buildV13Record({ revision: 7, supersedes: "sm_shouldneverbeclobbered" });
  const view = applyCompatibilityView(record, "1.3");
  assert.equal(view.revision, 7);
  assert.equal(view.supersedes, "sm_shouldneverbeclobbered");
});

test("applyCompatibilityView() does not mutate the original 1.3 record — a new object only", () => {
  const record = buildV13Record();
  const view = applyCompatibilityView(record, "1.3");
  assert.equal("revision" in record, false);
  assert.equal("supersedes" in record, false);
  assert.notEqual(view, record);
});

test('applyCompatibilityView()\'s "before" boundary for revision/supersedes is exact at 1.4 — never backfilled at or after 1.4', () => {
  const recordMissingFieldsAnyway = buildV13Record({ schema_version: "1.4" });
  const view = applyCompatibilityView(recordMissingFieldsAnyway, "1.4");
  assert.equal(view, recordMissingFieldsAnyway, 'version "1.4" is not BEFORE "1.4" — no backfill attempted');
});

test("applyCompatibilityView() combines industry_context AND revision/supersedes backfill correctly for a pre-1.2 (1.0/1.1) record", () => {
  const view = applyCompatibilityView(buildV11Record(), "1.1");
  assert.equal(view.industry_context, null);
  assert.equal(view.revision, 1);
  assert.equal(view.supersedes, null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSocialMediaPackageStore } from "../../src/social-media-package-store.mjs";
import { createLocalJsonSocialMediaPackageStoreAdapter } from "../../src/local-json-social-media-package-store-adapter.mjs";
import { createSocialMediaPackage } from "../../src/social-media-package.mjs";
import { correctSocialMediaPackageSlideField } from "../../src/social-media-package-correction.mjs";
import { loadVersions } from "../../src/config-loader.mjs";
import {
  InvalidSocialMediaPackageStoreAdapterError,
  InvalidSocialMediaPackageIdentifierError,
  SocialMediaPackageAlreadyExistsError,
  SocialMediaPackageNotFoundError,
  CorruptedSocialMediaPackageError,
  UnsupportedSchemaVersionError,
  MalformedSocialMediaPackageLineageError,
  SocialMediaPackageIdentifierMismatchError,
} from "../../src/social-media-package-errors.mjs";

// DC-003-I032.7 — the store now validates a stored record against the
// schema_version it actually declares (see social-media-package-store.mjs's
// own header comment). Every fixture in this file is shaped like a
// CURRENT-schema record, so it must declare the real current version —
// never a stale hardcoded string — or the store correctly (and
// intentionally) rejects it as not matching its own declared version.
const CURRENT_SOCIAL_MEDIA_PACKAGE_SCHEMA_VERSION = loadVersions().schema_versions.social_media_package;

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-social-media-package-store-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createSocialMediaPackageStore({ adapter: createLocalJsonSocialMediaPackageStoreAdapter({ storageDir }) });
}

function buildRecord(overrides = {}, options = {}) {
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
      schemaVersion: CURRENT_SOCIAL_MEDIA_PACKAGE_SCHEMA_VERSION,
      ...overrides,
    },
    options
  );
}

test("throws InvalidSocialMediaPackageStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createSocialMediaPackageStore({ adapter: { name: "x" } }), InvalidSocialMediaPackageStoreAdapterError);
});

test("save() persists a valid record and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const saved = store.save(buildRecord({}, { idGenerator: () => "sm_savetest00000001" }));
    assert.equal(saved.social_media_package_id, "sm_savetest00000001");
    assert.throws(() => {
      saved.hook = "changed";
    }, TypeError);
  }));

test("save() rejects a second save for the same social_media_package_id", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "sm_duplicatetest001";
    store.save(buildRecord({}, { idGenerator: idGen }));
    assert.throws(() => store.save(buildRecord({}, { idGenerator: idGen })), SocialMediaPackageAlreadyExistsError);
  }));

test("get() retrieves a stored record; throws for missing/invalid identifiers", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ hook: "Findable" }, { idGenerator: () => "sm_gettest000000001" }));
    assert.equal(store.get("sm_gettest000000001").hook, "Findable");
    assert.throws(() => store.get("sm_doesnotexist00001"), SocialMediaPackageNotFoundError);
    assert.throws(() => store.get("../../etc/passwd"), InvalidSocialMediaPackageIdentifierError);
  }));

test("exists() reflects save() and is false for an unknown identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.equal(store.exists("sm_existstest0000001"), false);
    store.save(buildRecord({}, { idGenerator: () => "sm_existstest0000001" }));
    assert.equal(store.exists("sm_existstest0000001"), true);
  }));

test("list() returns safe summaries ordered chronologically by generated_at", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ editorialPackageId: "ep_bbbbbbbbbbbbbbbb", hook: "Second" }, { idGenerator: () => "sm_second0000000001", now: () => "2026-08-07T11:00:00.000Z" }));
    store.save(buildRecord({ editorialPackageId: "ep_aaaaaaaaaaaaaaaa", hook: "First" }, { idGenerator: () => "sm_first00000000001", now: () => "2026-08-07T10:00:00.000Z" }));
    const summaries = store.list();
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].hook, "First");
    assert.equal(summaries[1].hook, "Second");
    assert.equal(summaries[0].platforms, undefined);
  }));

test("findByEditorialPackageId() returns only matching full records, ordered chronologically", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ editorialPackageId: "ep_aaaaaaaaaaaaaaaa" }, { idGenerator: () => "sm_aaaaaaaaaaaaaaaa", now: () => "2026-08-07T10:00:00.000Z" }));
    store.save(buildRecord({ editorialPackageId: "ep_bbbbbbbbbbbbbbbb" }, { idGenerator: () => "sm_bbbbbbbbbbbbbbbb" }));

    const matches = store.findByEditorialPackageId("ep_aaaaaaaaaaaaaaaa");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].social_media_package_id, "sm_aaaaaaaaaaaaaaaa");
    assert.equal(store.findByEditorialPackageId("ep_cccccccccccccccc").length, 0);
  }));

// --- DC-003-I032.7 — version-aware historical readability -------------
// Direct regression coverage for sm_cb4c4bcf72b14c9f: a genuine,
// honestly-persisted 1.1-shaped record (no industry_context — that field
// did not exist in schema 1.1) must remain readable, must reach the
// duplicate-protection decision, and must never have its own bytes on
// disk altered by any of this.

function buildTextVariation(text) {
  return { post_text: text, hashtags: [], character_count: text.length };
}

// A genuine, minimal 1.1-shaped RAW record — written directly via the
// adapter (never through createSocialMediaPackage(), which always
// produces a CURRENT-shape object) to simulate an authentic historical
// file, exactly like sm_cb4c4bcf72b14c9f itself.
function buildV11StoredRecord(overrides = {}) {
  return {
    social_media_package_id: "sm_historicalstore001",
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

test("get() reads a genuine 1.1-shaped historical record (no industry_context) without falsely reporting it corrupted", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    adapter.write("sm_historicalstore001", JSON.stringify(buildV11StoredRecord()));
    const store = createSocialMediaPackageStore({ adapter });

    const record = store.get("sm_historicalstore001");
    assert.equal(record.schema_version, "1.1");
  }));

test('get() exposes a compatibility view (industry_context: null) for the 1.1 record — added only in memory', () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    adapter.write("sm_historicalstore001", JSON.stringify(buildV11StoredRecord()));
    const store = createSocialMediaPackageStore({ adapter });

    const record = store.get("sm_historicalstore001");
    assert.equal(record.industry_context, null);
  }));

test("the persisted historical bytes on disk remain byte-for-byte unchanged after being read — no compatibility field is ever written back", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    const rawContent = JSON.stringify(buildV11StoredRecord());
    adapter.write("sm_historicalstore001", rawContent);
    const store = createSocialMediaPackageStore({ adapter });

    store.get("sm_historicalstore001"); // triggers the compatibility view
    store.list(); // and again via a different read path
    store.findByEditorialPackageId("ep_a1b2c3d4e5f60708"); // and again

    const rawAfter = adapter.read("sm_historicalstore001");
    assert.equal(rawAfter, rawContent, "raw bytes on disk must be identical to what was originally written");
    assert.doesNotMatch(rawAfter, /industry_context/, "the historical file itself must never gain the field the compatibility view adds only in memory");
  }));

test("current-schema records still validate against the current schema exactly as before — this correction never loosens current validation", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const saved = store.save(buildRecord({}, { idGenerator: () => "sm_currenttest0000001" }));
    assert.equal(saved.schema_version, CURRENT_SOCIAL_MEDIA_PACKAGE_SCHEMA_VERSION);
    const record = store.get("sm_currenttest0000001");
    assert.equal(record.social_media_package_id, "sm_currenttest0000001");
  }));

test("a genuinely corrupted historical record (missing a field 1.1 itself actually required) still fails as corrupted — version-awareness is never lenient", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    const { hook, ...withoutHook } = buildV11StoredRecord();
    adapter.write("sm_historicalstore001", JSON.stringify(withoutHook));
    const store = createSocialMediaPackageStore({ adapter });

    assert.throws(() => store.get("sm_historicalstore001"), CorruptedSocialMediaPackageError);
  }));

test("a record declaring an unknown/unsupported schema_version fails explicitly — never silently treated as valid or as ordinary corruption", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    adapter.write("sm_historicalstore001", JSON.stringify(buildV11StoredRecord({ schema_version: "9.9" })));
    const store = createSocialMediaPackageStore({ adapter });

    try {
      store.get("sm_historicalstore001");
      assert.fail("expected UnsupportedSchemaVersionError");
    } catch (error) {
      assert.ok(error instanceof UnsupportedSchemaVersionError);
      assert.ok(!(error instanceof CorruptedSocialMediaPackageError), "an unrecognised version is a distinct failure mode, not ordinary corruption");
      assert.equal(error.version, "9.9");
    }
  }));

test("duplicate-protection lookup (findByEditorialPackageId) can now execute successfully against a store containing a historical record", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    adapter.write("sm_historicalstore001", JSON.stringify(buildV11StoredRecord()));
    const store = createSocialMediaPackageStore({ adapter });

    const matches = store.findByEditorialPackageId("ep_a1b2c3d4e5f60708");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].social_media_package_id, "sm_historicalstore001");
  }));

test("list() also succeeds against a store mixing one historical and one current record — the read path that previously threw for the whole directory", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    adapter.write("sm_historicalstore001", JSON.stringify(buildV11StoredRecord()));
    const store = createSocialMediaPackageStore({ adapter });
    store.save(buildRecord({ editorialPackageId: "ep_bbbbbbbbbbbbbbbb" }, { idGenerator: () => "sm_currenttest0000002" }));

    const summaries = store.list();
    assert.equal(summaries.length, 2);
  }));

// --- DC-003-I032.8 — revision-lineage historical compatibility --------
// The real sm_cb4c4bcf72b14c9f (and every other pre-1.4 record) has no
// revision/supersedes fields on disk at all. Direct regression coverage
// that the store's compatibility view backfills exactly revision: 1,
// supersedes: null — never guessed, never written back.

test("get() exposes revision: 1, supersedes: null for a pre-lineage (1.1-shaped) historical record — added only in memory", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    adapter.write("sm_historicalstore001", JSON.stringify(buildV11StoredRecord()));
    const store = createSocialMediaPackageStore({ adapter });

    const record = store.get("sm_historicalstore001");
    assert.equal(record.revision, 1);
    assert.equal(record.supersedes, null);
    assert.equal("revision" in JSON.parse(adapter.read("sm_historicalstore001")), false, "revision must never be written back to the historical file");
  }));

// --- DC-003-I032.8 — getLineage() / findLatestRevision() --------------

test("getLineage() returns an empty chain and null latest when no Social Media Package exists for the Editorial Package", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const lineage = store.getLineage("ep_doesnotexist00001");
    assert.deepEqual(lineage.chain, []);
    assert.equal(lineage.latest, null);
  }));

test("getLineage() returns a single-entry chain (is_latest: true) for an ordinary first-ever record", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({}, { idGenerator: () => "sm_lineagev1000001" }));

    const lineage = store.getLineage("ep_a1b2c3d4e5f60708");
    assert.equal(lineage.chain.length, 1);
    assert.equal(lineage.chain[0].social_media_package_id, "sm_lineagev1000001");
    assert.equal(lineage.chain[0].is_latest, true);
    assert.equal(lineage.latest.social_media_package_id, "sm_lineagev1000001");
  }));

test("getLineage() reconstructs a true V1->V2->V3 chain and identifies V3 as latest, deterministically", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const v1 = store.save(buildRecord({}, { idGenerator: () => "sm_chainv1000000001" }));
    const v2 = store.save(buildRecord({ revision: 2, supersedes: v1.social_media_package_id }, { idGenerator: () => "sm_chainv2000000001" }));
    store.save(buildRecord({ revision: 3, supersedes: v2.social_media_package_id }, { idGenerator: () => "sm_chainv3000000001" }));

    const lineage = store.getLineage("ep_a1b2c3d4e5f60708");
    assert.deepEqual(
      lineage.chain.map((r) => r.social_media_package_id),
      ["sm_chainv1000000001", "sm_chainv2000000001", "sm_chainv3000000001"]
    );
    assert.deepEqual(
      lineage.chain.map((r) => r.is_latest),
      [false, false, true]
    );
    assert.equal(lineage.latest.social_media_package_id, "sm_chainv3000000001");
    assert.equal(lineage.latest.revision, 3);
  }));

test("getLineage() throws MalformedSocialMediaPackageLineageError when the stored records for one Editorial Package form a fork", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const v1 = store.save(buildRecord({}, { idGenerator: () => "sm_forkv1000000001" }));
    store.save(buildRecord({ revision: 2, supersedes: v1.social_media_package_id }, { idGenerator: () => "sm_forkv2a00000001" }));
    store.save(buildRecord({ revision: 2, supersedes: v1.social_media_package_id }, { idGenerator: () => "sm_forkv2b00000001" }));

    assert.throws(() => store.getLineage("ep_a1b2c3d4e5f60708"), MalformedSocialMediaPackageLineageError);
  }));

test("findLatestRevision() returns the same record getLineage().latest does, and null when none exists", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.equal(store.findLatestRevision("ep_a1b2c3d4e5f60708"), null);

    const v1 = store.save(buildRecord({}, { idGenerator: () => "sm_findlatestv1001" }));
    store.save(buildRecord({ revision: 2, supersedes: v1.social_media_package_id }, { idGenerator: () => "sm_findlatestv2001" }));

    assert.equal(store.findLatestRevision("ep_a1b2c3d4e5f60708").social_media_package_id, "sm_findlatestv2001");
  }));

test("getLineage() treats a pre-lineage historical record (revision: 1 via compatibility view) as a valid, latest V1", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    adapter.write("sm_historicalstore001", JSON.stringify(buildV11StoredRecord()));
    const store = createSocialMediaPackageStore({ adapter });

    const lineage = store.getLineage("ep_a1b2c3d4e5f60708");
    assert.equal(lineage.chain.length, 1);
    assert.equal(lineage.latest.social_media_package_id, "sm_historicalstore001");
    assert.equal(lineage.latest.revision, 1);
    assert.equal(lineage.latest.is_latest, true);
  }));

// --- DC-003-I032.9 — revision-lineage historical compatibility for
// corrections, and store.replace() (the correction mechanism's own
// persistence half) -----------------------------------------------------

test("get() exposes corrections: [] for a pre-correction (1.1-shaped) historical record — added only in memory", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    adapter.write("sm_historicalstore001", JSON.stringify(buildV11StoredRecord()));
    const store = createSocialMediaPackageStore({ adapter });

    const record = store.get("sm_historicalstore001");
    assert.deepEqual(record.corrections, []);
    assert.equal("corrections" in JSON.parse(adapter.read("sm_historicalstore001")), false, "corrections must never be written back to the historical file");
  }));

// --- Regression: the real DC-003-I032.9 incident ----------------------
// The first live correction (against the real sm_3b859b1d314c4c41,
// generated under schema 1.4) persisted a corrected record that still
// declared schema_version "1.4" while now structurally containing a
// populated `corrections` array — a field 1.4's own archived schema
// doesn't have (additionalProperties:false). The very next read
// correctly, strictly rejected it as CorruptedSocialMediaPackageError.
// Fixed by re-stamping schema_version to the CURRENT version on every
// correction. This test reproduces the exact failure shape end-to-end —
// a genuinely OLD-schema raw record (1.1, predating revision/supersedes
// AND corrections), read through the compatibility view, corrected, and
// round-tripped through real persistence — proving the fix, not just
// asserting it.

test("correcting a genuinely old-schema (1.1) historical record produces a record that remains readable after replace() — the real incident, reproduced", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir });
    adapter.write("sm_historicalstore001", JSON.stringify(buildV11StoredRecord()));
    const store = createSocialMediaPackageStore({ adapter });

    const original = store.get("sm_historicalstore001");
    assert.equal(original.schema_version, "1.1");

    const corrected = correctSocialMediaPackageSlideField({
      socialMediaPackage: original,
      slideNumber: 6,
      field: "body",
      replacementText: "Corrected CTA body.",
      reason: "test",
    });
    assert.equal(corrected.schema_version, CURRENT_SOCIAL_MEDIA_PACKAGE_SCHEMA_VERSION);

    store.replace({ identifier: "sm_historicalstore001", socialMediaPackage: corrected });

    // The real failure mode: this second read previously threw
    // CorruptedSocialMediaPackageError.
    const rereadRecord = store.get("sm_historicalstore001");
    assert.equal(rereadRecord.carousel.slides[5].body, "Corrected CTA body.");
    assert.equal(rereadRecord.corrections.length, 1);
    assert.equal(rereadRecord.schema_version, CURRENT_SOCIAL_MEDIA_PACKAGE_SCHEMA_VERSION);
  }));

test("replace() persists a corrected record under its own existing identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const original = store.save(buildRecord({}, { idGenerator: () => "sm_replacetest00001" }));

    const corrected = correctSocialMediaPackageSlideField({
      socialMediaPackage: original,
      slideNumber: 1,
      field: "heading",
      replacementText: "Corrected Heading",
      reason: "test",
    });
    const persisted = store.replace({ identifier: "sm_replacetest00001", socialMediaPackage: corrected });

    assert.equal(persisted.carousel.slides[0].heading, "Corrected Heading");
    assert.equal(store.get("sm_replacetest00001").carousel.slides[0].heading, "Corrected Heading");
    assert.equal(store.get("sm_replacetest00001").corrections.length, 1);
  }));

test("replace() throws SocialMediaPackageNotFoundError when no record exists yet for the identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const neverSaved = buildRecord({}, { idGenerator: () => "sm_neversaved000001" });
    assert.throws(() => store.replace({ identifier: "sm_neversaved000001", socialMediaPackage: neverSaved }), SocialMediaPackageNotFoundError);
  }));

test("replace() throws SocialMediaPackageIdentifierMismatchError when the supplied object's own id differs from the target identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({}, { idGenerator: () => "sm_mismatcha0000001" }));
    const differentRecord = buildRecord({ editorialPackageId: "ep_bbbbbbbbbbbbbbbb" }, { idGenerator: () => "sm_mismatchb0000001" });

    assert.throws(
      () => store.replace({ identifier: "sm_mismatcha0000001", socialMediaPackage: differentRecord }),
      SocialMediaPackageIdentifierMismatchError
    );
    // The mismatch attempt never touched the original record.
    assert.equal(store.get("sm_mismatcha0000001").editorial_package_id, "ep_a1b2c3d4e5f60708");
  }));

test("replace() throws CorruptedSocialMediaPackageError when the supplied object fails schema validation", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({}, { idGenerator: () => "sm_invalidreplace01" }));
    assert.throws(
      () => store.replace({ identifier: "sm_invalidreplace01", socialMediaPackage: { social_media_package_id: "sm_invalidreplace01" } }),
      CorruptedSocialMediaPackageError
    );
  }));

test("a corrected-and-replaced record is still findable via findByEditorialPackageId() and getLineage() — the correction doesn't change lineage/duplicate behaviour", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const original = store.save(buildRecord({}, { idGenerator: () => "sm_lineagepreserv01" }));
    const corrected = correctSocialMediaPackageSlideField({ socialMediaPackage: original, slideNumber: 6, field: "body", replacementText: "Corrected CTA.", reason: "test" });
    store.replace({ identifier: "sm_lineagepreserv01", socialMediaPackage: corrected });

    const matches = store.findByEditorialPackageId("ep_a1b2c3d4e5f60708");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].social_media_package_id, "sm_lineagepreserv01");
    assert.equal(matches[0].carousel.slides[5].body, "Corrected CTA.");

    const lineage = store.getLineage("ep_a1b2c3d4e5f60708");
    assert.equal(lineage.chain.length, 1);
    assert.equal(lineage.latest.social_media_package_id, "sm_lineagepreserv01");
  }));

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSocialMediaPackageStore } from "../../src/social-media-package-store.mjs";
import { createLocalJsonSocialMediaPackageStoreAdapter } from "../../src/local-json-social-media-package-store-adapter.mjs";
import { createSocialMediaPackage } from "../../src/social-media-package.mjs";
import {
  InvalidSocialMediaPackageStoreAdapterError,
  InvalidSocialMediaPackageIdentifierError,
  SocialMediaPackageAlreadyExistsError,
  SocialMediaPackageNotFoundError,
} from "../../src/social-media-package-errors.mjs";

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
      },
      llmModel: "mock-social-media-provider-v1",
      promptVersion: "social-media-package.v1",
      schemaVersion: "1.0",
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

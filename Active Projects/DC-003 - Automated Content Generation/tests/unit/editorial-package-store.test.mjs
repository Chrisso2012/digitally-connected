import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEditorialPackageStore } from "../../src/editorial-package-store.mjs";
import { createLocalJsonEditorialPackageStoreAdapter } from "../../src/local-json-editorial-package-store-adapter.mjs";
import { createEditorialPackage } from "../../src/editorial-package.mjs";
import {
  InvalidEditorialPackageStoreAdapterError,
  InvalidEditorialPackageIdentifierError,
  EditorialPackageAlreadyExistsError,
  EditorialPackageNotFoundError,
} from "../../src/editorial-package-errors.mjs";

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-editorial-package-store-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createEditorialPackageStore({ adapter: createLocalJsonEditorialPackageStoreAdapter({ storageDir }) });
}

function buildRecord(overrides = {}, options = {}) {
  return createEditorialPackage(
    {
      ingestedContentId: "ic_a1b2c3d4e5f60708",
      primaryHeadline: "Headline",
      supportingHeadline: "Supporting",
      executiveSummary: "Summary.",
      coreMessage: "Message.",
      primaryAudience: "Audience.",
      primaryProblem: "Problem.",
      desiredOutcome: "Outcome.",
      keyInsights: ["Insight."],
      pullQuotes: ["Quote."],
      callToAction: "Act.",
      keywords: ["kw"],
      seoTitle: "SEO",
      seoDescription: "SEO desc.",
      suggestedHashtags: ["tag"],
      editorialThemes: ["theme"],
      contentCategories: ["category"],
      llmModel: "mock-editorial-analysis-provider-v1",
      promptVersion: "editorial-package.v1",
      schemaVersion: "1.0",
      ...overrides,
    },
    options
  );
}

test("throws InvalidEditorialPackageStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createEditorialPackageStore({ adapter: { name: "x" } }), InvalidEditorialPackageStoreAdapterError);
});

test("save() persists a valid record and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const saved = store.save(buildRecord({}, { idGenerator: () => "ep_savetest00000001" }));
    assert.equal(saved.editorial_package_id, "ep_savetest00000001");
    assert.throws(() => {
      saved.primary_headline = "changed";
    }, TypeError);
  }));

test("save() rejects a second save for the same editorial_package_id", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "ep_duplicatetest001";
    store.save(buildRecord({}, { idGenerator: idGen }));
    assert.throws(() => store.save(buildRecord({}, { idGenerator: idGen })), EditorialPackageAlreadyExistsError);
  }));

test("get() retrieves a stored record; throws for missing/invalid identifiers", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ primaryHeadline: "Findable" }, { idGenerator: () => "ep_gettest000000001" }));
    assert.equal(store.get("ep_gettest000000001").primary_headline, "Findable");
    assert.throws(() => store.get("ep_doesnotexist00001"), EditorialPackageNotFoundError);
    assert.throws(() => store.get("../../etc/passwd"), InvalidEditorialPackageIdentifierError);
  }));

test("exists() reflects save() and is false for an unknown identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.equal(store.exists("ep_existstest0000001"), false);
    store.save(buildRecord({}, { idGenerator: () => "ep_existstest0000001" }));
    assert.equal(store.exists("ep_existstest0000001"), true);
  }));

test("list() returns safe summaries ordered chronologically by generated_at", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ ingestedContentId: "ic_bbbbbbbbbbbbbbbb", primaryHeadline: "Second" }, { idGenerator: () => "ep_second0000000001", now: () => "2026-08-07T11:00:00.000Z" }));
    store.save(buildRecord({ ingestedContentId: "ic_aaaaaaaaaaaaaaaa", primaryHeadline: "First" }, { idGenerator: () => "ep_first00000000001", now: () => "2026-08-07T10:00:00.000Z" }));
    const summaries = store.list();
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].primary_headline, "First");
    assert.equal(summaries[1].primary_headline, "Second");
    assert.equal(summaries[0].executive_summary, undefined);
  }));

test("findByIngestedContentId() returns only matching full records, ordered chronologically", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ ingestedContentId: "ic_aaaaaaaaaaaaaaaa" }, { idGenerator: () => "ep_aaaaaaaaaaaaaaaa", now: () => "2026-08-07T10:00:00.000Z" }));
    store.save(buildRecord({ ingestedContentId: "ic_bbbbbbbbbbbbbbbb" }, { idGenerator: () => "ep_bbbbbbbbbbbbbbbb" }));

    const matches = store.findByIngestedContentId("ic_aaaaaaaaaaaaaaaa");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].editorial_package_id, "ep_aaaaaaaaaaaaaaaa");
    assert.equal(store.findByIngestedContentId("ic_cccccccccccccccc").length, 0);
  }));

// DC-003-I032.10.1 — regression coverage for the Carousel Content
// Package Store: persistence round-trips, identifier safety, and
// corruption handling. Mirrors editorial-package-store.test.mjs's own
// conventions.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCarouselContentPackageStore } from "../../src/carousel-content-package-store.mjs";
import { createLocalJsonCarouselContentPackageStoreAdapter } from "../../src/local-json-carousel-content-package-store-adapter.mjs";
import { createCarouselContentPackage } from "../../src/carousel-content-package.mjs";
import {
  InvalidCarouselContentPackageStoreAdapterError,
  InvalidCarouselContentPackageIdentifierError,
  CarouselContentPackageAlreadyExistsError,
  CarouselContentPackageNotFoundError,
  CorruptedCarouselContentPackageError,
} from "../../src/carousel-content-package-errors.mjs";

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-carousel-content-package-store-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createCarouselContentPackageStore({ adapter: createLocalJsonCarouselContentPackageStoreAdapter({ storageDir }) });
}

const INDUSTRY_SERIES = "Real Estate Industry Series";

function image(overrides = {}) {
  return { mode: "none", asset_reference: null, direction: null, ...overrides };
}

function buildSlides() {
  return [
    {
      slide_number: 1,
      role: "cover",
      template: "cover_black",
      industry_series: INDUSTRY_SERIES,
      headline: "The Myth of the Dead Database",
      supporting_line: "Why timing, not interest, is the real reason old enquiries go quiet.",
      image: image({ mode: "provided", asset_reference: "fixtures/images/cover.png" }),
    },
    { slide_number: 2, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES, headline: "H2", body: "B2", image: image(), image_layout: "none", emphasis_instructions: [] },
    { slide_number: 3, role: "content", template: "content_orange", industry_series: INDUSTRY_SERIES, headline: "H3", body: "B3", image: image(), image_layout: "none", emphasis_instructions: [] },
    { slide_number: 4, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES, headline: "H4", body: "B4", image: image(), image_layout: "none", emphasis_instructions: [] },
    { slide_number: 5, role: "content", template: "content_orange", industry_series: INDUSTRY_SERIES, headline: "H5", body: "B5", image: image(), image_layout: "none", emphasis_instructions: [] },
    { slide_number: 6, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES, headline: "H6", body: "B6", image: image(), image_layout: "none", emphasis_instructions: [] },
    {
      slide_number: 7,
      role: "close",
      template: "close_black",
      industry_series: INDUSTRY_SERIES,
      headline: "One Question Reopens the Conversation",
      body: "Ask every old enquiry: has anything changed since we last spoke?",
      soft_cta: "See what's already in your CRM.",
      image: image({ mode: "provided", asset_reference: "fixtures/images/close.png" }),
      emphasis_instructions: [],
    },
  ];
}

function buildRecord(overrides = {}, options = {}) {
  return createCarouselContentPackage(
    {
      sourceArticleTitle: "The Myth of the Dead Database",
      sourceArticleReference: "cowork://articles/myth-dead-database",
      industryName: "Real Estate",
      industrySeries: INDUSTRY_SERIES,
      carouselTitle: "The Myth of the Dead Database",
      approvedBy: "chris@digitallyconnected.net",
      approvedAt: "2026-08-11T09:00:00.000Z",
      schemaVersion: "1.0",
      slides: buildSlides(),
      ...overrides,
    },
    options
  );
}

test("throws InvalidCarouselContentPackageStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createCarouselContentPackageStore({ adapter: { name: "x" } }), InvalidCarouselContentPackageStoreAdapterError);
});

test("save() persists a valid record and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const saved = store.save(buildRecord({}, { idGenerator: () => "ccp_savetest00000001" }));
    assert.equal(saved.carousel_content_package_id, "ccp_savetest00000001");
    assert.throws(() => {
      saved.carousel_title = "changed";
    }, TypeError);
  }));

test("save() rejects a second save for the same carousel_content_package_id", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "ccp_duplicatetest001";
    store.save(buildRecord({}, { idGenerator: idGen }));
    assert.throws(() => store.save(buildRecord({}, { idGenerator: idGen })), CarouselContentPackageAlreadyExistsError);
  }));

test("get() retrieves a stored record; throws for missing/invalid identifiers", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ carouselTitle: "Findable" }, { idGenerator: () => "ccp_gettest000000001" }));
    assert.equal(store.get("ccp_gettest000000001").carousel_title, "Findable");
    assert.throws(() => store.get("ccp_doesnotexist00001"), CarouselContentPackageNotFoundError);
    assert.throws(() => store.get("../../etc/passwd"), InvalidCarouselContentPackageIdentifierError);
  }));

test("exists() reflects save() and is false for an unknown identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.equal(store.exists("ccp_existstest0000001"), false);
    store.save(buildRecord({}, { idGenerator: () => "ccp_existstest0000001" }));
    assert.equal(store.exists("ccp_existstest0000001"), true);
  }));

test("list() returns safe summaries ordered chronologically by created_at", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ carouselTitle: "Second" }, { idGenerator: () => "ccp_second0000000001", now: () => "2026-08-11T11:00:00.000Z" }));
    store.save(buildRecord({ carouselTitle: "First" }, { idGenerator: () => "ccp_first00000000001", now: () => "2026-08-11T10:00:00.000Z" }));
    const summaries = store.list();
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].carousel_title, "First");
    assert.equal(summaries[1].carousel_title, "Second");
    assert.equal(summaries[0].slides, undefined);
  }));

test("create/inspect(get)/list persistence round-trips without altering approved copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const original = buildRecord({}, { idGenerator: () => "ccp_roundtrip0000001" });
    store.save(original);

    const reread = store.get("ccp_roundtrip0000001");
    assert.deepEqual(reread, original);

    const listed = store.list();
    assert.equal(listed[0].carousel_content_package_id, "ccp_roundtrip0000001");
  }));

test("a genuinely corrupted stored record (fails schema validation) throws CorruptedCarouselContentPackageError on read", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonCarouselContentPackageStoreAdapter({ storageDir: dir });
    adapter.write("ccp_corrupttest000001", JSON.stringify({ carousel_content_package_id: "ccp_corrupttest000001" }));
    const store = createCarouselContentPackageStore({ adapter });
    assert.throws(() => store.get("ccp_corrupttest000001"), CorruptedCarouselContentPackageError);
  }));

test("a stored file that isn't valid JSON throws CorruptedCarouselContentPackageError, not a raw parse error", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonCarouselContentPackageStoreAdapter({ storageDir: dir });
    adapter.write("ccp_notjsontest000001", "{ this is not json");
    const store = createCarouselContentPackageStore({ adapter });
    assert.throws(() => store.get("ccp_notjsontest000001"), CorruptedCarouselContentPackageError);
  }));

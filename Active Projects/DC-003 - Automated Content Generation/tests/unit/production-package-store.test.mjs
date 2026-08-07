import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProductionPackageStore } from "../../src/production-package-store.mjs";
import { createLocalJsonProductionPackageStoreAdapter } from "../../src/local-json-production-package-store-adapter.mjs";
import { createProductionPackage } from "../../src/production-package.mjs";
import {
  InvalidProductionPackageStoreAdapterError,
  InvalidProductionPackageIdentifierError,
  ProductionPackageAlreadyExistsError,
  ProductionPackageNotFoundError,
} from "../../src/production-package-errors.mjs";

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-production-package-store-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createProductionPackageStore({ adapter: createLocalJsonProductionPackageStoreAdapter({ storageDir }) });
}

const SLIDE_ROLES = ["cover", "insight", "statistic", "quote", "takeaway", "cta"];

function buildSlide(slideNumber, overrides = {}) {
  const isFinal = slideNumber === 6;
  return {
    slideNumber,
    slideRole: SLIDE_ROLES[slideNumber - 1],
    headlineMapping: `Headline ${slideNumber}.`,
    bodyCopyMapping: `Body ${slideNumber}.`,
    ctaMapping: isFinal ? "Act now." : null,
    imageGuidanceMapping: `Guidance ${slideNumber}.`,
    placeholderTagMapping: { headline: `Headline ${slideNumber}.`, body: `Body ${slideNumber}.`, cta: isFinal ? "Act now." : null, image_guidance: `Guidance ${slideNumber}.` },
    structuredContent: { statistic: null, quote: null, keyPoints: [] },
    ...overrides,
  };
}

function buildRecord(overrides = {}, options = {}) {
  return createProductionPackage(
    {
      socialMediaPackageId: "sm_a1b2c3d4e5f60708",
      renderer: "templated",
      platform: null,
      designId: "dc-002-v1",
      templateId: "dc-carousel-v1",
      slideSequence: [1, 2, 3, 4, 5, 6].map((n) => buildSlide(n)),
      renderingMetadata: { mappingStrategy: "uniform-cover-cta-v1", slideCount: 6, generator: "templated-renderer-adapter" },
      validationMetadata: {
        socialMediaPackageChecksum: "d734fd7f65fce3498ee98ef948f538caa02346dfd80498b68b81776e522727c7",
        allSlidesPopulated: true,
        rendererMappingValidated: true,
      },
      schemaVersion: "1.0",
      ...overrides,
    },
    options
  );
}

test("throws InvalidProductionPackageStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createProductionPackageStore({ adapter: { name: "x" } }), InvalidProductionPackageStoreAdapterError);
});

test("save() persists a valid record and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const saved = store.save(buildRecord({}, { idGenerator: () => "pp_savetest00000001" }));
    assert.equal(saved.production_package_id, "pp_savetest00000001");
    assert.throws(() => {
      saved.renderer = "changed";
    }, TypeError);
  }));

test("save() rejects a second save for the same production_package_id", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "pp_duplicatetest001";
    store.save(buildRecord({}, { idGenerator: idGen }));
    assert.throws(() => store.save(buildRecord({}, { idGenerator: idGen })), ProductionPackageAlreadyExistsError);
  }));

test("get() retrieves a stored record; throws for missing/invalid identifiers", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({}, { idGenerator: () => "pp_gettest000000001" }));
    assert.equal(store.get("pp_gettest000000001").production_package_id, "pp_gettest000000001");
    assert.throws(() => store.get("pp_doesnotexist00001"), ProductionPackageNotFoundError);
    assert.throws(() => store.get("../../etc/passwd"), InvalidProductionPackageIdentifierError);
  }));

test("exists() reflects save() and is false for an unknown identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.equal(store.exists("pp_existstest0000001"), false);
    store.save(buildRecord({}, { idGenerator: () => "pp_existstest0000001" }));
    assert.equal(store.exists("pp_existstest0000001"), true);
  }));

test("list() returns safe summaries ordered chronologically by generated_at", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ socialMediaPackageId: "sm_bbbbbbbbbbbbbbbb" }, { idGenerator: () => "pp_second0000000001", now: () => "2026-08-07T11:00:00.000Z" }));
    store.save(buildRecord({ socialMediaPackageId: "sm_aaaaaaaaaaaaaaaa" }, { idGenerator: () => "pp_first00000000001", now: () => "2026-08-07T10:00:00.000Z" }));
    const summaries = store.list();
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].production_package_id, "pp_first00000000001");
    assert.equal(summaries[1].production_package_id, "pp_second0000000001");
    assert.equal(summaries[0].slide_sequence, undefined);
  }));

test("findBySocialMediaPackageId() returns only matching full records, ordered chronologically", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ socialMediaPackageId: "sm_aaaaaaaaaaaaaaaa" }, { idGenerator: () => "pp_aaaaaaaaaaaaaaaa", now: () => "2026-08-07T10:00:00.000Z" }));
    store.save(buildRecord({ socialMediaPackageId: "sm_bbbbbbbbbbbbbbbb" }, { idGenerator: () => "pp_bbbbbbbbbbbbbbbb" }));

    const matches = store.findBySocialMediaPackageId("sm_aaaaaaaaaaaaaaaa");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].production_package_id, "pp_aaaaaaaaaaaaaaaa");
    assert.equal(store.findBySocialMediaPackageId("sm_cccccccccccccccc").length, 0);
  }));

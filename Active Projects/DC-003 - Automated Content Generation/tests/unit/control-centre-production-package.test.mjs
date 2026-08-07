// DC-003-I033 — focused tests for the Control Centre's new, optional,
// read-only Production Package section (computeProductionPackage() /
// overview.production_package). A separate, new test file rather than
// adding to the large existing control-centre-service.test.mjs — mirrors
// control-centre-social-media-package.test.mjs's own precedent from I032.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createControlCentreService } from "../../src/control-centre-service.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createProductionMetricsStore } from "../../src/production-metrics-store.mjs";
import { createLocalJsonProductionMetricsStoreAdapter } from "../../src/local-json-production-metrics-store-adapter.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createProductionPackageStore } from "../../src/production-package-store.mjs";
import { createLocalJsonProductionPackageStoreAdapter } from "../../src/local-json-production-package-store-adapter.mjs";
import { createProductionPackage } from "../../src/production-package.mjs";
import { InvalidControlCentreDependenciesError } from "../../src/control-centre-errors.mjs";

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-cc-production-package-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildBaseFields(base) {
  return {
    finishedCarouselStore: createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: path.join(base, "carousels") }) }),
    productionMetricsStore: createProductionMetricsStore({ adapter: createLocalJsonProductionMetricsStoreAdapter({ storageDir: path.join(base, "metrics") }) }),
    publisherResultStore: createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: path.join(base, "publisher-results") }) }),
  };
}

function buildProductionPackageStore(dir) {
  return createProductionPackageStore({ adapter: createLocalJsonProductionPackageStoreAdapter({ storageDir: dir }) });
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

test("production_package is null when no Production Package Store is supplied", () =>
  withTempDir((base) => {
    const service = createControlCentreService(buildBaseFields(base));
    assert.equal(service.getOverview().production_package, null);
  }));

test("production_package reflects an empty store as zero counts, not null", () =>
  withTempDir((base) => {
    const productionPackageStore = buildProductionPackageStore(path.join(base, "pp"));
    const service = createControlCentreService({ ...buildBaseFields(base), productionPackageStore });
    assert.deepEqual(service.getOverview().production_package, { total_production_packages: 0, latest_package: null, latest_status: null });
  }));

test("production_package reports total, latest_package summary, and latest_status — never the full slide_sequence", () =>
  withTempDir((base) => {
    const productionPackageStore = buildProductionPackageStore(path.join(base, "pp"));
    productionPackageStore.save(
      buildRecord({ socialMediaPackageId: "sm_aaaaaaaaaaaaaaaa" }, { idGenerator: () => "pp_first00000000001", now: () => "2026-08-07T10:00:00.000Z" })
    );
    productionPackageStore.save(
      buildRecord({ socialMediaPackageId: "sm_bbbbbbbbbbbbbbbb" }, { idGenerator: () => "pp_second0000000001", now: () => "2026-08-07T11:00:00.000Z" })
    );

    const service = createControlCentreService({ ...buildBaseFields(base), productionPackageStore });
    const productionPackage = service.getOverview().production_package;

    assert.equal(productionPackage.total_production_packages, 2);
    assert.equal(productionPackage.latest_package.production_package_id, "pp_second0000000001");
    assert.equal(productionPackage.latest_package.renderer, "templated");
    assert.equal(productionPackage.latest_status, "generated");
    assert.equal("slide_sequence" in productionPackage.latest_package, false);
  }));

test("createControlCentreService() throws InvalidControlCentreDependenciesError for a malformed productionPackageStore", () =>
  withTempDir((base) => {
    assert.throws(
      () => createControlCentreService({ ...buildBaseFields(base), productionPackageStore: { name: "x" } }),
      InvalidControlCentreDependenciesError
    );
  }));

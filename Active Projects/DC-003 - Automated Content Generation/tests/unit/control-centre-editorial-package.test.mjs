// DC-003-I031 — focused tests for the Control Centre's new, optional,
// read-only Editorial Package section (computeEditorialPackage() /
// overview.editorial_package). A separate, new test file rather than
// adding to the large existing control-centre-service.test.mjs — mirrors
// control-centre-content-ingestion.test.mjs's own precedent from I030.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createControlCentreService } from "../../src/control-centre-service.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createProductionMetricsStore } from "../../src/production-metrics-store.mjs";
import { createLocalJsonProductionMetricsStoreAdapter } from "../../src/local-json-production-metrics-store-adapter.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createEditorialPackageStore } from "../../src/editorial-package-store.mjs";
import { createLocalJsonEditorialPackageStoreAdapter } from "../../src/local-json-editorial-package-store-adapter.mjs";
import { createEditorialPackage } from "../../src/editorial-package.mjs";
import { InvalidControlCentreDependenciesError } from "../../src/control-centre-errors.mjs";

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-cc-editorial-package-"));
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

function buildEditorialPackageStore(dir) {
  return createEditorialPackageStore({ adapter: createLocalJsonEditorialPackageStoreAdapter({ storageDir: dir }) });
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

test("editorial_package is null when no Editorial Package Store is supplied", () =>
  withTempDir((base) => {
    const service = createControlCentreService(buildBaseFields(base));
    assert.equal(service.getOverview().editorial_package, null);
  }));

test("editorial_package reflects an empty store as zero counts, not null", () =>
  withTempDir((base) => {
    const editorialPackageStore = buildEditorialPackageStore(path.join(base, "ep"));
    const service = createControlCentreService({ ...buildBaseFields(base), editorialPackageStore });
    assert.deepEqual(service.getOverview().editorial_package, { total_editorial_packages: 0, latest_package: null, latest_status: null });
  }));

test("editorial_package reports total, latest_package summary, and latest_status — never the full editorial fields", () =>
  withTempDir((base) => {
    const editorialPackageStore = buildEditorialPackageStore(path.join(base, "ep"));
    editorialPackageStore.save(
      buildRecord({ primaryHeadline: "First" }, { idGenerator: () => "ep_first00000000001", now: () => "2026-08-07T10:00:00.000Z" })
    );
    editorialPackageStore.save(
      buildRecord(
        { ingestedContentId: "ic_bbbbbbbbbbbbbbbb", primaryHeadline: "Second" },
        { idGenerator: () => "ep_second0000000001", now: () => "2026-08-07T11:00:00.000Z" }
      )
    );

    const service = createControlCentreService({ ...buildBaseFields(base), editorialPackageStore });
    const editorialPackage = service.getOverview().editorial_package;

    assert.equal(editorialPackage.total_editorial_packages, 2);
    assert.equal(editorialPackage.latest_package.editorial_package_id, "ep_second0000000001");
    assert.equal(editorialPackage.latest_package.primary_headline, "Second");
    assert.equal(editorialPackage.latest_status, "generated");
    assert.equal("executive_summary" in editorialPackage.latest_package, false);
  }));

test("createControlCentreService() throws InvalidControlCentreDependenciesError for a malformed editorialPackageStore", () =>
  withTempDir((base) => {
    assert.throws(
      () => createControlCentreService({ ...buildBaseFields(base), editorialPackageStore: { name: "x" } }),
      InvalidControlCentreDependenciesError
    );
  }));

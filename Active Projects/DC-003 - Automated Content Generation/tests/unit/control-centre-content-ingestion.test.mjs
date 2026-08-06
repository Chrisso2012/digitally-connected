// DC-003-I030 — focused tests for the Control Centre's new, optional,
// read-only Content Ingestion section (computeContentIngestion() /
// overview.content_ingestion). A separate, new test file rather than
// adding to the large existing control-centre-service.test.mjs — mirrors
// this project's own precedent of dedicated *-regression.test.mjs files
// for a new milestone's own additions to an already-large module.

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
import { createIngestedContentStore } from "../../src/ingested-content-store.mjs";
import { createLocalJsonIngestedContentStoreAdapter } from "../../src/local-json-ingested-content-store-adapter.mjs";
import { createIngestedContent } from "../../src/ingested-content.mjs";
import { InvalidControlCentreDependenciesError } from "../../src/control-centre-errors.mjs";
import { createHash } from "node:crypto";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-cc-content-ingestion-"));
  try {
    return fn(dir);
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

function buildIngestedContentStore(dir) {
  return createIngestedContentStore({ adapter: createLocalJsonIngestedContentStoreAdapter({ storageDir: dir }) });
}

function buildRecord(overrides = {}, options = {}) {
  return createIngestedContent(
    {
      sourceType: "google_docs",
      sourceReference: "doc-1",
      sourceFingerprint: createHash("sha256").update(overrides.fullArticleText ?? "body").digest("hex"),
      title: "Test Article",
      fullArticleText: "body",
      approvalState: "pending",
      ...overrides,
    },
    options
  );
}

test("content_ingestion is null when no Ingested Content Store is supplied", () =>
  withTempDir((base) => {
    const service = createControlCentreService(buildBaseFields(base));
    const overview = service.getOverview();
    assert.equal(overview.content_ingestion, null);
  }));

test("content_ingestion reflects an empty store as zero counts, not null", () =>
  withTempDir((base) => {
    const ingestedContentStore = buildIngestedContentStore(path.join(base, "ingested-content"));
    const service = createControlCentreService({ ...buildBaseFields(base), ingestedContentStore });
    const overview = service.getOverview();
    assert.deepEqual(overview.content_ingestion, {
      total_ingested: 0,
      by_source_type: {},
      by_approval_state: {},
      latest_ingestion: null,
    });
  }));

test("content_ingestion reports counts, breakdowns, and a lean latest_ingestion summary — never the full article text", () =>
  withTempDir((base) => {
    const ingestedContentStore = buildIngestedContentStore(path.join(base, "ingested-content"));
    ingestedContentStore.save(
      buildRecord({ title: "First", approvalState: "pending" }, { idGenerator: () => "ic_first00000000001", now: () => "2026-08-07T10:00:00.000Z" })
    );
    ingestedContentStore.save(
      buildRecord({ title: "Second", approvalState: "approved", fullArticleText: "different body" }, { idGenerator: () => "ic_second0000000001", now: () => "2026-08-07T11:00:00.000Z" })
    );

    const service = createControlCentreService({ ...buildBaseFields(base), ingestedContentStore });
    const contentIngestion = service.getOverview().content_ingestion;

    assert.equal(contentIngestion.total_ingested, 2);
    assert.deepEqual(contentIngestion.by_source_type, { google_docs: 2 });
    assert.deepEqual(contentIngestion.by_approval_state, { pending: 1, approved: 1 });
    assert.equal(contentIngestion.latest_ingestion.ingested_content_id, "ic_second0000000001");
    assert.equal(contentIngestion.latest_ingestion.title, "Second");
    assert.equal("full_article_text" in contentIngestion.latest_ingestion, false);
  }));

test("createControlCentreService() throws InvalidControlCentreDependenciesError for a malformed ingestedContentStore", () =>
  withTempDir((base) => {
    assert.throws(
      () => createControlCentreService({ ...buildBaseFields(base), ingestedContentStore: { name: "x" } }),
      InvalidControlCentreDependenciesError
    );
  }));

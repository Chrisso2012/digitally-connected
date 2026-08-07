// DC-003-I034 — regression coverage proving the Control Centre's existing
// dashboard/job/activity sections correctly handle a Finished Carousel
// built from the newer Production Package lineage (topic_id: null),
// without any new Control Centre section or architecture change — only
// the minimal, necessary nullability fix to control-centre.schema.json's
// own jobSummary/activityEntry/jobDetail $defs (topic_id: "string" ->
// ["string","null"]), reported to and approved as part of this
// milestone's own investigation before being made.

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
import { renderProductionPackage } from "../../src/carousel-rendering-engine.mjs";

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-cc-dual-lineage-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SLIDE_ROLES = ["cover", "insight", "statistic", "quote", "takeaway", "cta"];

function buildProductionPackage(store, base) {
  const slide = (n) => ({
    slideNumber: n,
    slideRole: SLIDE_ROLES[n - 1],
    headlineMapping: `Headline ${n}.`,
    bodyCopyMapping: `Body ${n}.`,
    ctaMapping: n === 6 ? "Act now." : null,
    imageGuidanceMapping: `Guidance ${n}.`,
    placeholderTagMapping: { headline: `Headline ${n}.`, body: `Body ${n}.`, cta: n === 6 ? "Act now." : null, image_guidance: `Guidance ${n}.` },
    structuredContent:
      SLIDE_ROLES[n - 1] === "statistic"
        ? { statistic: { value: "50%", context: `Body ${n}.` }, quote: null, keyPoints: [] }
        : SLIDE_ROLES[n - 1] === "quote"
          ? { statistic: null, quote: { quoteText: `Body ${n}.` }, keyPoints: [] }
          : SLIDE_ROLES[n - 1] === "takeaway"
            ? { statistic: null, quote: null, keyPoints: [`Body ${n}.`] }
            : { statistic: null, quote: null, keyPoints: [] },
  });
  return store.save(
    createProductionPackage(
      {
        socialMediaPackageId: "sm_a1b2c3d4e5f60708",
        renderer: "templated",
        platform: null,
        designId: "dc-002-v1",
        templateId: "dc-carousel-v1",
        slideSequence: [1, 2, 3, 4, 5, 6].map(slide),
        renderingMetadata: { mappingStrategy: "semantic-six-template-v1", slideCount: 6, generator: "templated-renderer-adapter" },
        validationMetadata: {
          socialMediaPackageChecksum: "d734fd7f65fce3498ee98ef948f538caa02346dfd80498b68b81776e522727c7",
          allSlidesPopulated: true,
          rendererMappingValidated: true,
        },
        schemaVersion: "1.0",
      },
      { idGenerator: () => "pp_cclineagetest01" }
    )
  );
}

async function buildServiceWithOneI034Carousel(base) {
  const productionPackageStore = createProductionPackageStore({ adapter: createLocalJsonProductionPackageStoreAdapter({ storageDir: path.join(base, "pp") }) });
  const finishedCarouselStore = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: path.join(base, "fc") }) });

  const productionPackage = buildProductionPackage(productionPackageStore, base);
  const finishedCarousel = await renderProductionPackage(productionPackage.production_package_id, { productionPackageStore, finishedCarouselStore });

  const service = createControlCentreService({
    finishedCarouselStore,
    productionMetricsStore: createProductionMetricsStore({ adapter: createLocalJsonProductionMetricsStoreAdapter({ storageDir: path.join(base, "metrics") }) }),
    publisherResultStore: createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: path.join(base, "publisher") }) }),
  });

  return { service, finishedCarousel };
}

test("getOverview() does not throw for a Production Package lineage Finished Carousel, and recent_jobs reports topic_id: null", () =>
  withTempDir(async (base) => {
    const { service, finishedCarousel } = await buildServiceWithOneI034Carousel(base);
    const overview = service.getOverview();

    assert.equal(overview.recent_jobs.length, 1);
    assert.equal(overview.recent_jobs[0].carousel_id, finishedCarousel.carousel_id);
    assert.equal(overview.recent_jobs[0].topic_id, null);
  }));

test("recent_activity entries for a Production Package lineage Finished Carousel also report topic_id: null, not a thrown assembly error", () =>
  withTempDir(async (base) => {
    const { service } = await buildServiceWithOneI034Carousel(base);
    const overview = service.getOverview();

    assert.ok(overview.recent_activity.length > 0);
    for (const entry of overview.recent_activity) {
      assert.equal(entry.topic_id, null);
    }
  }));

test("getJobDetail() succeeds for a Production Package lineage Finished Carousel, job.topic_id is null, finished_carousel carries a real production_package_id", () =>
  withTempDir(async (base) => {
    const { service, finishedCarousel } = await buildServiceWithOneI034Carousel(base);
    const detail = service.getJobDetail(finishedCarousel.carousel_id);

    assert.equal(detail.job.topic_id, null);
    assert.equal(detail.job.finished_carousel.production_package_id, finishedCarousel.production_package_id);
  }));

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderProductionPackage } from "../../src/carousel-rendering-engine.mjs";
import { DuplicateRenderError } from "../../src/carousel-rendering-engine-errors.mjs";
import { createProductionPackageStore } from "../../src/production-package-store.mjs";
import { createLocalJsonProductionPackageStoreAdapter } from "../../src/local-json-production-package-store-adapter.mjs";
import { createProductionPackage } from "../../src/production-package.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { ProductionPackageNotFoundError } from "../../src/production-package-errors.mjs";
import { RendererError, AuthenticationError } from "../../src/renderer-errors.mjs";

async function withTempDir(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-carousel-rendering-engine-"));
  try {
    return await fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function buildStores(base) {
  const productionPackageStore = createProductionPackageStore({ adapter: createLocalJsonProductionPackageStoreAdapter({ storageDir: path.join(base, "pp") }) });
  const finishedCarouselStore = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: path.join(base, "fc") }) });
  return { productionPackageStore, finishedCarouselStore };
}

function seedProductionPackage(store, overrides = {}, idGenerator = () => "pp_enginetest0001") {
  const slide = (n) => ({
    slideNumber: n,
    headlineMapping: `Headline ${n}.`,
    bodyCopyMapping: `Body ${n}.`,
    ctaMapping: n === 6 ? "Act now." : null,
    imageGuidanceMapping: `Guidance ${n}.`,
    placeholderTagMapping: { headline: `Headline ${n}.`, body: `Body ${n}.`, cta: n === 6 ? "Act now." : null, image_guidance: `Guidance ${n}.` },
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
        renderingMetadata: { mappingStrategy: "uniform-cover-cta-v1", slideCount: 6, generator: "templated-renderer-adapter" },
        validationMetadata: {
          socialMediaPackageChecksum: "d734fd7f65fce3498ee98ef948f538caa02346dfd80498b68b81776e522727c7",
          allSlidesPopulated: true,
          rendererMappingValidated: true,
        },
        schemaVersion: "1.0",
        ...overrides,
      },
      { idGenerator }
    )
  );
}

// A custom transport that fails only ONE specific slide (by call index),
// succeeding for every other — used to prove partial-failure handling
// without a real network, and without any status this codebase doesn't
// already define.
function partialFailureTransport(failAtCallIndex) {
  let calls = 0;
  return {
    name: "partial-failure-mock-transport",
    async send() {
      calls += 1;
      if (calls - 1 === failAtCallIndex) {
        return { id: `render_fail_${calls}`, status: "FAILED", error: "template layer mismatch (simulated)" };
      }
      return { id: `render_ok_${calls}`, status: "COMPLETED", url: `https://mock-templated.local/renders/${calls}.png` };
    },
  };
}

test("renders a valid Production Package into a persisted, well-formed Finished Carousel", () =>
  withTempDir(async (base) => {
    const { productionPackageStore, finishedCarouselStore } = buildStores(base);
    const pp = seedProductionPackage(productionPackageStore);

    const finishedCarousel = await renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore });

    assert.match(finishedCarousel.carousel_id, /^car_[A-Za-z0-9]+$/);
    assert.equal(finishedCarousel.production_package_id, pp.production_package_id);
    assert.equal(finishedCarousel.topic_id, null);
    assert.equal(finishedCarousel.carousel_content_id, null);
    assert.equal(finishedCarousel.overall_status, "completed");
    assert.equal(finishedCarouselStore.get(finishedCarousel.carousel_id).carousel_id, finishedCarousel.carousel_id);
  }));

test("renders slides in deterministic order, one per slide_number 1-6, matching the Templated Adapter's own cover/cta assignment", () =>
  withTempDir(async (base) => {
    const { productionPackageStore, finishedCarouselStore } = buildStores(base);
    const pp = seedProductionPackage(productionPackageStore);

    const finishedCarousel = await renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore });

    assert.equal(finishedCarousel.slides.length, 6);
    finishedCarousel.slides.forEach((slide, index) => assert.equal(slide.slide_number, index + 1));
    for (let i = 0; i < 5; i += 1) assert.equal(finishedCarousel.slides[i].slide_type, "cover");
    assert.equal(finishedCarousel.slides[5].slide_type, "cta");
  }));

test("never mutates the source Production Package or copies any of its own content verbatim into invented fields", () =>
  withTempDir(async (base) => {
    const { productionPackageStore, finishedCarouselStore } = buildStores(base);
    const pp = seedProductionPackage(productionPackageStore);
    const beforeChecksum = pp.production_checksum;

    await renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore });

    const reread = productionPackageStore.get(pp.production_package_id);
    assert.equal(reread.production_checksum, beforeChecksum);
    assert.deepEqual(reread, pp);
  }));

test("a per-slide render Templated itself rejects becomes a normal 'failed' slide status, never silently omitted, overall_status reflects it", () =>
  withTempDir(async (base) => {
    const { productionPackageStore, finishedCarouselStore } = buildStores(base);
    const pp = seedProductionPackage(productionPackageStore);
    const transport = createMockTransport({ mode: "rejected" });

    const finishedCarousel = await renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore, transport });

    assert.equal(finishedCarousel.overall_status, "failed");
    assert.equal(finishedCarousel.slides.length, 6);
    assert.ok(finishedCarousel.slides.every((s) => s.status === "failed"));
  }));

test("partial render failure: one failed slide among six still produces a complete 6-slide record with overall_status 'partial'", () =>
  withTempDir(async (base) => {
    const { productionPackageStore, finishedCarouselStore } = buildStores(base);
    const pp = seedProductionPackage(productionPackageStore);
    const transport = partialFailureTransport(2); // fails the 3rd rendered slide only

    const finishedCarousel = await renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore, transport });

    assert.equal(finishedCarousel.slides.length, 6);
    assert.equal(finishedCarousel.overall_status, "partial");
    assert.equal(finishedCarousel.metadata.completed_slides, 5);
    assert.equal(finishedCarousel.metadata.failed_slides, 1);
    assert.equal(finishedCarousel.slides[2].status, "failed");
  }));

test("a genuine transport-level failure (authentication) aborts the whole run — nothing is persisted", () =>
  withTempDir(async (base) => {
    const { productionPackageStore, finishedCarouselStore } = buildStores(base);
    const pp = seedProductionPackage(productionPackageStore);
    const transport = createMockTransport({ mode: "auth-error" });

    await assert.rejects(
      () => renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore, transport }),
      AuthenticationError
    );
    await assert.rejects(
      () => renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore, transport }),
      RendererError
    );
    assert.equal(finishedCarouselStore.list().length, 0);
  }));

test("throws ProductionPackageNotFoundError for an unknown productionPackageId", () =>
  withTempDir(async (base) => {
    const { productionPackageStore, finishedCarouselStore } = buildStores(base);
    await assert.rejects(
      () => renderProductionPackage("pp_doesnotexist00001", { productionPackageStore, finishedCarouselStore }),
      ProductionPackageNotFoundError
    );
  }));

test("throws DuplicateRenderError when a successfully completed Finished Carousel already exists for this Production Package", () =>
  withTempDir(async (base) => {
    const { productionPackageStore, finishedCarouselStore } = buildStores(base);
    const pp = seedProductionPackage(productionPackageStore);
    await renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore });

    await assert.rejects(
      () => renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore }),
      DuplicateRenderError
    );
  }));

test("does NOT block a retry when the prior Finished Carousel for this Production Package failed (only a genuinely successful one blocks)", () =>
  withTempDir(async (base) => {
    const { productionPackageStore, finishedCarouselStore } = buildStores(base);
    const pp = seedProductionPackage(productionPackageStore);

    const rejectedTransport = createMockTransport({ mode: "rejected" });
    const firstAttempt = await renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore, transport: rejectedTransport });
    assert.equal(firstAttempt.overall_status, "failed");

    // A genuinely successful retry must be allowed through.
    const secondAttempt = await renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore });
    assert.equal(secondAttempt.overall_status, "completed");
    assert.notEqual(secondAttempt.carousel_id, firstAttempt.carousel_id);
  }));

test("throws PipelineConfigurationError for missing dependencies.productionPackageStore", () =>
  withTempDir(async (base) => {
    const { finishedCarouselStore } = buildStores(base);
    await assert.rejects(() => renderProductionPackage("pp_x", { finishedCarouselStore }), PipelineConfigurationError);
  }));

test("throws PipelineConfigurationError for missing dependencies.finishedCarouselStore", () =>
  withTempDir(async (base) => {
    const { productionPackageStore } = buildStores(base);
    await assert.rejects(() => renderProductionPackage("pp_x", { productionPackageStore }), PipelineConfigurationError);
  }));

test("uses the mock transport by default when dependencies.transport is not supplied — never reaches a real network", () =>
  withTempDir(async (base) => {
    const { productionPackageStore, finishedCarouselStore } = buildStores(base);
    const pp = seedProductionPackage(productionPackageStore);

    const finishedCarousel = await renderProductionPackage(pp.production_package_id, { productionPackageStore, finishedCarouselStore });
    assert.equal(finishedCarousel.execution_metadata.provider, "mock-transport");
  }));

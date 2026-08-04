// Unit tests for production-asset-export-service.mjs (DC-003-I021). Uses a
// small in-memory fake Export Adapter throughout — never the real
// filesystem/network adapter — so these tests are pure validation-logic
// tests, matching how every other *-service.test.mjs in this codebase
// isolates the service layer from its adapter.

import test from "node:test";
import assert from "node:assert/strict";
import { executeProductionAssetExport } from "../../src/production-asset-export-service.mjs";
import {
  InvalidExportAdapterError,
  InvalidFinishedCarouselForExportError,
  CarouselNotEligibleForExportError,
  InvalidExportDestinationError,
} from "../../src/production-asset-export-errors.mjs";

const SLIDE_ORDER = ["cover", "content", "statistic", "quote", "infographic", "cta"];

function buildFinishedCarousel(overrides = {}) {
  const slides = SLIDE_ORDER.map((slideType, index) => ({
    slide_number: index + 1,
    slide_type: slideType,
    template_id: `template-${slideType}`,
    render_id: `render_${slideType}`,
    status: "completed",
    image_url: `https://cdn.example.test/renders/${slideType}.png`,
    width: 1080,
    height: 1350,
    format: "png",
    render_started_at: "2026-08-04T00:00:00.000Z",
    render_completed_at: "2026-08-04T00:00:03.000Z",
    duration_ms: 3000,
    error: null,
  }));

  return {
    carousel_id: "car_svctest0000001",
    topic_id: "topic_01J9SERVICETEST",
    carousel_content_id: "cc_svctest0000001",
    generated_at: "2026-08-04T00:00:20.000Z",
    overall_status: "completed",
    slides,
    metadata: { total_slides: 6, completed_slides: 6, failed_slides: 0, total_duration_ms: 18000 },
    execution_metadata: {
      execution_id: "exec_20260804_deadbeefcafe",
      rendered_at: "2026-08-04T00:00:20.000Z",
      provider: "templated-http",
      render_duration_ms: 18000,
    },
    approval: { approved: true, approved_by: "chris@digitallyconnected.net", approved_at: "2026-08-04T00:00:10.000Z", rejected: false, rejection_reason: null, published: false, published_at: null },
    ...overrides,
  };
}

function createFakeAdapter(resultOverrides = {}) {
  let calls = 0;
  const seen = [];
  return {
    name: "fake-export-adapter",
    calls: () => calls,
    seen: () => seen,
    async exportPackage(finishedCarousel, destination) {
      calls += 1;
      seen.push({ finishedCarousel, destination });
      return {
        assetPackageId: "pkg_faketest0000001",
        exportPath: `${destination}/${finishedCarousel.carousel_id}`,
        slideCount: 6,
        filesExported: 7,
        alreadyExported: false,
        exportedAt: "2026-08-04T01:00:00.000Z",
        ...resultOverrides,
      };
    },
  };
}

// --- Adapter validation --------------------------------------------------

test("requires a well-shaped adapter", async () => {
  await assert.rejects(() => executeProductionAssetExport(buildFinishedCarousel(), "/tmp/exports", {}), InvalidExportAdapterError);
  await assert.rejects(
    () => executeProductionAssetExport(buildFinishedCarousel(), "/tmp/exports", { adapter: { name: "x" } }),
    InvalidExportAdapterError
  );
});

// --- Finished Carousel validation ----------------------------------------

test("rejects a schema-invalid Finished Carousel without ever calling the adapter", async () => {
  const adapter = createFakeAdapter();
  const malformed = buildFinishedCarousel();
  delete malformed.execution_metadata; // required field
  await assert.rejects(
    () => executeProductionAssetExport(malformed, "/tmp/exports", { adapter }),
    InvalidFinishedCarouselForExportError
  );
  assert.equal(adapter.calls(), 0);
});

test("rejects a carousel whose overall_status is not \"completed\"", async () => {
  const adapter = createFakeAdapter();
  const partial = buildFinishedCarousel({ overall_status: "partial" });
  await assert.rejects(
    () => executeProductionAssetExport(partial, "/tmp/exports", { adapter }),
    (error) => {
      assert.ok(error instanceof CarouselNotEligibleForExportError);
      assert.match(error.message, /overall_status/);
      return true;
    }
  );
  assert.equal(adapter.calls(), 0);
});

test("rejects a carousel that has not been approved", async () => {
  const adapter = createFakeAdapter();
  const unapproved = buildFinishedCarousel({
    approval: { approved: false, approved_by: null, approved_at: null, rejected: false, rejection_reason: null, published: false, published_at: null },
  });
  await assert.rejects(
    () => executeProductionAssetExport(unapproved, "/tmp/exports", { adapter }),
    (error) => {
      assert.ok(error instanceof CarouselNotEligibleForExportError);
      assert.match(error.message, /not been approved/);
      return true;
    }
  );
  assert.equal(adapter.calls(), 0);
});

// --- Destination validation -----------------------------------------------

test("rejects a missing or empty destination", async () => {
  const adapter = createFakeAdapter();
  await assert.rejects(() => executeProductionAssetExport(buildFinishedCarousel(), "", { adapter }), InvalidExportDestinationError);
  await assert.rejects(() => executeProductionAssetExport(buildFinishedCarousel(), undefined, { adapter }), InvalidExportDestinationError);
  assert.equal(adapter.calls(), 0);
});

// --- Successful delegation and safe result mapping ------------------------

test("delegates to the adapter exactly once and maps its result to the safe Production Run-style result", async () => {
  const adapter = createFakeAdapter();
  const carousel = buildFinishedCarousel();
  const result = await executeProductionAssetExport(carousel, "/tmp/exports", { adapter });

  assert.equal(adapter.calls(), 1);
  assert.equal(adapter.seen()[0].finishedCarousel.carousel_id, carousel.carousel_id);
  assert.equal(adapter.seen()[0].destination, "/tmp/exports");

  assert.deepEqual(result, {
    status: "completed",
    assetPackageId: "pkg_faketest0000001",
    exportPath: "/tmp/exports/car_svctest0000001",
    slideCount: 6,
    filesExported: 7,
    alreadyExported: false,
  });
});

test("forwards now/idGenerator through to the adapter for deterministic tests", async () => {
  let observedOptions = null;
  const adapter = {
    name: "spy-adapter",
    async exportPackage(finishedCarousel, destination, options) {
      observedOptions = options;
      return { assetPackageId: "pkg_x", exportPath: destination, slideCount: 6, filesExported: 7, alreadyExported: false, exportedAt: "x" };
    },
  };
  const now = () => "2026-08-04T00:00:00.000Z";
  const idGenerator = () => "pkg_deterministic";
  await executeProductionAssetExport(buildFinishedCarousel(), "/tmp/exports", { adapter, now, idGenerator });
  assert.equal(observedOptions.now, now);
  assert.equal(observedOptions.idGenerator, idGenerator);
});

test("an already-exported result (alreadyExported: true) still maps through cleanly", async () => {
  const adapter = createFakeAdapter({ alreadyExported: true });
  const result = await executeProductionAssetExport(buildFinishedCarousel(), "/tmp/exports", { adapter });
  assert.equal(result.alreadyExported, true);
  assert.equal(result.status, "completed");
});

// Unit tests for local-production-asset-export-adapter.mjs (DC-003-I021).
// Like the rest of this codebase's automated suite, these NEVER reach the
// network: global.fetch is stubbed per-test with a deterministic fake and
// restored immediately afterward. No test in this file makes a real HTTP
// request or requires network access.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalProductionAssetExportAdapter, EXPORT_VERSION } from "../../src/local-production-asset-export-adapter.mjs";
import { SlideDownloadError } from "../../src/production-asset-export-errors.mjs";

// Must await fn(dir) inside the try before the finally runs — fn is
// frequently async here (every test downloads via a stubbed fetch, a
// genuine microtask boundary), and a bare `return fn(dir)` would let the
// finally's rmSync delete the directory while the write is still pending.
async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-export-adapter-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withStubFetch(stubFetch, run) {
  const original = global.fetch;
  global.fetch = stubFetch;
  try {
    await run();
  } finally {
    global.fetch = original;
  }
}

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
    carousel_id: overrides.carousel_id ?? "car_testexportadapter01",
    topic_id: "topic_01J9EXPORTTEST",
    carousel_content_id: "cc_exportadaptertest01",
    generated_at: "2026-08-04T00:00:20.000Z",
    overall_status: "completed",
    slides: overrides.slides ?? slides,
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

function fakeImageResponse(bytes = "fake-png-bytes") {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(bytes).buffer,
  };
}

// --- Deterministic downloads, order, and directory structure -------------

test("downloads all 6 slides in cover, content, statistic, quote, infographic, cta order and writes correctly named files", () =>
  withTempDir((destination) => {
    const requestedUrls = [];
    return withStubFetch(
      async (url) => {
        requestedUrls.push(url);
        return fakeImageResponse(`bytes-for-${url}`);
      },
      async () => {
        const adapter = createLocalProductionAssetExportAdapter();
        const carousel = buildFinishedCarousel();
        const result = await adapter.exportPackage(carousel, destination, { now: () => "2026-08-04T01:00:00.000Z" });

        assert.deepEqual(
          requestedUrls,
          SLIDE_ORDER.map((t) => `https://cdn.example.test/renders/${t}.png`)
        );

        const exportDir = path.join(destination, carousel.carousel_id);
        const filenames = readdirSync(exportDir).sort();
        assert.deepEqual(filenames, [
          "01-cover.png",
          "02-content.png",
          "03-statistic.png",
          "04-quote.png",
          "05-infographic.png",
          "06-cta.png",
          "metadata.json",
        ]);

        assert.equal(result.exportPath, exportDir);
        assert.equal(result.slideCount, 6);
        assert.equal(result.filesExported, 7);
        assert.equal(result.alreadyExported, false);
      }
    );
  }));

test("downloads are ordered by slide_number, not by array position — order is deterministic regardless of input array order", () =>
  withTempDir((destination) => {
    const requestedUrls = [];
    return withStubFetch(
      async (url) => {
        requestedUrls.push(url);
        return fakeImageResponse();
      },
      async () => {
        const adapter = createLocalProductionAssetExportAdapter();
        const shuffled = buildFinishedCarousel();
        // Reverse the array — exportPackage() must still process cover
        // first because it sorts by slide_number, not array order.
        shuffled.slides = [...shuffled.slides].reverse();
        await adapter.exportPackage(shuffled, destination);
        assert.deepEqual(
          requestedUrls,
          SLIDE_ORDER.map((t) => `https://cdn.example.test/renders/${t}.png`)
        );
      }
    );
  }));

// --- metadata.json content -------------------------------------------

test("metadata.json contains exactly the fields already present on the Finished Carousel, plus this export's own identity", () =>
  withTempDir((destination) =>
    withStubFetch(
      async () => fakeImageResponse(),
      async () => {
        const adapter = createLocalProductionAssetExportAdapter();
        const carousel = buildFinishedCarousel();
        const result = await adapter.exportPackage(carousel, destination, {
          now: () => "2026-08-04T01:00:00.000Z",
          idGenerator: () => "pkg_deterministictest01",
        });

        const metadata = JSON.parse(readFileSync(path.join(result.exportPath, "metadata.json"), "utf-8"));
        assert.deepEqual(metadata, {
          asset_package_id: "pkg_deterministictest01",
          carousel_id: carousel.carousel_id,
          carousel_content_id: carousel.carousel_content_id,
          execution_id: carousel.execution_metadata.execution_id,
          topic_id: carousel.topic_id,
          export_timestamp: "2026-08-04T01:00:00.000Z",
          renderer_provider: carousel.execution_metadata.provider,
          render_duration_ms: carousel.execution_metadata.render_duration_ms,
          total_duration_ms: carousel.metadata.total_duration_ms,
          slide_count: carousel.metadata.total_slides,
          export_version: EXPORT_VERSION,
        });
        // llm_model is deliberately absent — not present anywhere on the
        // Finished Carousel Object, and this module never invents it.
        assert.equal("llm_model" in metadata, false);
      }
    )
  ));

// --- Idempotency: never re-fetches, never touches existing files --------

test("a second export of the same carousel makes zero network requests and returns the original identity unchanged", () =>
  withTempDir((destination) => {
    let fetchCallCount = 0;
    return withStubFetch(
      async () => {
        fetchCallCount += 1;
        return fakeImageResponse();
      },
      async () => {
        const adapter = createLocalProductionAssetExportAdapter();
        const carousel = buildFinishedCarousel();

        const first = await adapter.exportPackage(carousel, destination, {
          now: () => "2026-08-04T01:00:00.000Z",
          idGenerator: () => "pkg_firstexport0001",
        });
        assert.equal(fetchCallCount, 6);
        assert.equal(first.alreadyExported, false);

        const second = await adapter.exportPackage(carousel, destination, {
          now: () => "2026-08-04T02:00:00.000Z", // a later clock — must NOT affect the result
          idGenerator: () => "pkg_shouldneverbeused",
        });
        assert.equal(fetchCallCount, 6, "no additional fetch calls on the second, already-complete export");
        assert.equal(second.alreadyExported, true);
        assert.equal(second.assetPackageId, "pkg_firstexport0001", "the original asset_package_id is preserved, not regenerated");
        assert.equal(second.exportedAt, "2026-08-04T01:00:00.000Z", "the original export_timestamp is preserved, not refreshed");
      }
    );
  }));

test("existing PNGs are never touched or corrupted on an idempotent re-export", () =>
  withTempDir((destination) => {
    let fetchCallCount = 0;
    return withStubFetch(
      async () => {
        fetchCallCount += 1;
        return fakeImageResponse();
      },
      async () => {
        const adapter = createLocalProductionAssetExportAdapter();
        const carousel = buildFinishedCarousel();
        const first = await adapter.exportPackage(carousel, destination);

        const coverPath = path.join(first.exportPath, "01-cover.png");
        const originalBytes = readFileSync(coverPath);

        await adapter.exportPackage(carousel, destination);
        assert.equal(fetchCallCount, 6, "the second call must not have downloaded anything again");

        const bytesAfterSecondCall = readFileSync(coverPath);
        assert.ok(originalBytes.equals(bytesAfterSecondCall), "the existing PNG's bytes must be completely unchanged");
      }
    );
  }));

// --- Slide download failure: stops immediately, no metadata.json --------

test("a download failure on slide 3 stops immediately — no requests for slides 4-6, and no metadata.json is written", () =>
  withTempDir((destination) => {
    let callCount = 0;
    return withStubFetch(
      async (url) => {
        callCount += 1;
        if (callCount === 3) {
          return { ok: false, status: 500 };
        }
        return fakeImageResponse();
      },
      async () => {
        const adapter = createLocalProductionAssetExportAdapter();
        const carousel = buildFinishedCarousel();
        await assert.rejects(() => adapter.exportPackage(carousel, destination), SlideDownloadError);
        assert.equal(callCount, 3, "no fetch calls beyond the 3rd (failing) slide");

        const exportDir = path.join(destination, carousel.carousel_id);
        assert.equal(existsSync(path.join(exportDir, "metadata.json")), false, "metadata.json must never exist after a partial export");
      }
    );
  }));

test("a network-level fetch rejection surfaces as SlideDownloadError, naming the slide type", () =>
  withTempDir((destination) =>
    withStubFetch(
      async () => {
        throw new Error("ECONNRESET simulated");
      },
      async () => {
        const adapter = createLocalProductionAssetExportAdapter();
        const carousel = buildFinishedCarousel();
        await assert.rejects(() => adapter.exportPackage(carousel, destination), (error) => {
          assert.ok(error instanceof SlideDownloadError);
          assert.equal(error.slideType, "cover");
          return true;
        });
      }
    )
  ));

test("an empty response body surfaces as SlideDownloadError", () =>
  withTempDir((destination) =>
    withStubFetch(
      async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }),
      async () => {
        const adapter = createLocalProductionAssetExportAdapter();
        const carousel = buildFinishedCarousel();
        await assert.rejects(() => adapter.exportPackage(carousel, destination), SlideDownloadError);
      }
    )
  ));

test("a slide with a null image_url surfaces as SlideDownloadError without ever calling fetch", () =>
  withTempDir((destination) => {
    let fetchCalled = false;
    return withStubFetch(
      async () => {
        fetchCalled = true;
        return fakeImageResponse();
      },
      async () => {
        const adapter = createLocalProductionAssetExportAdapter();
        const carousel = buildFinishedCarousel();
        carousel.slides[0].image_url = null;
        await assert.rejects(() => adapter.exportPackage(carousel, destination), SlideDownloadError);
        assert.equal(fetchCalled, false);
      }
    );
  }));

// --- No corruption on unrelated pre-existing files -----------------------

test("does not disturb an unrelated file already present in the destination root", () =>
  withTempDir((destination) => {
    writeFileSync(path.join(destination, "unrelated.txt"), "leave me alone", "utf-8");
    return withStubFetch(
      async () => fakeImageResponse(),
      async () => {
        const adapter = createLocalProductionAssetExportAdapter();
        await adapter.exportPackage(buildFinishedCarousel(), destination);
        assert.equal(readFileSync(path.join(destination, "unrelated.txt"), "utf-8"), "leave me alone");
      }
    );
  }));

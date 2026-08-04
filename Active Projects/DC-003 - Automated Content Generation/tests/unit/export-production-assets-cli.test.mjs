// Unit tests for tests/validation/export-production-assets.mjs
// (DC-003-I021). No real network: global.fetch is stubbed via a --import
// preload module written to a temp file for the duration of each test that
// needs the CLI to actually attempt a download (the same technique
// generate-live-carousel-cli.test.mjs already established for I019.1). No
// test in this file makes a real HTTP request.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "export-production-assets.mjs");

const SLIDE_ORDER = ["cover", "content", "statistic", "quote", "infographic", "cta"];

// Must await fn(dir) inside the try before the finally runs — several
// tests here nest withTempDir calls with async work inside, and a bare
// `return fn(dir)` would let the finally's rmSync delete the directory
// before that work completes.
async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-export-cli-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
    carousel_id: overrides.carousel_id ?? "car_clitest00000001",
    topic_id: "topic_01J9CLIEXPORTTEST",
    carousel_content_id: "cc_clitest00000001",
    generated_at: "2026-08-04T00:00:20.000Z",
    overall_status: overrides.overall_status ?? "completed",
    slides,
    metadata: { total_slides: 6, completed_slides: 6, failed_slides: 0, total_duration_ms: 18000 },
    execution_metadata: {
      execution_id: "exec_20260804_deadbeefcafe",
      rendered_at: "2026-08-04T00:00:20.000Z",
      provider: "templated-http",
      render_duration_ms: 18000,
    },
    approval: overrides.approval ?? {
      approved: true,
      approved_by: "chris@digitallyconnected.net",
      approved_at: "2026-08-04T00:00:10.000Z",
      rejected: false,
      rejection_reason: null,
      published: false,
      published_at: null,
    },
  };
}

function seedStore(storeDir, finishedCarousel) {
  const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: storeDir }) });
  store.save(finishedCarousel);
}

function writeFetchStubPreload(dir) {
  const preloadPath = path.join(dir, "stub-fetch-images.mjs");
  writeFileSync(
    preloadPath,
    `globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("fake-bytes-for:" + url).buffer,
    });\n`,
    "utf-8"
  );
  return preloadPath;
}

function runCliWithStubbedFetch(args, preloadDir) {
  const preloadPath = writeFetchStubPreload(preloadDir);
  return spawnSync(process.execPath, ["--import", preloadPath, CLI_PATH, ...args], { encoding: "utf-8" });
}

// --- Usage -----------------------------------------------------------

test("no arguments prints usage and exits non-zero", () => {
  const result = spawnSync(process.execPath, [CLI_PATH], { encoding: "utf-8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: node tests\/validation\/export-production-assets\.mjs/);
});

test("missing destination prints usage and exits non-zero", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "car_x", "/some/store"], { encoding: "utf-8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

// --- Successful export ----------------------------------------------

test("exports an approved, completed carousel from the store: 6 PNGs in order plus metadata.json", () =>
  withTempDir((storeDir) =>
    withTempDir((destination) =>
      withTempDir((preloadDir) => {
        const carousel = buildFinishedCarousel();
        seedStore(storeDir, carousel);

        const result = runCliWithStubbedFetch([carousel.carousel_id, storeDir, destination], preloadDir);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Export complete/);
        assert.match(result.stdout, /files exported:\s*7/);
        assert.match(result.stdout, /already exported:\s*false/);

        const exportDir = path.join(destination, carousel.carousel_id);
        const files = readdirSync(exportDir).sort();
        assert.deepEqual(files, [
          "01-cover.png",
          "02-content.png",
          "03-statistic.png",
          "04-quote.png",
          "05-infographic.png",
          "06-cta.png",
          "metadata.json",
        ]);
      })
    )
  ));

test("re-running the export CLI against the same carousel is idempotent and reports already exported", () =>
  withTempDir((storeDir) =>
    withTempDir((destination) =>
      withTempDir((preloadDir) => {
        const carousel = buildFinishedCarousel({ carousel_id: "car_idempotentcli001" });
        seedStore(storeDir, carousel);

        const first = runCliWithStubbedFetch([carousel.carousel_id, storeDir, destination], preloadDir);
        assert.equal(first.status, 0, first.stderr);
        assert.match(first.stdout, /already exported:\s*false/);

        const second = runCliWithStubbedFetch([carousel.carousel_id, storeDir, destination], preloadDir);
        assert.equal(second.status, 0, second.stderr);
        assert.match(second.stdout, /Export already complete/);
        assert.match(second.stdout, /already exported:\s*true/);
      })
    )
  ));

// --- Safe failure paths ------------------------------------------------

test("an unknown carousel ID exits non-zero with a safe error, not a stack trace", () =>
  withTempDir((storeDir) =>
    withTempDir((destination) => {
      const result = spawnSync(process.execPath, [CLI_PATH, "car_doesnotexist00000001", storeDir, destination], { encoding: "utf-8" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /CarouselNotFoundError/);
      assert.doesNotMatch(result.stderr, /at file:\/\//);
    })
  ));

test("an unapproved carousel is rejected with a safe error, and no files are written", () =>
  withTempDir((storeDir) =>
    withTempDir((destination) => {
      const carousel = buildFinishedCarousel({
        carousel_id: "car_unapprovedcli001",
        approval: { approved: false, approved_by: null, approved_at: null, rejected: false, rejection_reason: null, published: false, published_at: null },
      });
      seedStore(storeDir, carousel);

      const result = spawnSync(process.execPath, [CLI_PATH, carousel.carousel_id, storeDir, destination], { encoding: "utf-8" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /CarouselNotEligibleForExportError/);
      assert.match(result.stderr, /not been approved/);
    })
  ));

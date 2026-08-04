// Unit tests for windows-production-export-service.mjs (DC-003-I026).
// Uses a small fake I021 Export Adapter that writes REAL bytes to a real
// temp directory (unlike I021's own service tests, which only exercise
// validation logic against a fake exportPath string) — this service's
// own copy step performs real filesystem I/O against whatever
// `archiveResult.exportPath` names, so the fake adapter here must produce
// a genuine archive directory for that copy step to operate on. No
// network anywhere: the fake adapter never calls fetch(), and a global
// fetch spy asserts that explicitly.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { approveCarousel, rejectCarousel } from "../../src/carousel-approval.mjs";
import { executeWindowsProductionExport } from "../../src/windows-production-export-service.mjs";
import { CarouselNotEligibleForExportError } from "../../src/production-asset-export-errors.mjs";
import {
  WindowsDeliveryConflictError,
  WindowsDeliveryPartialPackageError,
} from "../../src/windows-production-export-errors.mjs";
import { CarouselNotFoundError, InvalidCarouselIdentifierError } from "../../src/finished-carousel-store-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

function loadFreshCarousel(overrides = {}) {
  const carousel = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  return { ...carousel, ...overrides };
}

// Must await fn(...) inside the try before the finally runs — several
// tests below make multiple sequential await calls, and a bare
// `return fn(...)` would let the finally's rmSync race ahead and delete
// the directory before that work completes (the exact `withTempDir`
// non-async-aware bug this project has hit — and fixed — twice before,
// in I021 and I021's own export adapter tests).
async function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-windows-export-"));
  const carouselDir = path.join(base, "carousels");
  const archiveRoot = path.join(base, "archive");
  const windowsRoot = path.join(base, "windows");
  try {
    return await fn({ base, carouselDir, archiveRoot, windowsRoot });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

// Mirrors local-production-asset-export-adapter.mjs's own real behaviour
// (metadata.json present + parseable + carousel_id matches = already
// exported) but writes deterministic fake bytes instead of downloading
// from a real CDN — no network anywhere in this file.
function createFakeArchiveAdapter() {
  let calls = 0;
  return {
    name: "fake-archive-adapter",
    calls: () => calls,
    async exportPackage(finishedCarousel, destination) {
      calls += 1;
      const exportDir = path.join(destination, finishedCarousel.carousel_id);
      const metadataPath = path.join(exportDir, "metadata.json");
      if (existsSync(metadataPath)) {
        const existing = JSON.parse(readFileSync(metadataPath, "utf-8"));
        return { assetPackageId: existing.asset_package_id, exportPath: exportDir, slideCount: 6, filesExported: 7, alreadyExported: true, exportedAt: existing.export_timestamp };
      }
      mkdirSync(exportDir, { recursive: true });
      for (const slide of finishedCarousel.slides) {
        writeFileSync(path.join(exportDir, `${String(slide.slide_number).padStart(2, "0")}-${slide.slide_type}.png`), Buffer.from(`fake-png-bytes-${slide.slide_number}`));
      }
      const metadata = { asset_package_id: "pkg_windowstest0001", carousel_id: finishedCarousel.carousel_id, execution_id: finishedCarousel.execution_metadata.execution_id };
      writeFileSync(metadataPath, JSON.stringify(metadata));
      return { assetPackageId: "pkg_windowstest0001", exportPath: exportDir, slideCount: 6, filesExported: 7, alreadyExported: false, exportedAt: "2026-08-05T00:00:00.000Z" };
    },
  };
}

function buildStoreAndApprovedCarousel(carouselDir, carouselId, extraOverrides = {}) {
  const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselDir }) });
  store.save(loadFreshCarousel({ carousel_id: carouselId, ...extraOverrides }));
  const approved = approveCarousel({ finishedCarousel: store.get(carouselId), approvedBy: "tester" });
  store.replace({ identifier: carouselId, finishedCarousel: approved });
  return store;
}

// --- no-network guarantee ----------------------------------------------

test("never calls global fetch — no external requests anywhere in this service", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      throw new Error("fetch must never be called");
    };
    try {
      const store = buildStoreAndApprovedCarousel(carouselDir, "car_nonetwork0001");
      await executeWindowsProductionExport(
        { carouselId: "car_nonetwork0001" },
        { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
      );
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }));

// --- approval requirement (reuses I021's own eligibility check) --------

test("rejects an unapproved carousel with CarouselNotEligibleForExportError, before any copy is attempted", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselDir }) });
    store.save(loadFreshCarousel({ carousel_id: "car_unapproved0001" }));

    await assert.rejects(
      () =>
        executeWindowsProductionExport(
          { carouselId: "car_unapproved0001" },
          { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
        ),
      CarouselNotEligibleForExportError
    );
    assert.equal(existsSync(windowsRoot), false, "no Windows delivery directory should ever be created for an unapproved carousel");
  }));

test("rejects a rejected carousel with CarouselNotEligibleForExportError", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselDir }) });
    const rejected = rejectCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_rejected00001" }), reason: "not good enough" });
    store.save(rejected);

    await assert.rejects(
      () =>
        executeWindowsProductionExport(
          { carouselId: "car_rejected00001" },
          { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
        ),
      CarouselNotEligibleForExportError
    );
  }));

test("rejects an incomplete (not overall_status: completed) carousel", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselDir }) });
    const approvedButPartial = approveCarousel({
      finishedCarousel: loadFreshCarousel({ carousel_id: "car_incomplete0001", overall_status: "partial" }),
      approvedBy: "tester",
    });
    store.save(approvedButPartial);

    await assert.rejects(
      () =>
        executeWindowsProductionExport(
          { carouselId: "car_incomplete0001" },
          { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
        ),
      CarouselNotEligibleForExportError
    );
  }));

test("propagates CarouselNotFoundError for an unknown carousel_id, and InvalidCarouselIdentifierError (path-traversal protection) for a malformed one — both reused from I015, not reinvented", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselDir }) });

    await assert.rejects(
      () =>
        executeWindowsProductionExport(
          { carouselId: "car_doesnotexist0000" },
          { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
        ),
      CarouselNotFoundError
    );

    await assert.rejects(
      () =>
        executeWindowsProductionExport(
          { carouselId: "../../../../etc/passwd" },
          { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
        ),
      InvalidCarouselIdentifierError
    );
  }));

// --- successful delivery --------------------------------------------------

test("copies all seven files with canonical filenames preserved, byte-identical to the archive source", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = buildStoreAndApprovedCarousel(carouselDir, "car_success0000001");
    const result = await executeWindowsProductionExport(
      { carouselId: "car_success0000001" },
      { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
    );

    assert.equal(result.status, "completed");
    assert.equal(result.windowsDelivery.filesCopied, 7);
    assert.equal(result.verifiedIdentical, true);

    const archiveDir = path.join(archiveRoot, "car_success0000001");
    const windowsDir = path.join(windowsRoot, "car_success0000001");
    const expectedFiles = ["01-cover.png", "02-content.png", "03-statistic.png", "04-quote.png", "05-infographic.png", "06-cta.png", "metadata.json"];

    assert.deepEqual(readdirSync(windowsDir).sort(), expectedFiles.sort());
    for (const filename of expectedFiles) {
      assert.equal(
        Buffer.compare(readFileSync(path.join(archiveDir, filename)), readFileSync(path.join(windowsDir, filename))),
        0,
        `${filename} must be byte-identical between archive and Windows delivery`
      );
    }
  }));

test("archive discovery: a second real invocation confirms the already-complete archive (I021's own alreadyExported path) rather than recreating it", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = buildStoreAndApprovedCarousel(carouselDir, "car_discover0000001");
    const adapter = createFakeArchiveAdapter();

    await executeWindowsProductionExport({ carouselId: "car_discover0000001" }, { finishedCarouselStore: store, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot });
    assert.equal(adapter.calls(), 1);

    await executeWindowsProductionExport({ carouselId: "car_discover0000001" }, { finishedCarouselStore: store, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot });
    assert.equal(adapter.calls(), 2, "I021's own executeProductionAssetExport() is still called each time (its own idempotency check lives inside it), but makes zero network requests on the second call");
  }));

test("an identical rerun is a verified no-op — zero files copied", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = buildStoreAndApprovedCarousel(carouselDir, "car_noop0000000001");
    const adapter = createFakeArchiveAdapter();

    await executeWindowsProductionExport({ carouselId: "car_noop0000000001" }, { finishedCarouselStore: store, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot });
    const second = await executeWindowsProductionExport({ carouselId: "car_noop0000000001" }, { finishedCarouselStore: store, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot });

    assert.equal(second.windowsDelivery.filesCopied, 0);
    assert.equal(second.verifiedIdentical, true);
  }));

test("the Docker archive source is never modified by the Windows delivery step", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = buildStoreAndApprovedCarousel(carouselDir, "car_archiveintact001");
    await executeWindowsProductionExport(
      { carouselId: "car_archiveintact001" },
      { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
    );

    const archiveDir = path.join(archiveRoot, "car_archiveintact001");
    const before = readdirSync(archiveDir)
      .sort()
      .map((name) => readFileSync(path.join(archiveDir, name)));

    // Run again (idempotent path) — the archive must remain byte-identical.
    await executeWindowsProductionExport(
      { carouselId: "car_archiveintact001" },
      { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
    );
    const after = readdirSync(archiveDir)
      .sort()
      .map((name) => readFileSync(path.join(archiveDir, name)));

    assert.deepEqual(before, after);
  }));

test("no atomic-write temp files are left behind after a successful delivery", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = buildStoreAndApprovedCarousel(carouselDir, "car_notempfiles0001");
    await executeWindowsProductionExport(
      { carouselId: "car_notempfiles0001" },
      { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
    );
    const windowsDir = path.join(windowsRoot, "car_notempfiles0001");
    const leftoverTempFiles = readdirSync(windowsDir).filter((name) => name.startsWith("."));
    assert.deepEqual(leftoverTempFiles, []);
  }));

// --- completion signal / partial destination handling ----------------------

test("a destination with the six images already present but no metadata.json is treated as incomplete, never as ready — proves metadata.json is the sole completion signal", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = buildStoreAndApprovedCarousel(carouselDir, "car_halfdone0000001");
    const adapter = createFakeArchiveAdapter();

    // Populate the archive first (so we know the exact real bytes)...
    await adapter.exportPackage(store.get("car_halfdone0000001"), archiveRoot);
    const archiveDir = path.join(archiveRoot, "car_halfdone0000001");

    // ...then hand-simulate an interrupted prior Windows copy: every image
    // byte-correct, but metadata.json never got written.
    const windowsDir = path.join(windowsRoot, "car_halfdone0000001");
    mkdirSync(windowsDir, { recursive: true });
    for (const name of readdirSync(archiveDir).filter((n) => n !== "metadata.json")) {
      writeFileSync(path.join(windowsDir, name), readFileSync(path.join(archiveDir, name)));
    }

    await assert.rejects(
      () =>
        executeWindowsProductionExport(
          { carouselId: "car_halfdone0000001" },
          { finishedCarouselStore: store, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot }
        ),
      WindowsDeliveryPartialPackageError
    );
  }));

test("--replace repairs a partial destination into a complete, verified package", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = buildStoreAndApprovedCarousel(carouselDir, "car_repairpartial01");
    const adapter = createFakeArchiveAdapter();
    await adapter.exportPackage(store.get("car_repairpartial01"), archiveRoot);
    const archiveDir = path.join(archiveRoot, "car_repairpartial01");
    const windowsDir = path.join(windowsRoot, "car_repairpartial01");
    mkdirSync(windowsDir, { recursive: true });
    writeFileSync(path.join(windowsDir, "01-cover.png"), readFileSync(path.join(archiveDir, "01-cover.png")));

    const result = await executeWindowsProductionExport(
      { carouselId: "car_repairpartial01" },
      { finishedCarouselStore: store, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot, replace: true }
    );

    assert.equal(result.verifiedIdentical, true);
    assert.equal(result.windowsDelivery.filesCopied, 7);
  }));

// --- conflict / replacement -------------------------------------------------

test("a conflicting completed destination fails with WindowsDeliveryConflictError by default, and never modifies the conflicting content", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = buildStoreAndApprovedCarousel(carouselDir, "car_conflict0000001");
    const adapter = createFakeArchiveAdapter();
    await executeWindowsProductionExport({ carouselId: "car_conflict0000001" }, { finishedCarouselStore: store, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot });

    const windowsDir = path.join(windowsRoot, "car_conflict0000001");
    writeFileSync(path.join(windowsDir, "01-cover.png"), Buffer.from("DELIBERATELY-CORRUPTED"));
    const corruptedBytesBefore = readFileSync(path.join(windowsDir, "01-cover.png"));

    await assert.rejects(
      () =>
        executeWindowsProductionExport(
          { carouselId: "car_conflict0000001" },
          { finishedCarouselStore: store, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot }
        ),
      WindowsDeliveryConflictError
    );

    assert.deepEqual(readFileSync(path.join(windowsDir, "01-cover.png")), corruptedBytesBefore, "the conflicting file must be untouched — never silently overwritten without --replace");
  }));

test("--replace overwrites a conflicting destination and re-verifies identical", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = buildStoreAndApprovedCarousel(carouselDir, "car_replaceok0000001");
    const adapter = createFakeArchiveAdapter();
    await executeWindowsProductionExport({ carouselId: "car_replaceok0000001" }, { finishedCarouselStore: store, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot });

    const windowsDir = path.join(windowsRoot, "car_replaceok0000001");
    writeFileSync(path.join(windowsDir, "01-cover.png"), Buffer.from("DELIBERATELY-CORRUPTED"));

    const result = await executeWindowsProductionExport(
      { carouselId: "car_replaceok0000001" },
      { finishedCarouselStore: store, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot, replace: true }
    );
    assert.equal(result.verifiedIdentical, true);
    assert.equal(result.windowsDelivery.filesCopied, 7);
  }));

// --- safe errors: never leak a raw filesystem path -------------------------

test("no thrown error message ever contains the temp directory's own raw filesystem path", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot, base }) => {
    const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselDir }) });
    try {
      await executeWindowsProductionExport(
        { carouselId: "car_doesnotexist0000" },
        { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
      );
      assert.fail("expected an error");
    } catch (error) {
      assert.doesNotMatch(error.message, new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    const conflictStore = buildStoreAndApprovedCarousel(carouselDir, "car_safeerror0000001");
    const adapter = createFakeArchiveAdapter();
    await executeWindowsProductionExport({ carouselId: "car_safeerror0000001" }, { finishedCarouselStore: conflictStore, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot });
    writeFileSync(path.join(windowsRoot, "car_safeerror0000001", "01-cover.png"), Buffer.from("CORRUPTED"));
    try {
      await executeWindowsProductionExport({ carouselId: "car_safeerror0000001" }, { finishedCarouselStore: conflictStore, archiveAdapter: adapter, archiveRoot, windowsDeliveryRoot: windowsRoot });
      assert.fail("expected WindowsDeliveryConflictError");
    } catch (error) {
      assert.doesNotMatch(error.message, new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(error.message, /at file:\/\//);
    }
  }));

// --- result contract --------------------------------------------------

test("the result never exposes a raw Windows host path — only container-visible references", () =>
  withTempDirs(async ({ carouselDir, archiveRoot, windowsRoot }) => {
    const store = buildStoreAndApprovedCarousel(carouselDir, "car_resultshape0001");
    const result = await executeWindowsProductionExport(
      { carouselId: "car_resultshape0001" },
      { finishedCarouselStore: store, archiveAdapter: createFakeArchiveAdapter(), archiveRoot, windowsDeliveryRoot: windowsRoot }
    );
    assert.deepEqual(Object.keys(result).sort(), ["archive", "assetPackageId", "carouselId", "status", "verifiedIdentical", "windowsDelivery"].sort());
    assert.deepEqual(Object.keys(result.archive).sort(), ["reference", "status"].sort());
    assert.deepEqual(Object.keys(result.windowsDelivery).sort(), ["filesCopied", "reference", "status"].sort());
    assert.doesNotMatch(result.archive.reference, /^[A-Za-z]:\\/, "reference fields are container-visible, never a raw Windows host path");
    assert.doesNotMatch(result.windowsDelivery.reference, /^[A-Za-z]:\\/);
  }));

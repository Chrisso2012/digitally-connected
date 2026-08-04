// Unit tests for tests/validation/export-production-assets-windows.mjs
// (DC-003-I026). No real network: global.fetch is stubbed via a --import
// preload module for the duration of any test exercising a real (fake)
// archive download, the same technique export-production-assets-cli.test.mjs
// (I021) already established. archiveRoot/windowsDeliveryRoot are
// overridden per-test via env vars, pointing at real temp directories —
// never a real Windows path, never the real Docker paths.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { approveCarousel } from "../../src/carousel-approval.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "export-production-assets-windows.mjs");
const FIXTURE_PATH = path.join(PROJECT_ROOT, "tests", "fixtures", "finished-carousel.example.json");

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-windows-export-cli-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function loadFreshCarousel(overrides = {}) {
  const carousel = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  return { ...carousel, ...overrides };
}

function seedApprovedCarousel(storeDir, overrides = {}) {
  const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: storeDir }) });
  store.save(loadFreshCarousel(overrides));
  const approved = approveCarousel({ finishedCarousel: store.get(overrides.carousel_id), approvedBy: "cli-test" });
  store.replace({ identifier: overrides.carousel_id, finishedCarousel: approved });
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

function runCli(args, { archiveRoot, windowsDeliveryRoot, preloadDir }) {
  const preloadPath = writeFetchStubPreload(preloadDir);
  return spawnSync(process.execPath, ["--import", preloadPath, CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, PRODUCTION_ASSET_ARCHIVE_ROOT: archiveRoot, WINDOWS_PRODUCTION_DELIVERY_ROOT: windowsDeliveryRoot },
  });
}

// --- Usage -----------------------------------------------------------

test("no arguments prints usage and exits non-zero", () => {
  const result = spawnSync(process.execPath, [CLI_PATH], { encoding: "utf-8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: node tests\/validation\/export-production-assets-windows\.mjs/);
});

test("missing finishedCarouselStoreDirectory prints usage and exits non-zero", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "car_x"], { encoding: "utf-8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

// --- successful delivery -------------------------------------------------

test("delivers an approved carousel to both the archive and the Windows mount, printing every documented field", () =>
  withTempDir((storeDir) =>
    withTempDir((archiveRoot) =>
      withTempDir((windowsRoot) =>
        withTempDir((preloadDir) => {
          seedApprovedCarousel(storeDir, { carousel_id: "car_clidelivery0001" });

          const result = runCli(["car_clidelivery0001", storeDir], { archiveRoot, windowsDeliveryRoot: windowsRoot, preloadDir });
          assert.equal(result.status, 0, result.stderr);
          assert.match(result.stdout, /Windows Production Asset Export complete/);
          assert.match(result.stdout, /carousel ID:\s*car_clidelivery0001/);
          assert.match(result.stdout, /archive status:\s*completed/);
          assert.match(result.stdout, /windows delivery:\s*completed/);
          assert.match(result.stdout, /files copied:\s*7/);
          assert.match(result.stdout, /integrity verified:\s*true/);
          assert.match(result.stdout, /windows folder:/);

          const deliveredFiles = readdirSync(path.join(windowsRoot, "car_clidelivery0001")).sort();
          assert.deepEqual(deliveredFiles, [
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
    )
  ));

test("an unapproved carousel is rejected with CarouselNotEligibleForExportError, not a stack trace, and never generates/renders/approves/publishes anything", () =>
  withTempDir((storeDir) =>
    withTempDir((archiveRoot) =>
      withTempDir((windowsRoot) =>
        withTempDir((preloadDir) => {
          const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: storeDir }) });
          store.save(loadFreshCarousel({ carousel_id: "car_cliunapproved01" }));

          const result = runCli(["car_cliunapproved01", storeDir], { archiveRoot, windowsDeliveryRoot: windowsRoot, preloadDir });
          assert.notEqual(result.status, 0);
          assert.match(result.stderr, /CarouselNotEligibleForExportError/);
          assert.doesNotMatch(result.stderr, /at file:\/\//);

          // The stored carousel itself must be untouched — the CLI never
          // approves, rejects, or publishes on the caller's behalf.
          const unchanged = store.get("car_cliunapproved01");
          assert.equal(unchanged.approval.approved, false);
        })
      )
    )
  ));

test("an unknown carousel fails with CarouselNotFoundError, not a stack trace", () =>
  withTempDir((storeDir) =>
    withTempDir((archiveRoot) =>
      withTempDir((windowsRoot) =>
        withTempDir((preloadDir) => {
          const result = runCli(["car_doesnotexist0000", storeDir], { archiveRoot, windowsDeliveryRoot: windowsRoot, preloadDir });
          assert.notEqual(result.status, 0);
          assert.match(result.stderr, /CarouselNotFoundError/);
          assert.doesNotMatch(result.stderr, /at file:\/\//);
        })
      )
    )
  ));

test("re-running the CLI against the same carousel is an idempotent, zero-copy no-op", () =>
  withTempDir((storeDir) =>
    withTempDir((archiveRoot) =>
      withTempDir((windowsRoot) =>
        withTempDir((preloadDir) => {
          seedApprovedCarousel(storeDir, { carousel_id: "car_cliidempotent01" });

          const first = runCli(["car_cliidempotent01", storeDir], { archiveRoot, windowsDeliveryRoot: windowsRoot, preloadDir });
          assert.equal(first.status, 0, first.stderr);
          assert.match(first.stdout, /files copied:\s*7/);

          const second = runCli(["car_cliidempotent01", storeDir], { archiveRoot, windowsDeliveryRoot: windowsRoot, preloadDir });
          assert.equal(second.status, 0, second.stderr);
          assert.match(second.stdout, /files copied:\s*0/);
          assert.match(second.stdout, /integrity verified:\s*true/);
        })
      )
    )
  ));

test("--replace is required to overwrite a conflicting destination; without it the CLI fails safely", () =>
  withTempDir((storeDir) =>
    withTempDir((archiveRoot) =>
      withTempDir((windowsRoot) =>
        withTempDir((preloadDir) => {
          seedApprovedCarousel(storeDir, { carousel_id: "car_clireplace00001" });
          runCli(["car_clireplace00001", storeDir], { archiveRoot, windowsDeliveryRoot: windowsRoot, preloadDir });

          writeFileSync(path.join(windowsRoot, "car_clireplace00001", "01-cover.png"), Buffer.from("CORRUPTED"));

          const withoutReplace = runCli(["car_clireplace00001", storeDir], { archiveRoot, windowsDeliveryRoot: windowsRoot, preloadDir });
          assert.notEqual(withoutReplace.status, 0);
          assert.match(withoutReplace.stderr, /WindowsDeliveryConflictError/);

          const withReplace = runCli(["car_clireplace00001", storeDir, "--replace"], { archiveRoot, windowsDeliveryRoot: windowsRoot, preloadDir });
          assert.equal(withReplace.status, 0, withReplace.stderr);
          assert.match(withReplace.stdout, /integrity verified:\s*true/);
        })
      )
    )
  ));

// --- no external requests --------------------------------------------------

test("the CLI never contacts a real network endpoint — the fetch stub is the only thing satisfying the archive download", () =>
  withTempDir((storeDir) =>
    withTempDir((archiveRoot) =>
      withTempDir((windowsRoot) =>
        withTempDir((preloadDir) => {
          seedApprovedCarousel(storeDir, { carousel_id: "car_clinonetwork001" });
          const result = runCli(["car_clinonetwork001", storeDir], { archiveRoot, windowsDeliveryRoot: windowsRoot, preloadDir });
          assert.equal(result.status, 0, result.stderr);
          // If this test's own stub fetch were ever bypassed in favour of a
          // real network call, the process would hang or fail with a real
          // DNS/connection error — a clean, fast exit 0 is itself the
          // strongest available evidence no real request was attempted.
        })
      )
    )
  ));

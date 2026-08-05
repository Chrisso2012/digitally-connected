// Unit tests for tests/validation/publish-social-assets.mjs (DC-003-I027).
// No real network: default (mock) mode never constructs a real platform
// adapter, and every --live credential-gate test is guaranteed to return
// before any request is attempted.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { approveCarousel } from "../../src/carousel-approval.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "publish-social-assets.mjs");
const FIXTURE_PATH = path.join(PROJECT_ROOT, "tests", "fixtures", "finished-carousel.example.json");

const CLEAN_ENV = {
  ...process.env,
  INSTAGRAM_ACCESS_TOKEN: undefined,
  INSTAGRAM_USER_ID: undefined,
  LINKEDIN_ACCESS_TOKEN: undefined,
  LINKEDIN_AUTHOR_URN: undefined,
  LINKEDIN_API_VERSION: undefined,
};

function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-social-cli-"));
  try {
    return fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function seedApprovedCarousel(carouselDir, carouselId) {
  const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselDir }) });
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  store.save({ ...fixture, carousel_id: carouselId });
  const approved = approveCarousel({ finishedCarousel: store.get(carouselId), approvedBy: "cli-test" });
  store.replace({ identifier: carouselId, finishedCarousel: approved });
}

function seedAssetPackage(assetPackageRoot, carouselId, assetPackageId) {
  const dir = path.join(assetPackageRoot, carouselId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ carousel_id: carouselId, asset_package_id: assetPackageId }));
  for (const name of ["01-cover.png", "02-content.png", "03-statistic.png", "04-quote.png", "05-infographic.png", "06-cta.png"]) {
    writeFileSync(path.join(dir, name), Buffer.from("fake-" + name));
  }
}

function writeManifest(manifestPath, overrides = {}) {
  const manifest = {
    manifest_id: "spm_clitest0000000001",
    carousel_id: "car_clitest0000001",
    asset_package_id: "pkg_clitest0000001",
    created_at: "2026-08-05T10:00:00Z",
    approval: { approved: true, approved_by: "tester", approved_at: "2026-08-05T10:00:00Z" },
    destinations: {
      instagram: { enabled: true, caption: "SECRET_CLI_CAPTION", alt_text: "alt" },
      linkedin: { enabled: true, commentary: "SECRET_CLI_COMMENTARY" },
    },
    ...overrides,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifest;
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8", env: { ...CLEAN_ENV, ...env } });
}

// --- usage -----------------------------------------------------------

test("missing arguments print usage and exit non-zero", () => {
  const result = runCli([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: node tests\/validation\/publish-social-assets\.mjs/);
});

// --- mock (default) path -------------------------------------------------

test("mock (default) publish succeeds for both destinations and never prints the caption/commentary", () =>
  withTempDirs((base) => {
    const carouselDir = path.join(base, "carousels");
    const publisherResultDir = path.join(base, "publisher-results");
    const assetPackageRoot = path.join(base, "packages");
    const manifestPath = path.join(base, "manifest.json");

    seedApprovedCarousel(carouselDir, "car_clitest0000001");
    seedAssetPackage(assetPackageRoot, "car_clitest0000001", "pkg_clitest0000001");
    writeManifest(manifestPath);

    const result = runCli([manifestPath, carouselDir, publisherResultDir, assetPackageRoot]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Manifest ID:\s*spm_clitest0000000001/);
    assert.match(result.stdout, /Carousel ID:\s*car_clitest0000001/);
    assert.match(result.stdout, /Enabled destinations:\s*instagram, linkedin/);
    assert.match(result.stdout, /instagram\s+status=completed/);
    assert.match(result.stdout, /linkedin\s+status=completed/);
    assert.match(result.stdout, /Overall status: completed/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_CAPTION/);
    assert.doesNotMatch(result.stdout, /SECRET_CLI_COMMENTARY/);
  }));

test("a disabled destination is never attempted and is not listed as enabled", () =>
  withTempDirs((base) => {
    const carouselDir = path.join(base, "carousels");
    const publisherResultDir = path.join(base, "publisher-results");
    const assetPackageRoot = path.join(base, "packages");
    const manifestPath = path.join(base, "manifest.json");

    seedApprovedCarousel(carouselDir, "car_clitest0000001");
    seedAssetPackage(assetPackageRoot, "car_clitest0000001", "pkg_clitest0000001");
    writeManifest(manifestPath, { destinations: { instagram: { enabled: true, caption: "cap", alt_text: "alt" }, linkedin: { enabled: false, commentary: null } } });

    const result = runCli([manifestPath, carouselDir, publisherResultDir, assetPackageRoot]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Enabled destinations:\s*instagram$/m);
    assert.match(result.stdout, /linkedin\s+status=disabled/);
  }));

test("a duplicate rerun reports 'duplicate' for both destinations and exits non-zero (nothing new happened)", () =>
  withTempDirs((base) => {
    const carouselDir = path.join(base, "carousels");
    const publisherResultDir = path.join(base, "publisher-results");
    const assetPackageRoot = path.join(base, "packages");
    const manifestPath = path.join(base, "manifest.json");

    seedApprovedCarousel(carouselDir, "car_clitest0000001");
    seedAssetPackage(assetPackageRoot, "car_clitest0000001", "pkg_clitest0000001");
    writeManifest(manifestPath);

    const first = runCli([manifestPath, carouselDir, publisherResultDir, assetPackageRoot]);
    assert.equal(first.status, 0, first.stderr);

    const second = runCli([manifestPath, carouselDir, publisherResultDir, assetPackageRoot]);
    assert.notEqual(second.status, 0);
    assert.match(second.stdout, /instagram\s+status=duplicate/);
    assert.match(second.stdout, /linkedin\s+status=duplicate/);
  }));

test("an unapproved carousel fails with CarouselNotEligibleForSocialPublishError, not a stack trace", () =>
  withTempDirs((base) => {
    const carouselDir = path.join(base, "carousels");
    const publisherResultDir = path.join(base, "publisher-results");
    const assetPackageRoot = path.join(base, "packages");
    const manifestPath = path.join(base, "manifest.json");

    const store = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselDir }) });
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
    store.save({ ...fixture, carousel_id: "car_clitest0000001" });
    seedAssetPackage(assetPackageRoot, "car_clitest0000001", "pkg_clitest0000001");
    writeManifest(manifestPath);

    const result = runCli([manifestPath, carouselDir, publisherResultDir, assetPackageRoot]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CarouselNotEligibleForSocialPublishError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

// --- explicit live-mode gate: credentials required only for enabled destinations

test("--live without any credentials fails fast, before any request, naming exactly the missing Instagram/LinkedIn variables", () =>
  withTempDirs((base) => {
    const carouselDir = path.join(base, "carousels");
    const publisherResultDir = path.join(base, "publisher-results");
    const assetPackageRoot = path.join(base, "packages");
    const manifestPath = path.join(base, "manifest.json");

    seedApprovedCarousel(carouselDir, "car_clitest0000001");
    seedAssetPackage(assetPackageRoot, "car_clitest0000001", "pkg_clitest0000001");
    writeManifest(manifestPath);

    const result = runCli([manifestPath, carouselDir, publisherResultDir, assetPackageRoot, "--live"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--live requires INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID/);
    assert.doesNotMatch(result.stdout, /status=completed/, "must fail before any destination is attempted");
  }));

test("--live only requires credentials for the destinations the manifest actually enables", () =>
  withTempDirs((base) => {
    const carouselDir = path.join(base, "carousels");
    const publisherResultDir = path.join(base, "publisher-results");
    const assetPackageRoot = path.join(base, "packages");
    const manifestPath = path.join(base, "manifest.json");

    seedApprovedCarousel(carouselDir, "car_clitest0000001");
    seedAssetPackage(assetPackageRoot, "car_clitest0000001", "pkg_clitest0000001");
    writeManifest(manifestPath, { destinations: { instagram: { enabled: true, caption: "cap", alt_text: "alt" }, linkedin: { enabled: false, commentary: null } } });

    const result = runCli([manifestPath, carouselDir, publisherResultDir, assetPackageRoot, "--live"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--live requires INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID.*Instagram is an enabled destination/);
    assert.doesNotMatch(result.stderr, /LINKEDIN/, "LinkedIn is disabled — its credentials must never be required");
  }));

test("--live prints the proposed request budget before making any request", () =>
  withTempDirs((base) => {
    const carouselDir = path.join(base, "carousels");
    const publisherResultDir = path.join(base, "publisher-results");
    const assetPackageRoot = path.join(base, "packages");
    const manifestPath = path.join(base, "manifest.json");

    seedApprovedCarousel(carouselDir, "car_clitest0000001");
    seedAssetPackage(assetPackageRoot, "car_clitest0000001", "pkg_clitest0000001");
    writeManifest(manifestPath);

    const result = runCli([manifestPath, carouselDir, publisherResultDir, assetPackageRoot, "--live"]);
    assert.match(result.stdout, /proposed request budget: instagram=8, linkedin=13 \(total 21 request\(s\)\)/);
  }));

test("no credential value is ever leaked into stdout/stderr when credentials are missing", () =>
  withTempDirs((base) => {
    const carouselDir = path.join(base, "carousels");
    const publisherResultDir = path.join(base, "publisher-results");
    const assetPackageRoot = path.join(base, "packages");
    const manifestPath = path.join(base, "manifest.json");

    seedApprovedCarousel(carouselDir, "car_clitest0000001");
    seedAssetPackage(assetPackageRoot, "car_clitest0000001", "pkg_clitest0000001");
    writeManifest(manifestPath);

    const result = runCli([manifestPath, carouselDir, publisherResultDir, assetPackageRoot, "--live"], { INSTAGRAM_ACCESS_TOKEN: "fake-present-value" });
    assert.doesNotMatch(result.stdout, /fake-present-value/);
    assert.doesNotMatch(result.stderr, /fake-present-value/);
  }));

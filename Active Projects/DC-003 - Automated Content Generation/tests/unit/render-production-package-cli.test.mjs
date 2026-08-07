// Unit tests for tests/validation/render-production-package.mjs
// (DC-003-I034). Mock mode only (no --live, no network) — mirrors
// production-package-cli.test.mjs's own precedent, chained one step
// further (Ingested Content -> Editorial Package -> Social Media
// Package -> Production Package -> Finished Carousel) since this CLI's
// own input is a Production Package, the last stop in the new pipeline
// before this milestone.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const RENDER_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "render-production-package.mjs");
const PP_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "production-package.mjs");
const SM_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "social-media-package.mjs");
const EP_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "editorial-package.mjs");
const IC_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "content-ingestion.mjs");

function runRenderCli(...args) {
  return spawnSync(process.execPath, [RENDER_CLI_PATH, ...args], { encoding: "utf-8" });
}
function runPpCli(...args) {
  return spawnSync(process.execPath, [PP_CLI_PATH, ...args], { encoding: "utf-8" });
}
function runSmCli(...args) {
  return spawnSync(process.execPath, [SM_CLI_PATH, ...args], { encoding: "utf-8" });
}
function runEpCli(...args) {
  return spawnSync(process.execPath, [EP_CLI_PATH, ...args], { encoding: "utf-8" });
}
function runIcCli(...args) {
  return spawnSync(process.execPath, [IC_CLI_PATH, ...args], { encoding: "utf-8" });
}

function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-render-production-package-cli-"));
  const dirs = { icDir: path.join(base, "ic"), epDir: path.join(base, "ep"), smDir: path.join(base, "sm"), ppDir: path.join(base, "pp"), fcDir: path.join(base, "fc") };
  try {
    return fn(dirs);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function seedProductionPackageId({ icDir, epDir, smDir, ppDir }, sourceReference) {
  const ic = runIcCli("create", sourceReference, icDir);
  assert.equal(ic.status, 0, ic.stderr);
  const icMatch = ic.stdout.match(/ingested_content_id:\s+(ic_[A-Za-z0-9]+)/);
  assert.ok(icMatch);

  const ep = runEpCli("create", icMatch[1], icDir, epDir);
  assert.equal(ep.status, 0, ep.stderr);
  const epMatch = ep.stdout.match(/editorial_package_id:\s+(ep_[A-Za-z0-9]+)/);
  assert.ok(epMatch);

  const sm = runSmCli("create", epMatch[1], epDir, smDir);
  assert.equal(sm.status, 0, sm.stderr);
  const smMatch = sm.stdout.match(/social_media_package_id:\s+(sm_[A-Za-z0-9]+)/);
  assert.ok(smMatch);

  const pp = runPpCli("create", smMatch[1], smDir, ppDir);
  assert.equal(pp.status, 0, pp.stderr);
  const ppMatch = pp.stdout.match(/production_package_id:\s+(pp_[A-Za-z0-9]+)/);
  assert.ok(ppMatch);
  return ppMatch[1];
}

test("no arguments prints usage and exits 1", () => {
  const result = runRenderCli();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("missing arguments prints usage and exits 1", () => {
  const result = runRenderCli("pp_x");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("renders a real Production Package end to end through the full I030-I034 CLI chain (mock mode)", () =>
  withTempDirs((dirs) => {
    const productionPackageId = seedProductionPackageId(dirs, "doc-render-cli-1");
    const result = runRenderCli(productionPackageId, dirs.ppDir, dirs.fcDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Finished Carousel rendered OK/);
    assert.match(result.stdout, /carousel_id:\s+car_/);
    assert.match(result.stdout, /production_package_id:\s+pp_/);
    assert.match(result.stdout, /overall_status:\s+completed/);
    assert.match(result.stdout, /slides:\s+6\/6 completed/);
    // Six slide lines, in order.
    for (let n = 1; n <= 6; n += 1) {
      assert.match(result.stdout, new RegExp(`\\[slide ${n}\\]`));
    }
  }));

test("fails cleanly for an unknown productionPackageId", () =>
  withTempDirs(({ ppDir, fcDir }) => {
    const result = runRenderCli("pp_doesnotexist00001", ppDir, fcDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL\s+ProductionPackageNotFoundError/);
  }));

test("a second render of the same Production Package fails as a duplicate", () =>
  withTempDirs((dirs) => {
    const productionPackageId = seedProductionPackageId(dirs, "doc-render-cli-2");
    const first = runRenderCli(productionPackageId, dirs.ppDir, dirs.fcDir);
    assert.equal(first.status, 0, first.stderr);
    const second = runRenderCli(productionPackageId, dirs.ppDir, dirs.fcDir);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /FAIL\s+DuplicateRenderError/);
  }));

test("--live without TEMPLATED_API_KEY fails cleanly, never falling back to mock silently", () =>
  withTempDirs((dirs) => {
    const productionPackageId = seedProductionPackageId(dirs, "doc-render-cli-3");
    const result = spawnSync(process.execPath, [RENDER_CLI_PATH, productionPackageId, dirs.ppDir, dirs.fcDir, "--live"], {
      encoding: "utf-8",
      env: { ...process.env, TEMPLATED_API_KEY: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--live requires TEMPLATED_API_KEY/);
  }));

test("mock mode never sets TEMPLATED_API_KEY as a precondition — the default path works with no credentials in the environment at all", () =>
  withTempDirs((dirs) => {
    const productionPackageId = seedProductionPackageId(dirs, "doc-render-cli-4");
    const result = spawnSync(process.execPath, [RENDER_CLI_PATH, productionPackageId, dirs.ppDir, dirs.fcDir], {
      encoding: "utf-8",
      env: { ...process.env, TEMPLATED_API_KEY: "" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /provider:\s+mock-transport/);
  }));

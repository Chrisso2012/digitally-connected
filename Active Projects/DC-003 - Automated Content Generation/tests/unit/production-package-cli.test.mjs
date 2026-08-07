// Unit tests for tests/validation/production-package.mjs (DC-003-I033).
// Mirrors social-media-package-cli.test.mjs's own precedent, chained one
// step further (Ingested Content -> Editorial Package -> Social Media
// Package -> Production Package) since this CLI's own input is a Social
// Media Package, not an Editorial Package.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const PP_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "production-package.mjs");
const SM_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "social-media-package.mjs");
const EP_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "editorial-package.mjs");
const IC_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "content-ingestion.mjs");

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
  const base = mkdtempSync(path.join(tmpdir(), "dc003-production-package-cli-"));
  const icDir = path.join(base, "ic");
  const epDir = path.join(base, "ep");
  const smDir = path.join(base, "sm");
  const ppDir = path.join(base, "pp");
  try {
    return fn({ icDir, epDir, smDir, ppDir });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function seedSocialMediaPackageId(icDir, epDir, smDir, sourceReference) {
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
  return smMatch[1];
}

test("no subcommand prints usage and exits 1", () => {
  const result = runPpCli();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("create with missing arguments prints usage and exits 1", () => {
  const result = runPpCli("create");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("create generates and prints the full record", () =>
  withTempDirs(({ icDir, epDir, smDir, ppDir }) => {
    const socialMediaPackageId = seedSocialMediaPackageId(icDir, epDir, smDir, "doc-cli-1");
    const result = runPpCli("create", socialMediaPackageId, smDir, ppDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Production Package generated OK/);
    assert.match(result.stdout, /production_package_id:\s+pp_/);
    assert.match(result.stdout, /renderer:\s+templated/);
    assert.match(result.stdout, /platform:\s+null/);
  }));

test("create --platform=instagram records the given platform", () =>
  withTempDirs(({ icDir, epDir, smDir, ppDir }) => {
    const socialMediaPackageId = seedSocialMediaPackageId(icDir, epDir, smDir, "doc-cli-2");
    const result = runPpCli("create", socialMediaPackageId, smDir, ppDir, "--platform=instagram");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /platform:\s+instagram/);
  }));

test("create fails cleanly for an unknown socialMediaPackageId", () =>
  withTempDirs(({ smDir, ppDir }) => {
    const result = runPpCli("create", "sm_doesnotexist00001", smDir, ppDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL\s+SocialMediaPackageNotFoundError/);
  }));

test("a second create for the same Social Media Package fails as a duplicate", () =>
  withTempDirs(({ icDir, epDir, smDir, ppDir }) => {
    const socialMediaPackageId = seedSocialMediaPackageId(icDir, epDir, smDir, "doc-cli-3");
    const first = runPpCli("create", socialMediaPackageId, smDir, ppDir);
    assert.equal(first.status, 0, first.stderr);
    const second = runPpCli("create", socialMediaPackageId, smDir, ppDir);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /FAIL\s+DuplicateProductionPackageError/);
  }));

test("inspect prints full JSON for a stored record; fails cleanly for an unknown id", () =>
  withTempDirs(({ icDir, epDir, smDir, ppDir }) => {
    const socialMediaPackageId = seedSocialMediaPackageId(icDir, epDir, smDir, "doc-cli-4");
    const created = runPpCli("create", socialMediaPackageId, smDir, ppDir);
    assert.equal(created.status, 0, created.stderr);
    const idMatch = created.stdout.match(/production_package_id:\s+(pp_[A-Za-z0-9]+)/);
    assert.ok(idMatch);

    const inspected = runPpCli("inspect", idMatch[1], ppDir);
    assert.equal(inspected.status, 0, inspected.stderr);
    const parsed = JSON.parse(inspected.stdout.split("\n").slice(1).join("\n"));
    assert.equal(parsed.production_package_id, idMatch[1]);

    const missing = runPpCli("inspect", "pp_doesnotexist00001", ppDir);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /FAIL\s+ProductionPackageNotFoundError/);
  }));

test("list prints a summary line per stored record", () =>
  withTempDirs(({ icDir, epDir, smDir, ppDir }) => {
    const idA = seedSocialMediaPackageId(icDir, epDir, smDir, "doc-cli-5");
    const idB = seedSocialMediaPackageId(icDir, epDir, smDir, "doc-cli-6");
    runPpCli("create", idA, smDir, ppDir);
    runPpCli("create", idB, smDir, ppDir);

    const result = runPpCli("list", ppDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 production package\(s\)/);
  }));

test("status prints an aggregate summary, including for an empty store", () =>
  withTempDirs(({ icDir, epDir, smDir, ppDir }) => {
    const empty = runPpCli("status", ppDir);
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /total_production_packages:\s+0/);
    assert.match(empty.stdout, /latest_package:\s+\(none\)/);

    const socialMediaPackageId = seedSocialMediaPackageId(icDir, epDir, smDir, "doc-cli-7");
    runPpCli("create", socialMediaPackageId, smDir, ppDir);
    const populated = runPpCli("status", ppDir);
    assert.equal(populated.status, 0, populated.stderr);
    assert.match(populated.stdout, /total_production_packages:\s+1/);
    assert.match(populated.stdout, /latest_status:\s+generated/);
  }));

// Unit tests for tests/validation/social-media-package.mjs (DC-003-I032).
// Mock mode only (no --live, no network) — mirrors editorial-package-cli
// .test.mjs's own "spawnSync via process.execPath + an array of args"
// pattern, chained one step further (Ingested Content -> Editorial
// Package -> Social Media Package) since this CLI's own input is an
// Editorial Package, not raw source content.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SM_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "social-media-package.mjs");
const EP_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "editorial-package.mjs");
const IC_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "content-ingestion.mjs");

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
  const base = mkdtempSync(path.join(tmpdir(), "dc003-social-media-package-cli-"));
  const icDir = path.join(base, "ic");
  const epDir = path.join(base, "ep");
  const smDir = path.join(base, "sm");
  try {
    return fn({ icDir, epDir, smDir });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function seedEditorialPackageId(icDir, epDir, sourceReference) {
  const ic = runIcCli("create", sourceReference, icDir);
  assert.equal(ic.status, 0, ic.stderr);
  const icMatch = ic.stdout.match(/ingested_content_id:\s+(ic_[A-Za-z0-9]+)/);
  assert.ok(icMatch, "expected to find an ingested_content_id in create output");

  const ep = runEpCli("create", icMatch[1], icDir, epDir);
  assert.equal(ep.status, 0, ep.stderr);
  const epMatch = ep.stdout.match(/editorial_package_id:\s+(ep_[A-Za-z0-9]+)/);
  assert.ok(epMatch, "expected to find an editorial_package_id in create output");
  return epMatch[1];
}

test("no subcommand prints usage and exits 1", () => {
  const result = runSmCli();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("create with missing arguments prints usage and exits 1", () => {
  const result = runSmCli("create");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("create (mock mode) generates and prints the full record", () =>
  withTempDirs(({ icDir, epDir, smDir }) => {
    const editorialPackageId = seedEditorialPackageId(icDir, epDir, "doc-cli-1");
    const result = runSmCli("create", editorialPackageId, epDir, smDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Social Media Package generated OK/);
    assert.match(result.stdout, /social_media_package_id:\s+sm_/);
    assert.match(result.stdout, /llm_model:\s+mock-social-media-provider-v1/);
  }));

test("create fails cleanly for an unknown editorialPackageId", () =>
  withTempDirs(({ epDir, smDir }) => {
    const result = runSmCli("create", "ep_doesnotexist00001", epDir, smDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL\s+EditorialPackageNotFoundError/);
  }));

test("a second create for the same Editorial Package fails as a duplicate", () =>
  withTempDirs(({ icDir, epDir, smDir }) => {
    const editorialPackageId = seedEditorialPackageId(icDir, epDir, "doc-cli-2");
    const first = runSmCli("create", editorialPackageId, epDir, smDir);
    assert.equal(first.status, 0, first.stderr);
    const second = runSmCli("create", editorialPackageId, epDir, smDir);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /FAIL\s+DuplicateSocialMediaPackageError/);
  }));

test("--live without LLM_API_KEY fails cleanly, never falling back to mock silently", () =>
  withTempDirs(({ icDir, epDir, smDir }) => {
    const editorialPackageId = seedEditorialPackageId(icDir, epDir, "doc-cli-3");
    const result = spawnSync(process.execPath, [SM_CLI_PATH, "create", editorialPackageId, epDir, smDir, "--live"], {
      encoding: "utf-8",
      env: { ...process.env, LLM_API_KEY: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--live requires LLM_API_KEY/);
  }));

test("inspect prints full JSON for a stored record; fails cleanly for an unknown id", () =>
  withTempDirs(({ icDir, epDir, smDir }) => {
    const editorialPackageId = seedEditorialPackageId(icDir, epDir, "doc-cli-4");
    const created = runSmCli("create", editorialPackageId, epDir, smDir);
    assert.equal(created.status, 0, created.stderr);
    const idMatch = created.stdout.match(/social_media_package_id:\s+(sm_[A-Za-z0-9]+)/);
    assert.ok(idMatch);

    const inspected = runSmCli("inspect", idMatch[1], smDir);
    assert.equal(inspected.status, 0, inspected.stderr);
    const parsed = JSON.parse(inspected.stdout.split("\n").slice(1).join("\n"));
    assert.equal(parsed.social_media_package_id, idMatch[1]);

    const missing = runSmCli("inspect", "sm_doesnotexist00001", smDir);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /FAIL\s+SocialMediaPackageNotFoundError/);
  }));

test("list prints a summary line per stored record", () =>
  withTempDirs(({ icDir, epDir, smDir }) => {
    const idA = seedEditorialPackageId(icDir, epDir, "doc-cli-5");
    const idB = seedEditorialPackageId(icDir, epDir, "doc-cli-6");
    runSmCli("create", idA, epDir, smDir);
    runSmCli("create", idB, epDir, smDir);

    const result = runSmCli("list", smDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 social media package\(s\)/);
  }));

test("status prints an aggregate summary, including for an empty store", () =>
  withTempDirs(({ icDir, epDir, smDir }) => {
    const empty = runSmCli("status", smDir);
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /total_social_media_packages:\s+0/);
    assert.match(empty.stdout, /latest_package:\s+\(none\)/);

    const editorialPackageId = seedEditorialPackageId(icDir, epDir, "doc-cli-7");
    runSmCli("create", editorialPackageId, epDir, smDir);
    const populated = runSmCli("status", smDir);
    assert.equal(populated.status, 0, populated.stderr);
    assert.match(populated.stdout, /total_social_media_packages:\s+1/);
    assert.match(populated.stdout, /latest_status:\s+generated/);
  }));

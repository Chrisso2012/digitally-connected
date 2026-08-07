// Unit tests for tests/validation/editorial-package.mjs (DC-003-I031).
// Mock mode only (no --live, no network) — mirrors content-ingestion-cli
// .test.mjs's own "spawnSync via process.execPath + an array of args"
// pattern.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const EP_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "editorial-package.mjs");
const IC_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "content-ingestion.mjs");

function runEpCli(...args) {
  return spawnSync(process.execPath, [EP_CLI_PATH, ...args], { encoding: "utf-8" });
}

function runIcCli(...args) {
  return spawnSync(process.execPath, [IC_CLI_PATH, ...args], { encoding: "utf-8" });
}

function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-editorial-package-cli-"));
  const icDir = path.join(base, "ic");
  const epDir = path.join(base, "ep");
  try {
    return fn({ icDir, epDir });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function seedIngestedContentId(icDir, sourceReference) {
  const result = runIcCli("create", sourceReference, icDir);
  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/ingested_content_id:\s+(ic_[A-Za-z0-9]+)/);
  assert.ok(match, "expected to find an ingested_content_id in create output");
  return match[1];
}

test("no subcommand prints usage and exits 1", () => {
  const result = runEpCli();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("create with missing arguments prints usage and exits 1", () => {
  const result = runEpCli("create");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("create (mock mode) generates and prints the full record", () =>
  withTempDirs(({ icDir, epDir }) => {
    const ingestedContentId = seedIngestedContentId(icDir, "doc-cli-1");
    const result = runEpCli("create", ingestedContentId, icDir, epDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Editorial Package generated OK/);
    assert.match(result.stdout, /editorial_package_id:\s+ep_/);
    assert.match(result.stdout, /llm_model:\s+mock-editorial-analysis-provider-v1/);
  }));

test("create fails cleanly for an unknown ingestedContentId", () =>
  withTempDirs(({ icDir, epDir }) => {
    const result = runEpCli("create", "ic_doesnotexist00001", icDir, epDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL\s+IngestedContentNotFoundError/);
  }));

test("a second create for the same Ingested Content fails as a duplicate", () =>
  withTempDirs(({ icDir, epDir }) => {
    const ingestedContentId = seedIngestedContentId(icDir, "doc-cli-2");
    const first = runEpCli("create", ingestedContentId, icDir, epDir);
    assert.equal(first.status, 0, first.stderr);
    const second = runEpCli("create", ingestedContentId, icDir, epDir);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /FAIL\s+DuplicateEditorialPackageError/);
  }));

test("--live without LLM_API_KEY fails cleanly, never falling back to mock silently", () =>
  withTempDirs(({ icDir, epDir }) => {
    const ingestedContentId = seedIngestedContentId(icDir, "doc-cli-3");
    const result = spawnSync(process.execPath, [EP_CLI_PATH, "create", ingestedContentId, icDir, epDir, "--live"], {
      encoding: "utf-8",
      env: { ...process.env, LLM_API_KEY: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--live requires LLM_API_KEY/);
  }));

test("inspect prints full JSON for a stored record; fails cleanly for an unknown id", () =>
  withTempDirs(({ icDir, epDir }) => {
    const ingestedContentId = seedIngestedContentId(icDir, "doc-cli-4");
    const created = runEpCli("create", ingestedContentId, icDir, epDir);
    assert.equal(created.status, 0, created.stderr);
    const idMatch = created.stdout.match(/editorial_package_id:\s+(ep_[A-Za-z0-9]+)/);
    assert.ok(idMatch);

    const inspected = runEpCli("inspect", idMatch[1], epDir);
    assert.equal(inspected.status, 0, inspected.stderr);
    const parsed = JSON.parse(inspected.stdout.split("\n").slice(1).join("\n"));
    assert.equal(parsed.editorial_package_id, idMatch[1]);

    const missing = runEpCli("inspect", "ep_doesnotexist00001", epDir);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /FAIL\s+EditorialPackageNotFoundError/);
  }));

test("list prints a summary line per stored record", () =>
  withTempDirs(({ icDir, epDir }) => {
    const idA = seedIngestedContentId(icDir, "doc-cli-5");
    const idB = seedIngestedContentId(icDir, "doc-cli-6");
    runEpCli("create", idA, icDir, epDir);
    runEpCli("create", idB, icDir, epDir);

    const result = runEpCli("list", epDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 editorial package\(s\)/);
  }));

test("status prints an aggregate summary, including for an empty store", () =>
  withTempDirs(({ icDir, epDir }) => {
    const empty = runEpCli("status", epDir);
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /total_editorial_packages:\s+0/);
    assert.match(empty.stdout, /latest_package:\s+\(none\)/);

    const ingestedContentId = seedIngestedContentId(icDir, "doc-cli-7");
    runEpCli("create", ingestedContentId, icDir, epDir);
    const populated = runEpCli("status", epDir);
    assert.equal(populated.status, 0, populated.stderr);
    assert.match(populated.stdout, /total_editorial_packages:\s+1/);
    assert.match(populated.stdout, /latest_status:\s+generated/);
  }));

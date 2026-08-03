import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "content-asset.mjs");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-content-asset-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function baseTopicPackage(overrides = {}) {
  return {
    topic_id: "topic_01J9CLI00001",
    working_title: "CLI test topic",
    audience: "Owner-operators",
    primary_goal: "Book a call",
    funnel_stage: "consideration",
    core_message: "Core message",
    supporting_points: ["Point one", "Point two"],
    cta: "Book now",
    keywords: [],
    brand_voice: "confident-direct",
    status: "approved",
    created_date: "2026-08-01T00:00:00Z",
    updated_date: "2026-08-01T00:00:00Z",
    version: 1,
    schema_version: "1.0",
    source: "backlog",
    backlog_reference_id: null,
    content_pillar: null,
    tags: [],
    priority: null,
    related_topic_ids: [],
    locale: "en",
    owner: "chris@digitallyconnected.net",
    notes: null,
    ...overrides,
  };
}

function writeAsset(dir, assetId, overrides = {}) {
  const asset = {
    asset_id: assetId,
    title: "CLI Test Asset",
    summary: "A CLI test content asset.",
    topic_package: baseTopicPackage({ backlog_reference_id: assetId }),
    status: "approved",
    created_at: "2026-08-01T00:00:00Z",
    metadata: null,
    ...overrides,
  };
  writeFileSync(path.join(dir, `${assetId}.json`), JSON.stringify(asset), "utf-8");
}

// --- get -------------------------------------------------------------

test("get retrieves an existing asset and prints its full JSON", () => {
  withTempDir((dir) => {
    writeAsset(dir, "TEST01");
    const result = runCli("get", "TEST01", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Content asset found OK/);
    const printed = JSON.parse(result.stdout.split("\n").slice(1).join("\n"));
    assert.equal(printed.asset_id, "TEST01");
  });
});

test("get against the default (repository) directory resolves the real GS01 asset", () => {
  const result = runCli("get", "GS01");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Content asset found OK/);
  const printed = JSON.parse(result.stdout.split("\n").slice(1).join("\n"));
  assert.equal(printed.asset_id, "GS01");
  assert.equal(printed.status, "approved");
});

test("get exits non-zero for an unknown asset, without a raw stack trace", () => {
  withTempDir((dir) => {
    const result = runCli("get", "NOPE", dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /UnknownContentAssetError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("get rejects a path-traversal asset id without touching the filesystem outside the repository", () => {
  withTempDir((dir) => {
    const result = runCli("get", "../../../../etc/passwd", dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /InvalidContentAssetError/);
  });
});

// --- list --------------------------------------------------------------

test("list reports an empty repository, then every asset after adding some", () => {
  withTempDir((dir) => {
    const emptyResult = runCli("list", dir);
    assert.equal(emptyResult.status, 0, emptyResult.stderr);
    assert.match(emptyResult.stdout, /^0 content asset\(s\)/);

    writeAsset(dir, "B2");
    writeAsset(dir, "A1");
    const listResult = runCli("list", dir);
    assert.equal(listResult.status, 0, listResult.stderr);
    assert.match(listResult.stdout, /^2 content asset\(s\)/);
    // deterministic ascending order
    const lines = listResult.stdout.split("\n");
    assert.ok(lines[1].includes("[A1]"));
    assert.ok(lines[2].includes("[B2]"));
  });
});

test("list against the default (repository) directory finds the real GS01 asset with no duplicate IDs", () => {
  const result = runCli("list");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[GS01\]/);
});

// --- validate ------------------------------------------------------------

test("validate confirms a valid asset and exits 0", () => {
  withTempDir((dir) => {
    writeAsset(dir, "TEST01");
    const result = runCli("validate", "TEST01", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /is valid OK/);
  });
});

test("validate against the default (repository) directory confirms GS01 is valid", () => {
  const result = runCli("validate", "GS01");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /is valid OK/);
});

test("validate exits non-zero for a schema-invalid asset, without a raw stack trace", () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, "BAD.json"), JSON.stringify({ asset_id: "BAD" }), "utf-8");
    const result = runCli("validate", "BAD", dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ContentAssetSchemaError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

// --- usage / misc --------------------------------------------------------

test("exits non-zero with usage when no arguments are given", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("exits non-zero with usage for an unknown subcommand", () => {
  const result = runCli("delete-everything");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("exits non-zero with usage when get is called without an assetId", () => {
  const result = runCli("get");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

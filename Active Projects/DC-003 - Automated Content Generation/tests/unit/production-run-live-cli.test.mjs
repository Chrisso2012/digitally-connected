// Unit tests for tests/validation/production-run-live.mjs (DC-003-I020,
// corrected in DC-003-I020.1 to route through the existing production
// architecture — see production-run-service.mjs's own header comment).
//
// Deliberately never exercises a real --live run to completion: doing so
// would require real LLM_API_KEY/TEMPLATED_API_KEY credentials and would
// perform real, billable network calls, which this codebase's automated
// suite must never do (mirrors DC-003-I006/I019's own CLI test
// constraints). Tests that pass --live only ever probe the fail-fast
// credential gates, guaranteed to return before either transport is
// constructed or any network call is attempted.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "production-run-live.mjs");

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-production-run-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeAsset(dir, assetId) {
  const topicPackage = {
    topic_id: "topic_01J9PRCLI0001",
    working_title: "Production Run CLI test topic",
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
    backlog_reference_id: assetId,
    content_pillar: null,
    tags: [],
    priority: null,
    related_topic_ids: [],
    locale: "en",
    owner: "chris@digitallyconnected.net",
    notes: null,
  };
  const asset = {
    asset_id: assetId,
    title: "Production Run CLI Test Asset",
    summary: "A production-run-live CLI test content asset.",
    topic_package: topicPackage,
    status: "approved",
    created_at: "2026-08-01T00:00:00Z",
    metadata: null,
  };
  writeFileSync(path.join(dir, `${assetId}.json`), JSON.stringify(asset), "utf-8");
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, LLM_API_KEY: "", TEMPLATED_API_KEY: "", ...env },
  });
}

// --- Usage ------------------------------------------------------------

test("no arguments prints usage and exits non-zero", () => {
  const result = runCli([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: node tests\/validation\/production-run-live\.mjs/);
});

test("missing storeDirectory prints usage and exits non-zero", () => {
  const result = runCli(["GS01"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

// --- Mock (default) path -------------------------------------------------

test("mock (default) run against a real content asset exits 0, renders all 6 slides, and persists one carousel", () =>
  withTempDir((assetsDir) =>
    withTempDir((storeDir) => {
      writeAsset(assetsDir, "PRCLI01");
      const result = runCli(["PRCLI01", storeDir, assetsDir]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Production Run complete/);
      assert.match(result.stdout, /status:\s*completed/);
      assert.match(result.stdout, /slide count:\s*6/);
      assert.match(result.stdout, /rendered slides:\s*6/);
      assert.match(result.stdout, /stored:\s*true/);
      assert.doesNotMatch(result.stdout, /Running LIVE/);

      const storedFiles = readdirSync(storeDir).filter((f) => f.endsWith(".json"));
      assert.equal(storedFiles.length, 1, "exactly one carousel file persisted");
    })
  ));

test("mock is the default even when BOTH credentials are present in the environment — --live is required to opt in", () =>
  withTempDir((assetsDir) =>
    withTempDir((storeDir) => {
      writeAsset(assetsDir, "PRCLI02");
      const result = runCli(["PRCLI02", storeDir, assetsDir], {
        LLM_API_KEY: "sk-fake-present-but-must-be-ignored-without---live",
        TEMPLATED_API_KEY: "fake-present-but-must-be-ignored-without---live",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /Running LIVE/, "presence of both credentials alone must never switch to a live run");
    })
  ));

test("an unknown content asset exits non-zero with a safe error, not a stack trace, and persists nothing", () =>
  withTempDir((assetsDir) =>
    withTempDir((storeDir) => {
      const result = runCli(["DOES_NOT_EXIST", storeDir, assetsDir]);
      assert.notEqual(result.status, 0);
      // I016's Content Asset Resolver (unmodified) surfaces its own
      // UnknownSourceReferenceError, not I018's UnknownContentAssetError —
      // this service routes through I016 now, so I016's own error
      // vocabulary is what's reported.
      assert.match(result.stdout, /error code:\s*UnknownSourceReferenceError/);
      assert.doesNotMatch(result.stderr, /at file:\/\//);
      assert.equal(existsSync(storeDir) && readdirSync(storeDir).length > 0, false);
    })
  ));

// --- Explicit live-mode gate: both credentials required before any request

test("--live without either credential fails fast, naming both, before any provider or transport is constructed", () =>
  withTempDir((assetsDir) =>
    withTempDir((storeDir) => {
      writeAsset(assetsDir, "PRCLI03");
      const result = runCli(["PRCLI03", storeDir, assetsDir, "--live"]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /--live requires LLM_API_KEY and TEMPLATED_API_KEY/);
      assert.doesNotMatch(result.stdout, /Running LIVE/, "must fail before even announcing a live attempt");
    })
  ));

test("--live with only LLM_API_KEY set still fails fast, naming the missing TEMPLATED_API_KEY", () =>
  withTempDir((assetsDir) =>
    withTempDir((storeDir) => {
      writeAsset(assetsDir, "PRCLI04");
      const result = runCli(["PRCLI04", storeDir, assetsDir, "--live"], { LLM_API_KEY: "sk-fake-present" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /--live requires TEMPLATED_API_KEY/);
      assert.doesNotMatch(result.stderr, /LLM_API_KEY/);
    })
  ));

test("--live with only TEMPLATED_API_KEY set still fails fast, naming the missing LLM_API_KEY", () =>
  withTempDir((assetsDir) =>
    withTempDir((storeDir) => {
      writeAsset(assetsDir, "PRCLI05");
      const result = runCli(["PRCLI05", storeDir, assetsDir, "--live"], { TEMPLATED_API_KEY: "fake-present" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /--live requires LLM_API_KEY/);
      assert.doesNotMatch(result.stderr, /TEMPLATED_API_KEY/);
    })
  ));

test("neither credential name's presence is leaked into stdout when both are missing (no secret values exist yet, but check the message stays generic)", () =>
  withTempDir((assetsDir) =>
    withTempDir((storeDir) => {
      writeAsset(assetsDir, "PRCLI06");
      const result = runCli(["PRCLI06", storeDir, assetsDir, "--live"]);
      assert.doesNotMatch(result.stdout, /sk-/);
    })
  ));

// --- DC-003-I020.1: existing I016 Content Request Command compatibility -
// content-request.mjs and content-request-service.mjs were not modified by
// this correction — this spawns the real, unmodified I016 CLI directly to
// confirm it still behaves exactly as it did before I020.1 (its own 74
// unit tests, also unmodified, provide the same guarantee at finer grain;
// this is one direct, end-to-end confirmation tied specifically to this
// task).

test("the existing I016 Content Request CLI (content-request.mjs) still works unmodified after the I020.1 correction", () =>
  withTempDir((assetsDir) =>
    withTempDir((storeDir) => {
      writeAsset(assetsDir, "PRCLI07");
      const contentRequestCliPath = path.join(PROJECT_ROOT, "tests", "validation", "content-request.mjs");
      const result = spawnSync(
        process.execPath,
        [contentRequestCliPath, "Create 6 designs based on article PRCLI07", storeDir, assetsDir, "--json"],
        { encoding: "utf-8", env: { ...process.env, LLM_API_KEY: "", TEMPLATED_API_KEY: "" } }
      );
      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.success, true);
      assert.equal(parsed.sourceReference, "PRCLI07");
      assert.equal(parsed.stored, true);
      assert.match(parsed.carouselId, /^car_[A-Za-z0-9]+$/);
    })
  ));

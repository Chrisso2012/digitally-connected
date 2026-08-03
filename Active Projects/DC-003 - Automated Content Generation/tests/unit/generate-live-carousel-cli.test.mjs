// Unit tests for tests/validation/generate-live-carousel.mjs.
//
// Deliberately never exercises a real --live run to completion: doing so
// would require a real Anthropic API key and would perform a real,
// billable network call, which this codebase's automated suite must never
// do (mirrors DC-003-I006's own renderer-cli.test.mjs "Mock First"
// constraint). Tests that pass --live only ever probe the fail-fast gates
// (missing LLM_API_KEY, invalid --live-max-attempts) that are guaranteed
// to return before any transport is constructed or any network call is
// attempted.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "generate-live-carousel.mjs");

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-generate-live-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeAsset(dir, assetId) {
  const topicPackage = {
    topic_id: "topic_01J9CLI00002",
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
    title: "CLI Test Asset",
    summary: "A CLI test content asset.",
    topic_package: topicPackage,
    status: "approved",
    created_at: "2026-08-01T00:00:00Z",
    metadata: null,
  };
  writeFileSync(path.join(dir, `${assetId}.json`), JSON.stringify(asset), "utf-8");
}

// No LLM_API_KEY, no network — this CLI's default (mock) path never
// touches either.
function runCliMock(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, LLM_API_KEY: "" },
  });
}

// --- Mock-default path (no --live) ----------------------------------------

test("mock (default) run against the real repository GS01 asset exits 0 with a full mock summary", () => {
  const result = runCliMock();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Carousel Content generated OK/);
  assert.match(result.stdout, /llm_model:\s*mock-provider-v1/);
  assert.match(result.stdout, /slides:\s*6/);
  assert.match(result.stdout, /Mock payload\/render path complete OK/);
  assert.match(result.stdout, /render provider:\s*mock-transport/);
});

test("mock (default) run against an explicit assetId and contentAssetsDir succeeds", () => {
  withTempDir((dir) => {
    writeAsset(dir, "CLI01");
    const result = runCliMock("CLI01", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /llm_model:\s*mock-provider-v1/);
  });
});

test("mock is the default even when LLM_API_KEY IS set in the environment — --live is required to opt in", () => {
  const result = spawnSync(process.execPath, [CLI_PATH], {
    encoding: "utf-8",
    env: { ...process.env, LLM_API_KEY: "sk-fake-present-but-must-be-ignored-without---live" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /llm_model:\s*mock-provider-v1/, "presence of LLM_API_KEY alone must never switch generation to the real provider");
  assert.doesNotMatch(result.stdout, /Generating LIVE/);
});

test("an unknown content asset exits non-zero with a safe error, not a stack trace", () => {
  withTempDir((dir) => {
    const result = runCliMock("DOES_NOT_EXIST", dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /UnknownContentAssetError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("does not create any file on disk", () => {
  const before = readdirSync(PROJECT_ROOT).sort();
  runCliMock();
  const after = readdirSync(PROJECT_ROOT).sort();
  assert.deepEqual(before, after);
});

// --- Explicit live-mode gate ------------------------------------------

test("--live without LLM_API_KEY fails fast, before any provider or transport is constructed", () => {
  const result = runCliMock("GS01", "--live");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--live requires LLM_API_KEY/);
  assert.doesNotMatch(result.stdout, /Generating LIVE/, "must fail before even announcing a live attempt");
});

test("--live with an invalid --live-max-attempts value fails fast, before any transport is constructed", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "GS01", "--live", "--live-max-attempts=0"], {
    encoding: "utf-8",
    env: { ...process.env, LLM_API_KEY: "fake-key-never-sent-validation-fails-first" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--live-max-attempts must be a positive integer/);
  assert.doesNotMatch(result.stdout, /Generating LIVE/, "must fail before even announcing a live attempt");
});

test("--live with a non-numeric --live-max-attempts value fails fast with a clear message", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "GS01", "--live", "--live-max-attempts=abc"], {
    encoding: "utf-8",
    env: { ...process.env, LLM_API_KEY: "fake-key-never-sent-validation-fails-first" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--live-max-attempts must be a positive integer/);
});

test("--live with a negative --live-max-attempts value fails fast", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "GS01", "--live", "--live-max-attempts=-1"], {
    encoding: "utf-8",
    env: { ...process.env, LLM_API_KEY: "fake-key-never-sent-validation-fails-first" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--live-max-attempts must be a positive integer/);
});

// --- DC-003-I019.1: the CLI's own printing of the safe LlmClientError
// diagnostic (found to be missing during the first authorised live
// verification attempt — see README "Live Verification Gate incident"). No
// real network call is made: global.fetch is stubbed via a --import
// preload module written to a temp file for the duration of one test, then
// removed — the same "never reach the network" guarantee every other test
// in this file relies on, just applied to the one branch that only
// triggers once a transport actually exists. ---------------------------

test("an HTTP 400 from the (stubbed) real transport prints the full safe diagnostic, not just the bare message", () => {
  withTempDir((dir) => {
    const preloadPath = path.join(dir, "stub-fetch-400.mjs");
    writeFileSync(
      preloadPath,
      `globalThis.fetch = async () => ({
        ok: false,
        status: 400,
        headers: { get: (name) => ({ "content-type": "application/json", "request-id": "req_cli_diagnostic_test" }[name.toLowerCase()] ?? null) },
        json: async () => { throw new Error("json() must not be called on a non-ok response"); },
        text: async () => JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "cli diagnostic print check" } }),
      });\n`,
      "utf-8"
    );

    const result = spawnSync(process.execPath, ["--import", preloadPath, CLI_PATH, "GS01", "--live"], {
      encoding: "utf-8",
      env: { ...process.env, LLM_API_KEY: "sk-test-fake-key-never-sent" },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FAIL\s+LlmClientError/);
    assert.match(result.stderr, /status:\s*400/);
    assert.match(result.stderr, /errorType:\s*invalid_request_error/);
    assert.match(result.stderr, /requestId:\s*req_cli_diagnostic_test/);
    assert.match(result.stderr, /message:\s*cli diagnostic print check/);
    assert.doesNotMatch(result.stderr, /sk-test-fake-key-never-sent/);
    assert.doesNotMatch(result.stdout, /Carousel Content generated OK/);
  });
});

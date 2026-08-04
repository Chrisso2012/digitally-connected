// Unit tests for tests/validation/publish-production-assets.mjs
// (DC-003-I022). No real network: this CLI's mock (default) mode never
// constructs the real Google Drive adapter at all, and every --live gate
// test is guaranteed to return before any request is attempted. No test
// in this file makes a real HTTP request or requires Google credentials.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "publish-production-assets.mjs");

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-publish-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedPackage(dir, carouselId = "car_publishcli0001") {
  const metadata = {
    asset_package_id: "pkg_publishcli0001",
    carousel_id: carouselId,
    carousel_content_id: "cc_publishcli0001",
    execution_id: "exec_20260804_deadbeefcafe",
    topic_id: "topic_01J9PUBLISHCLI",
    export_timestamp: "2026-08-04T01:00:00.000Z",
    renderer_provider: "templated-http",
    render_duration_ms: 18000,
    total_duration_ms: 18000,
    slide_count: 6,
    export_version: "1.0",
  };
  writeFileSync(path.join(dir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");
  for (const name of ["01-cover.png", "02-content.png", "03-statistic.png", "04-quote.png", "05-infographic.png", "06-cta.png"]) {
    writeFileSync(path.join(dir, name), Buffer.from("fake-bytes"));
  }
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      GOOGLE_DRIVE_CLIENT_ID: "",
      GOOGLE_DRIVE_CLIENT_SECRET: "",
      GOOGLE_DRIVE_REFRESH_TOKEN: "",
      GOOGLE_DRIVE_ROOT_FOLDER_ID: "",
      ...env,
    },
  });
}

// --- Usage -----------------------------------------------------------

test("no arguments prints usage and exits non-zero", () => {
  const result = runCli([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: node tests\/validation\/publish-production-assets\.mjs/);
});

// --- Mock (default) path -------------------------------------------------

test("mock (default) publish against a real exported package exits 0 and prints a summary", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const result = runCli([dir]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Publish complete/);
    assert.match(result.stdout, /status:\s*completed/);
    assert.match(result.stdout, /publisher:\s*mock-publisher/);
    assert.match(result.stdout, /files uploaded:\s*7/);
    assert.doesNotMatch(result.stdout, /Publishing LIVE/);
  }));

test("mock is the default even when all 4 credentials are present in the environment — --live is required to opt in", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const result = runCli([dir], {
      GOOGLE_DRIVE_CLIENT_ID: "fake-present",
      GOOGLE_DRIVE_CLIENT_SECRET: "fake-present",
      GOOGLE_DRIVE_REFRESH_TOKEN: "fake-present",
      GOOGLE_DRIVE_ROOT_FOLDER_ID: "fake-present",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /Publishing LIVE/, "presence of all 4 credentials alone must never switch to a live publish");
  }));

test("an invalid asset package path exits non-zero with a safe error, not a stack trace", () => {
  const result = runCli(["/this/path/does/not/exist/on/disk"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /InvalidAssetPackageError/);
  assert.doesNotMatch(result.stderr, /at file:\/\//);
});

test("--replace is forwarded through mock mode without affecting the default success path", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const result = runCli([dir, "--replace"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Publish complete/);
  }));

// --- Explicit live-mode gate: all 4 credentials required before any request

test("--live without any credentials fails fast, before any request is attempted", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const result = runCli([dir, "--live"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--live requires GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID/);
    assert.doesNotMatch(result.stdout, /Publishing LIVE/, "must fail before even announcing a live attempt");
  }));

test("--live with only some credentials set still fails fast, naming exactly the missing ones", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const result = runCli([dir, "--live"], { GOOGLE_DRIVE_CLIENT_ID: "present", GOOGLE_DRIVE_CLIENT_SECRET: "present" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GOOGLE_DRIVE_REFRESH_TOKEN/);
    assert.match(result.stderr, /GOOGLE_DRIVE_ROOT_FOLDER_ID/);
    assert.doesNotMatch(result.stderr, /GOOGLE_DRIVE_CLIENT_ID,/);
  }));

test("no credential value is ever leaked into stdout/stderr when credentials are missing", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const result = runCli([dir, "--live"]);
    assert.doesNotMatch(result.stdout, /fake-present/);
    assert.doesNotMatch(result.stderr, /fake-present/);
  }));

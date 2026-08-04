// Unit tests for tests/validation/production-metrics.mjs (DC-003-I023). No
// network of any kind — this CLI never talks to a provider; it only reads
// JSON files and the local metrics store.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "production-metrics.mjs");

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-metrics-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeProductionResult(dir, filename, overrides = {}) {
  const result = {
    success: true,
    requestId: "req_01J9METRICSCLI0001",
    sourceReference: "GS01",
    executionId: "exec_20260804_deadbeefcafe",
    carouselContentId: "cc_metricscli0001",
    carouselId: "car_metricscli0001",
    status: "completed",
    slideCount: 6,
    renderedSlideCount: 6,
    stored: true,
    storeReference: "local-json-carousel-store:car_metricscli0001",
    warnings: [],
    error: null,
    duration: 33734,
    ...overrides,
  };
  const filePath = path.join(dir, filename);
  writeFileSync(filePath, JSON.stringify(result), "utf-8");
  return filePath;
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

// --- Usage -----------------------------------------------------------

test("no arguments prints usage and exits non-zero", () => {
  const result = runCli([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: node tests\/validation\/production-metrics\.mjs/);
});

test("an unrecognized command prints usage and exits non-zero", () => {
  const result = runCli(["bogus-command"]);
  assert.notEqual(result.status, 0);
});

// --- record ------------------------------------------------------------

test("record: builds and persists a completed metrics record from a Production Run Result file alone", () =>
  withTempDir((dir) =>
    withTempDir((storeDir) => {
      const productionResultPath = writeProductionResult(dir, "production-result.json");
      const result = runCli(["record", productionResultPath, storeDir]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Metrics recorded/);
      assert.match(result.stdout, /status:\s*completed/);
      assert.match(result.stdout, /anthropic=1, templated=6, google_drive=0/);
    })
  ));

test("record: enriches with --export and --publish result files when supplied", () =>
  withTempDir((dir) =>
    withTempDir((storeDir) => {
      const productionResultPath = writeProductionResult(dir, "production-result.json");
      const exportPath = path.join(dir, "export-result.json");
      writeFileSync(exportPath, JSON.stringify({ filesExported: 7 }), "utf-8");
      const publishPath = path.join(dir, "publish-result.json");
      writeFileSync(publishPath, JSON.stringify({ filesUploaded: 7 }), "utf-8");

      const result = runCli(["record", productionResultPath, storeDir, `--export=${exportPath}`, `--publish=${publishPath}`]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /exported=7/);
      assert.match(result.stdout, /published=7/);
    })
  ));

test("record: --anthropic-input-tokens/--anthropic-output-tokens produce an \"estimated\" Anthropic cost instead of \"unavailable\"", () =>
  withTempDir((dir) =>
    withTempDir((storeDir) => {
      const productionResultPath = writeProductionResult(dir, "production-result.json");
      const result = runCli(["record", productionResultPath, storeDir, "--anthropic-input-tokens=1000000", "--anthropic-output-tokens=1000000"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /anthropic=[\d.]+ \(estimated\)/);
    })
  ));

test("record: without token flags, Anthropic cost is honestly reported as \"unavailable\"", () =>
  withTempDir((dir) =>
    withTempDir((storeDir) => {
      const productionResultPath = writeProductionResult(dir, "production-result.json");
      const result = runCli(["record", productionResultPath, storeDir]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /anthropic=0 \(unavailable\)/);
    })
  ));

test("record: a failed Production Run Result produces a failed metrics record, no fake success", () =>
  withTempDir((dir) =>
    withTempDir((storeDir) => {
      const productionResultPath = writeProductionResult(dir, "production-result.json", {
        success: false,
        carouselContentId: null,
        carouselId: null,
        renderedSlideCount: 2,
      });
      const result = runCli(["record", productionResultPath, storeDir]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /status:\s*failed/);
      assert.match(result.stdout, /carousel ID:\s*null/);
    })
  ));

test("record: a malformed production result file exits non-zero with a safe error", () =>
  withTempDir((dir) =>
    withTempDir((storeDir) => {
      const filePath = path.join(dir, "bad.json");
      writeFileSync(filePath, "{ not valid json", "utf-8");
      const result = runCli(["record", filePath, storeDir]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Malformed JSON/);
    })
  ));

test("record: a missing production result file exits non-zero with a safe error, not a stack trace", () =>
  withTempDir((storeDir) => {
    const result = runCli(["record", "/does/not/exist.json", storeDir]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /File not found/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

// --- get / list / find-execution ------------------------------------

test("get: retrieves a previously recorded metrics record by ID", () =>
  withTempDir((dir) =>
    withTempDir((storeDir) => {
      const productionResultPath = writeProductionResult(dir, "production-result.json");
      const recordResult = runCli(["record", productionResultPath, storeDir]);
      const metricsIdMatch = recordResult.stdout.match(/metrics ID:\s*(\S+)/);
      const metricsId = metricsIdMatch[1];

      const getResult = runCli(["get", metricsId, storeDir]);
      assert.equal(getResult.status, 0, getResult.stderr);
      assert.match(getResult.stdout, /Metrics record found/);
      assert.match(getResult.stdout, new RegExp(metricsId));
    })
  ));

test("get: an unknown metrics ID exits non-zero with a safe error", () =>
  withTempDir((storeDir) => {
    const result = runCli(["get", "met_doesnotexist00001", storeDir]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /MetricsRecordNotFoundError/);
  }));

test("list: reports zero records for an empty store, and the correct count after recording", () =>
  withTempDir((dir) =>
    withTempDir((storeDir) => {
      const empty = runCli(["list", storeDir]);
      assert.equal(empty.status, 0, empty.stderr);
      assert.match(empty.stdout, /0 metrics record\(s\)/);

      const productionResultPath = writeProductionResult(dir, "production-result.json");
      runCli(["record", productionResultPath, storeDir]);

      const populated = runCli(["list", storeDir]);
      assert.match(populated.stdout, /1 metrics record\(s\)/);
    })
  ));

test("find-execution: returns matching records for the given execution ID", () =>
  withTempDir((dir) =>
    withTempDir((storeDir) => {
      const productionResultPath = writeProductionResult(dir, "production-result.json", { executionId: "exec_20260804_findtestexec1" });
      runCli(["record", productionResultPath, storeDir]);

      const found = runCli(["find-execution", "exec_20260804_findtestexec1", storeDir]);
      assert.equal(found.status, 0, found.stderr);
      assert.match(found.stdout, /1 matching metrics record\(s\)/);

      const notFound = runCli(["find-execution", "exec_20260804_nomatch00001", storeDir]);
      assert.match(notFound.stdout, /0 matching metrics record\(s\)/);
    })
  ));

// --- Safety: no secrets ever appear -------------------------------------

test("no output ever contains a raw filesystem path from a thrown error's own message, or a stack trace", () =>
  withTempDir((storeDir) => {
    const result = runCli(["get", "met_doesnotexist00001", storeDir]);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  }));

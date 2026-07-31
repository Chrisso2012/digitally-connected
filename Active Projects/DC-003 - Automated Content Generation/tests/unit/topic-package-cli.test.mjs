import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "check-topic-package.mjs");
const TOPIC_PACKAGES_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "topic-packages");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

test("CLI exits 0 for a valid, approved, ready Topic Package", () => {
  const result = runCli(path.join(TOPIC_PACKAGES_DIR, "approved.valid.json"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Topic Package OK/);
  assert.match(result.stdout, /topic_01J9Y1B2C3/);
});

test("CLI exits non-zero for a draft (not-ready) Topic Package", () => {
  const result = runCli(path.join(TOPIC_PACKAGES_DIR, "draft.not-ready.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not operationally ready/);
  assert.match(result.stderr, /approval-state/);
});

test("CLI exits non-zero for a schema-invalid Topic Package", () => {
  const invalidPath = path.join(PROJECT_ROOT, "tests", "fixtures", "invalid", "topic-package.invalid.json");
  const result = runCli(invalidPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /schema-invalid/);
});

test("CLI exits non-zero for a missing file, without a raw stack trace", () => {
  const result = runCli(path.join(TOPIC_PACKAGES_DIR, "does-not-exist.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TopicPackageNotFoundError/);
  assert.doesNotMatch(result.stderr, /at file:\/\//, "expected no raw stack trace for an expected user-input failure");
});

test("CLI output for a valid package is the documented summary only, no credential names", () => {
  const result = runCli(path.join(TOPIC_PACKAGES_DIR, "approved.valid.json"));
  const lines = result.stdout.trim().split("\n");
  // Seven documented lines: the OK header + 6 metadata fields — not a dump
  // of the full raw object.
  assert.equal(lines.length, 7, result.stdout);
  for (const envVarName of ["TEMPLATED_API_KEY", "LLM_API_KEY"]) {
    assert.doesNotMatch(result.stdout, new RegExp(envVarName));
  }
});

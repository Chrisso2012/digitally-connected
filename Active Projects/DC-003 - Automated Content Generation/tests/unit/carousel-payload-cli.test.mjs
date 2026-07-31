import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "map-payload.mjs");
const FIXTURES_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "carousel-content");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

test("CLI exits 0 with a readable per-slide summary for valid carousel content", () => {
  const result = runCli(path.join(FIXTURES_DIR, "valid.json"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Carousel mapped OK — 6 payload\(s\)/);
  assert.match(result.stdout, /template ID:/);
  assert.match(result.stdout, /editable layer count:/);
  assert.match(result.stdout, /mapped layer count:/);
  assert.match(result.stdout, /payload validation:\s*OK/);
  // one summary block per slide
  assert.equal((result.stdout.match(/template ID:/g) ?? []).length, 6);
});

test("CLI does not create any file on disk", () => {
  const before = readdirSync(PROJECT_ROOT).sort();
  runCli(path.join(FIXTURES_DIR, "valid.json"));
  const after = readdirSync(PROJECT_ROOT).sort();
  assert.deepEqual(before, after);
});

test("CLI exits non-zero and names UnknownTemplateError for the unknown-template fixture", () => {
  const result = runCli(path.join(FIXTURES_DIR, "unknown-template.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /UnknownTemplateError/);
});

test("CLI exits non-zero and names MissingLayerError for the missing-layer fixture", () => {
  const result = runCli(path.join(FIXTURES_DIR, "missing-layer.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MissingLayerError/);
});

test("CLI exits non-zero and names DuplicateLayerMappingError for the duplicate-layer fixture", () => {
  const result = runCli(path.join(FIXTURES_DIR, "duplicate-layer.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DuplicateLayerMappingError/);
});

test("CLI exits non-zero and reports structured schema errors for the invalid-payload fixture", () => {
  const result = runCli(path.join(FIXTURES_DIR, "invalid-payload.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Payload validation failed/);
  assert.match(result.stderr, /carousel_content_id/);
});

test("CLI exits non-zero for a missing file, without a raw stack trace", () => {
  const result = runCli(path.join(FIXTURES_DIR, "does-not-exist.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /File not found/);
  assert.doesNotMatch(result.stderr, /at file:\/\//);
});

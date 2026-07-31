import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "build-finished-carousel.mjs");
const CAROUSEL_CONTENT_FIXTURE = path.join(PROJECT_ROOT, "tests", "fixtures", "carousel-content.example.json");

// This CLI never accepts --live and never touches TEMPLATED_API_KEY — it
// always renders through the mock transport, so no credential is even
// relevant here. Explicitly clearing it anyway documents that intent.
function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: "" },
  });
}

test("CLI exits 0 and prints a full Finished Carousel summary for valid carousel content", () => {
  const result = runCli(CAROUSEL_CONTENT_FIXTURE);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Finished Carousel built OK/);
  assert.match(result.stdout, /carousel ID:/);
  assert.match(result.stdout, /overall status:\s*completed/);
  assert.match(result.stdout, /slides:\s*6\/6 completed/);
  assert.match(result.stdout, /execution ID:\s*exec_/);
  assert.match(result.stdout, /provider:\s*mock-transport/);
  // one per-slide summary line per slide
  assert.equal((result.stdout.match(/\[slide \d\]/g) ?? []).length, 6);
});

test("CLI never reaches the network — no --live flag exists, and it succeeds with no TEMPLATED_API_KEY set", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, CAROUSEL_CONTENT_FIXTURE], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: undefined },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("CLI does not create any file on disk", () => {
  const before = readdirSync(PROJECT_ROOT).sort();
  runCli(CAROUSEL_CONTENT_FIXTURE);
  const after = readdirSync(PROJECT_ROOT).sort();
  assert.deepEqual(before, after);
});

test("CLI exits non-zero for a missing file, without a raw stack trace", () => {
  const result = runCli(path.join(PROJECT_ROOT, "tests", "fixtures", "does-not-exist.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /File not found/);
  assert.doesNotMatch(result.stderr, /at file:\/\//);
});

test("CLI exits non-zero for malformed JSON", () => {
  const result = runCli(path.join(PROJECT_ROOT, "tests", "fixtures", "topic-packages", "malformed.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Malformed JSON/);
});

test("CLI exits non-zero and names UnknownTemplateError for the unknown-template fixture", () => {
  const result = runCli(path.join(PROJECT_ROOT, "tests", "fixtures", "carousel-content", "unknown-template.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /UnknownTemplateError/);
});

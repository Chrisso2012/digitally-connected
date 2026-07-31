import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "generate-mock-carousel.mjs");
const TOPIC_PACKAGES_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "topic-packages");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

test("CLI exits 0 and prints a readable summary for a valid, ready Topic Package", () => {
  const result = runCli(path.join(TOPIC_PACKAGES_DIR, "approved.valid.json"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Carousel generated OK/);
  assert.match(result.stdout, /topic:/);
  assert.match(result.stdout, /generated title:/);
  assert.match(result.stdout, /slide count:\s*6/);
  assert.match(result.stdout, /generation version:/);
  assert.match(result.stdout, /provider:\s*mock-provider-v1/);
});

test("CLI does not create any file on disk", () => {
  const before = readdirSync(PROJECT_ROOT).sort();
  runCli(path.join(TOPIC_PACKAGES_DIR, "approved.valid.json"));
  const after = readdirSync(PROJECT_ROOT).sort();
  assert.deepEqual(before, after, "CLI must not write any file to the project root");
});

test("CLI exits non-zero for a Topic Package that is not operationally ready", () => {
  const result = runCli(path.join(TOPIC_PACKAGES_DIR, "draft.not-ready.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not operationally ready/);
});

test("CLI exits non-zero for a missing Topic Package file, without a raw stack trace", () => {
  const result = runCli(path.join(TOPIC_PACKAGES_DIR, "does-not-exist.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TopicPackageNotFoundError/);
  assert.doesNotMatch(result.stderr, /at file:\/\//);
});

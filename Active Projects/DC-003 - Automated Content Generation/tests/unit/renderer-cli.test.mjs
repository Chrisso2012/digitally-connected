import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "render-payload.mjs");
const PAYLOAD_FIXTURE = path.join(PROJECT_ROOT, "tests", "fixtures", "templated-payload.example.json");

// Deliberately never passes --live: automated tests must never reach the
// network, per the I006 "Mock First" constraint.
function runCliMock(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: "" },
  });
}

test("CLI (mock, default) exits 0 with a readable summary", () => {
  const result = runCliMock(PAYLOAD_FIXTURE);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Render OK/);
  assert.match(result.stdout, /render ID:/);
  assert.match(result.stdout, /status:\s*completed/);
  assert.match(result.stdout, /image URL:/);
  assert.match(result.stdout, /provider:\s*mock-transport/);
});

test("CLI does not create any file on disk", () => {
  const before = readdirSync(PROJECT_ROOT).sort();
  runCliMock(PAYLOAD_FIXTURE);
  const after = readdirSync(PROJECT_ROOT).sort();
  assert.deepEqual(before, after);
});

test("CLI --live without TEMPLATED_API_KEY fails fast without attempting a network call", () => {
  const result = runCliMock(PAYLOAD_FIXTURE, "--live");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TEMPLATED_API_KEY/);
});

test("CLI exits non-zero for a missing file, without a raw stack trace", () => {
  const result = runCliMock(path.join(PROJECT_ROOT, "tests", "fixtures", "does-not-exist.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /File not found/);
  assert.doesNotMatch(result.stderr, /at file:\/\//);
});

test("CLI exits non-zero for malformed JSON", () => {
  const result = runCliMock(path.join(PROJECT_ROOT, "tests", "fixtures", "topic-packages", "malformed.json"));
  assert.notEqual(result.status, 0);
});

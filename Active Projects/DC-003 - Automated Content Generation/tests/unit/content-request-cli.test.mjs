import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "content-request.mjs");
const TOPIC_PACKAGE_FIXTURE = path.join(PROJECT_ROOT, "tests", "fixtures", "topic-package.example.json");

// No TEMPLATED_API_KEY, no network — this CLI always renders through the
// mock transport (DC-003-I006's own "no automated/demonstration path may
// reach the network" constraint applies here too).
function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: undefined },
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-content-request-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeMatchingTopicPackage(dir, sourceReference) {
  const topicPackage = JSON.parse(readFileSync(TOPIC_PACKAGE_FIXTURE, "utf-8"));
  topicPackage.source = "backlog";
  topicPackage.backlog_reference_id = sourceReference;
  writeFileSync(path.join(dir, "source.json"), JSON.stringify(topicPackage), "utf-8");
}

test("a valid command against the default (repository) topicPackagesDir succeeds and prints a safe summary", () => {
  withTempDir((storeDir) => {
    const result = runCli("Create 6 designs based on article GS01", storeDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Content Request complete/);
    assert.match(result.stdout, /request ID:\s*req_/);
    assert.match(result.stdout, /source:\s*GS01/);
    assert.match(result.stdout, /execution ID:\s*exec_/);
    assert.match(result.stdout, /carousel ID:\s*car_/);
    assert.match(result.stdout, /status:\s*completed/);
    assert.match(result.stdout, /stored:\s*true/);
    assert.match(result.stdout, /store reference:\s*local-json-carousel-store:car_/);
  });
});

test("a valid command against an explicit custom topicPackagesDir succeeds", () => {
  withTempDir((storeDir) => {
    withTempDir((sourceDir) => {
      writeMatchingTopicPackage(sourceDir, "CUSTOM01");
      const result = runCli("Create 6 designs based on article CUSTOM01", storeDir, sourceDir);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Content Request complete/);
      assert.match(result.stdout, /source:\s*CUSTOM01/);
    });
  });
});

test("an unknown source reference exits non-zero with a safe error, not a stack trace", () => {
  withTempDir((storeDir) => {
    const result = runCli("Create 6 designs based on article DOES_NOT_EXIST", storeDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /did not complete successfully/);
    assert.match(result.stdout, /UnknownSourceReferenceError/);
    assert.doesNotMatch(result.stdout, /at file:\/\//);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("an ambiguous command exits non-zero with a clear error, not a stack trace", () => {
  withTempDir((storeDir) => {
    const result = runCli("Please make me some designs", storeDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AmbiguousContentRequestError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("an unsupported design count exits non-zero with a clear error", () => {
  withTempDir((storeDir) => {
    const result = runCli("Create 3 designs based on article GS01", storeDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /UnsupportedDesignCountError/);
  });
});

test("exits non-zero with usage when no arguments are given", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("exits non-zero with usage when storeDirectory is missing", () => {
  const result = runCli("Create 6 designs based on article GS01");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("does not create any file outside the given store directory", () => {
  withTempDir((storeDir) => {
    const before = readdirSync(PROJECT_ROOT).sort();
    runCli("Create 6 designs based on article GS01", storeDir);
    const after = readdirSync(PROJECT_ROOT).sort();
    assert.deepEqual(before, after);
  });
});

test("running the same command twice against the same store directory succeeds both times (each production run gets its own carousel_id), and both land in the I015 store", () => {
  withTempDir((storeDir) => {
    const first = runCli("Create 6 designs based on article GS01", storeDir);
    const second = runCli("Create 6 designs based on article GS01", storeDir);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);

    const listCliPath = path.join(PROJECT_ROOT, "tests", "validation", "carousel-store.mjs");
    const listResult = spawnSync(process.execPath, [listCliPath, "list", storeDir], { encoding: "utf-8" });
    assert.match(listResult.stdout, /^2 carousel\(s\)/);
  });
});

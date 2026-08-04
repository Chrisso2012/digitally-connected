// Unit tests for tests/validation/publisher-results.mjs (DC-003-I025).
// This CLI is entirely read-only against a local store — no network, no
// live provider of any kind — so every test here just seeds a store
// directory directly via the domain layer, then exercises the CLI.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import { createPublisherResult } from "../../src/publisher-result.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "publisher-results.mjs");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-publisher-results-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedResult(storeDir, overrides = {}) {
  const store = createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: storeDir }) });
  const result = createPublisherResult({
    carouselId: "car_clitest0000001",
    assetPackageId: "pkg_clitest0000001",
    executionId: "exec_20260804_deadbeefcafe",
    provider: "google-drive",
    destination: "https://drive.google.com/drive/folders/clitest",
    providerReference: "folder_clitest",
    metadata: { files_uploaded: 7 },
    ...overrides,
  });
  return store.save(result);
}

// --- usage -----------------------------------------------------------

test("no subcommand prints usage and exits non-zero", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("missing arguments print usage and exit non-zero, for every subcommand", () => {
  withTempDir((dir) => {
    for (const args of [["list"], ["get"], ["get", "pub_x"], ["carousel"], ["carousel", "car_x"], ["execution"], ["execution", "exec_x"]]) {
      const result = runCli(...args);
      assert.notEqual(result.status, 0, `expected non-zero exit for args: ${JSON.stringify(args)}`);
      assert.match(result.stderr, /Usage:/);
    }
  });
});

// --- list --------------------------------------------------------------

test("list on an empty store reports 0 results", () => {
  withTempDir((dir) => {
    const result = runCli("list", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^0 publisher result\(s\)/);
  });
});

test("list reports a real seeded result", () => {
  withTempDir((dir) => {
    const seeded = seedResult(dir);
    const result = runCli("list", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 publisher result\(s\)/);
    assert.match(result.stdout, new RegExp(seeded.publisher_result_id));
    assert.match(result.stdout, /provider=google-drive/);
  });
});

// --- get -----------------------------------------------------------------

test("get retrieves a real seeded result by ID", () => {
  withTempDir((dir) => {
    const seeded = seedResult(dir);
    const result = runCli("get", seeded.publisher_result_id, dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Publisher result found/);
    assert.match(result.stdout, new RegExp(`publisher_result_id: ${seeded.publisher_result_id}`));
    assert.match(result.stdout, /provider:\s*google-drive/);
  });
});

test("get fails with PublisherResultNotFoundError, not a stack trace, for an unknown ID", () => {
  withTempDir((dir) => {
    const result = runCli("get", "pub_doesnotexist0001", dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PublisherResultNotFoundError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

// --- carousel --------------------------------------------------------------

test("carousel finds every result for a given carousel_id", () => {
  withTempDir((dir) => {
    seedResult(dir, { carouselId: "car_clitest0000001" });
    seedResult(dir, { carouselId: "car_clitest0000001", assetPackageId: "pkg_clitest0000002" });
    seedResult(dir, { carouselId: "car_other000000002" });

    const result = runCli("carousel", "car_clitest0000001", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 publisher result\(s\) for carousel "car_clitest0000001"/);
  });
});

test("carousel reports 0 results, not an error, for a carousel with no publisher results", () => {
  withTempDir((dir) => {
    seedResult(dir, { carouselId: "car_other000000002" });
    const result = runCli("carousel", "car_nomatch0000001", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0 publisher result\(s\)/);
  });
});

// --- execution ---------------------------------------------------------

test("execution finds every result for a given execution_id", () => {
  withTempDir((dir) => {
    seedResult(dir, { executionId: "exec_20260804_target00001" });
    const result = runCli("execution", "exec_20260804_target00001", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 publisher result\(s\) for execution "exec_20260804_target00001"/);
  });
});

// --- read-only guarantee -----------------------------------------------

test("no subcommand ever writes to the store directory", () => {
  withTempDir((dir) => {
    const seeded = seedResult(dir);
    const beforeFiles = readdirSync(dir).sort();

    runCli("list", dir);
    runCli("get", seeded.publisher_result_id, dir);
    runCli("carousel", seeded.carousel_id, dir);
    runCli("execution", seeded.execution_id, dir);

    const afterFiles = readdirSync(dir).sort();
    assert.deepEqual(afterFiles, beforeFiles, "no files were created or removed by any subcommand");
  });
});

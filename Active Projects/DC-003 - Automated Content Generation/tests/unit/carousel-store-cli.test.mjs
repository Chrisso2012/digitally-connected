import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "carousel-store.mjs");
const FIXTURE_PATH = path.join(PROJECT_ROOT, "tests", "fixtures", "finished-carousel.example.json");

// No TEMPLATED_API_KEY, no network — this CLI never touches the renderer
// or the ledger.
function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: undefined },
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-carousel-store-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("save then get round-trips the full carousel via the CLI", () => {
  withTempDir((storeDir) => {
    const saveResult = runCli("save", FIXTURE_PATH, storeDir);
    assert.equal(saveResult.status, 0, saveResult.stderr);
    assert.match(saveResult.stdout, /Carousel save OK/);

    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
    const getResult = runCli("get", fixture.carousel_id, storeDir);
    assert.equal(getResult.status, 0, getResult.stderr);
    assert.match(getResult.stdout, /Carousel found OK/);
    const printed = JSON.parse(getResult.stdout.split("\n").slice(1).join("\n"));
    assert.deepEqual(printed, fixture);
  });
});

test("save rejects a duplicate save for the same carousel_id", () => {
  withTempDir((storeDir) => {
    runCli("save", FIXTURE_PATH, storeDir);
    const second = runCli("save", FIXTURE_PATH, storeDir);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /CarouselAlreadyExistsError/);
  });
});

test("get on an empty store fails with CarouselNotFoundError, not a stack trace", () => {
  withTempDir((storeDir) => {
    const result = runCli("get", "car_doesnotexist", storeDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CarouselNotFoundError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("get rejects a path-traversal identifier without touching the filesystem outside the store directory", () => {
  withTempDir((storeDir) => {
    const result = runCli("get", "../../../../etc/passwd", storeDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /InvalidCarouselIdentifierError/);
  });
});

test("list reports an empty store, then one entry after a save, with the documented summary fields", () => {
  withTempDir((storeDir) => {
    const emptyResult = runCli("list", storeDir);
    assert.equal(emptyResult.status, 0, emptyResult.stderr);
    assert.match(emptyResult.stdout, /^0 carousel\(s\)/);

    runCli("save", FIXTURE_PATH, storeDir);
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));

    const listResult = runCli("list", storeDir);
    assert.equal(listResult.status, 0, listResult.stderr);
    assert.match(listResult.stdout, /^1 carousel\(s\)/);
    assert.match(listResult.stdout, new RegExp(`\\[${fixture.carousel_id}\\]`));
    assert.match(listResult.stdout, /approved=false/);
    assert.match(listResult.stdout, /published=false/);
    assert.match(listResult.stdout, /slides=6/);
  });
});

test("replace persists an approval transition and get reflects it", () => {
  withTempDir((storeDir) => {
    runCli("save", FIXTURE_PATH, storeDir);
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));

    const approvedPath = path.join(storeDir, "approved.json");
    writeFileSync(
      approvedPath,
      JSON.stringify({
        ...fixture,
        approval: { ...fixture.approval, approved: true, approved_by: "chris", approved_at: "2026-08-04T00:00:00.000Z" },
      }),
      "utf-8"
    );

    const replaceResult = runCli("replace", approvedPath, storeDir);
    assert.equal(replaceResult.status, 0, replaceResult.stderr);
    assert.match(replaceResult.stdout, /Carousel replace OK/);

    const getResult = runCli("get", fixture.carousel_id, storeDir);
    const printed = JSON.parse(getResult.stdout.split("\n").slice(1).join("\n"));
    assert.equal(printed.approval.approved, true);
    assert.equal(printed.approval.approved_by, "chris");
  });
});

test("replace on a carousel that was never saved fails with CarouselNotFoundError", () => {
  withTempDir((storeDir) => {
    const result = runCli("replace", FIXTURE_PATH, storeDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CarouselNotFoundError/);
  });
});

test("get fails clearly, without a raw stack trace, for a corrupted stored file", () => {
  withTempDir((storeDir) => {
    runCli("save", FIXTURE_PATH, storeDir);
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
    // Directly corrupt the stored file, bypassing the store's own writer —
    // simulates on-disk corruption the store must still detect on read.
    writeFileSync(path.join(storeDir, `${fixture.carousel_id}.json`), "{ not actually valid json", "utf-8");

    const result = runCli("get", fixture.carousel_id, storeDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CorruptedCarouselError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("exits non-zero for a missing finishedCarouselPath, without a raw stack trace", () => {
  withTempDir((storeDir) => {
    const result = runCli("save", path.join(storeDir, "does-not-exist.json"), storeDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /File not found/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("exits non-zero for malformed JSON in the finished carousel file", () => {
  withTempDir((storeDir) => {
    const badPath = path.join(storeDir, "bad.json");
    writeFileSync(badPath, "{ not json", "utf-8");
    const result = runCli("save", badPath, storeDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Malformed JSON/);
  });
});

test("exits non-zero and prints usage for an unknown subcommand", () => {
  const result = runCli("delete-everything");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("exits non-zero with usage when no arguments are given", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "approve-carousel.mjs");
const FIXTURE_PATH = path.join(PROJECT_ROOT, "tests", "fixtures", "finished-carousel.example.json");

// No TEMPLATED_API_KEY, no network — this CLI never touches the renderer
// or the ledger, unlike most other CLIs in this repo.
function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: undefined },
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-approval-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("approve prints a success summary and exits 0", () => {
  const result = runCli(FIXTURE_PATH, "approve", "--by=chris@digitallyconnected.net");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Carousel approve OK/);
  assert.match(result.stdout, /approved:\s*true/);
  assert.match(result.stdout, /approved by:\s*chris@digitallyconnected\.net/);
});

test("reject prints a success summary and exits 0", () => {
  const result = runCli(FIXTURE_PATH, "reject", "--reason=cover slide headline is wrong");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Carousel reject OK/);
  assert.match(result.stdout, /rejected:\s*true/);
  assert.match(result.stdout, /rejection reason:\s*cover slide headline is wrong/);
});

test("publish on a fresh (unapproved) carousel fails with a clear error, not a stack trace", () => {
  const result = runCli(FIXTURE_PATH, "publish");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /InvalidApprovalTransitionError/);
  assert.match(result.stderr, /is not approved yet/);
  assert.doesNotMatch(result.stderr, /at file:\/\//);
});

test("approve --out writes the updated object to disk, and a subsequent publish against that file succeeds", () => {
  withTempDir((dir) => {
    const approvedPath = path.join(dir, "approved.json");
    const approveResult = runCli(FIXTURE_PATH, "approve", "--by=chris", `--out=${approvedPath}`);
    assert.equal(approveResult.status, 0, approveResult.stderr);
    assert.match(approveResult.stdout, /written to:/);

    const approvedOnDisk = JSON.parse(readFileSync(approvedPath, "utf-8"));
    assert.equal(approvedOnDisk.approval.approved, true);
    assert.equal(approvedOnDisk.approval.approved_by, "chris");

    const publishResult = runCli(approvedPath, "publish");
    assert.equal(publishResult.status, 0, publishResult.stderr);
    assert.match(publishResult.stdout, /published:\s*true/);
  });
});

test("without --out, no file is written anywhere in the project directory", () => {
  const before = readdirSync(PROJECT_ROOT).sort();
  runCli(FIXTURE_PATH, "approve", "--by=chris");
  const after = readdirSync(PROJECT_ROOT).sort();
  assert.deepEqual(before, after);
});

test("does not modify the source finished-carousel fixture file", () => {
  const before = readFileSync(FIXTURE_PATH, "utf-8");
  runCli(FIXTURE_PATH, "approve", "--by=chris");
  runCli(FIXTURE_PATH, "reject", "--reason=test");
  runCli(FIXTURE_PATH, "publish");
  const after = readFileSync(FIXTURE_PATH, "utf-8");
  assert.equal(before, after);
});

test("exits non-zero for a missing file, without a raw stack trace", () => {
  const result = runCli(path.join(PROJECT_ROOT, "tests", "fixtures", "does-not-exist.json"), "approve", "--by=chris");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /File not found/);
  assert.doesNotMatch(result.stderr, /at file:\/\//);
});

test("exits non-zero for malformed JSON", () => {
  const result = runCli(
    path.join(PROJECT_ROOT, "tests", "fixtures", "topic-packages", "malformed.json"),
    "approve",
    "--by=chris"
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Malformed JSON/);
});

test("exits non-zero and prints usage for an unknown decision", () => {
  const result = runCli(FIXTURE_PATH, "delete-forever");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown decision/);
});

test("exits non-zero with usage when no arguments are given", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("approve without --by fails with a clear error, not a stack trace", () => {
  const result = runCli(FIXTURE_PATH, "approve");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /InvalidApprovalTransitionError/);
  assert.doesNotMatch(result.stderr, /at file:\/\//);
});

test("reject without --reason fails with a clear error, not a stack trace", () => {
  const result = runCli(FIXTURE_PATH, "reject");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /InvalidApprovalTransitionError/);
  assert.doesNotMatch(result.stderr, /at file:\/\//);
});

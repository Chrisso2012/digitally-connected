// Unit tests for tests/validation/content-ingestion.mjs (DC-003-I030).
// Mock mode only (no --live, no network) — mirrors every other DC-003 CLI
// test's own "spawnSync via process.execPath + an array of args" pattern
// (operations-bridge-cli.test.mjs), which avoids the ESM URL scheme issue
// a raw dynamic import() of a Windows path can hit on this host.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "content-ingestion.mjs");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8" });
}

function runCliWithEnv(env, ...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8", env });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-content-ingestion-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("no subcommand prints usage and exits 1", () => {
  const result = runCli();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("create with missing arguments prints usage and exits 1", () => {
  const result = runCli("create");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("create (mock mode, default fixture) ingests and prints the full record", () =>
  withTempDir((dir) => {
    const result = runCli("create", "doc-ref-1", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Ingested Content created OK/);
    assert.match(result.stdout, /ingested_content_id:\s+ic_/);
    assert.match(result.stdout, /source_type:\s+google_docs/);
  }));

test("create with --title/--body overrides the mock fixture content for that sourceReference", () =>
  withTempDir((dir) => {
    const longBody = Array(250).fill("word").join(" ");
    const result = runCli("create", "doc-ref-2", dir, `--title=My Title`, `--body=${longBody}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /title:\s+My Title/);
  }));

test("create fails cleanly for an article below the minimum word count", () =>
  withTempDir((dir) => {
    const result = runCli("create", "doc-ref-3", dir, "--title=Short", "--body=too short");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL\s+ArticleTooShortError/);
  }));

test("create respects --min-words", () =>
  withTempDir((dir) => {
    const result = runCli("create", "doc-ref-4", dir, "--title=Short", "--body=only four words here", "--min-words=3");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Ingested Content created OK/);
  }));

test("a second create for the same unchanged source fails as a duplicate", () =>
  withTempDir((dir) => {
    const longBody = Array(250).fill("word").join(" ");
    const first = runCli("create", "doc-ref-5", dir, "--title=T", `--body=${longBody}`);
    assert.equal(first.status, 0, first.stderr);
    const second = runCli("create", "doc-ref-5", dir, "--title=T", `--body=${longBody}`);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /FAIL\s+DuplicateIngestionError/);
  }));

test("inspect prints full JSON for a stored record; fails cleanly for an unknown id", () =>
  withTempDir((dir) => {
    const longBody = Array(250).fill("word").join(" ");
    const created = runCli("create", "doc-ref-6", dir, "--title=Inspectable", `--body=${longBody}`);
    assert.equal(created.status, 0, created.stderr);
    const idMatch = created.stdout.match(/ingested_content_id:\s+(ic_[A-Za-z0-9]+)/);
    assert.ok(idMatch, "expected to find an ingested_content_id in create output");

    const inspected = runCli("inspect", idMatch[1], dir);
    assert.equal(inspected.status, 0, inspected.stderr);
    const parsed = JSON.parse(inspected.stdout.split("\n").slice(1).join("\n"));
    assert.equal(parsed.title, "Inspectable");

    const missing = runCli("inspect", "ic_doesnotexist00001", dir);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /FAIL\s+IngestedContentNotFoundError/);
  }));

test("list prints a summary line per stored record", () =>
  withTempDir((dir) => {
    const longBody = Array(250).fill("word").join(" ");
    runCli("create", "doc-ref-7", dir, "--title=Alpha", `--body=${longBody}`);
    runCli("create", "doc-ref-8", dir, "--title=Beta", `--body=${longBody}`);

    const result = runCli("list", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 ingested content record\(s\)/);
    assert.match(result.stdout, /Alpha/);
    assert.match(result.stdout, /Beta/);
  }));

test("status prints an aggregate summary, including for an empty store", () =>
  withTempDir((dir) => {
    const empty = runCli("status", dir);
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /total_ingested:\s+0/);
    assert.match(empty.stdout, /latest:\s+\(none\)/);

    const longBody = Array(250).fill("word").join(" ");
    runCli("create", "doc-ref-9", dir, "--title=Only", `--body=${longBody}`);
    const populated = runCli("status", dir);
    assert.equal(populated.status, 0, populated.stderr);
    assert.match(populated.stdout, /total_ingested:\s+1/);
    assert.match(populated.stdout, /"google_docs":1/);
    assert.match(populated.stdout, /"pending":1/);
  }));

// --- Google Docs authentication reporting (DC-003 credential-wiring session) ---

test("status reports Google Docs authentication as not available when GOOGLE_SERVICE_ACCOUNT_JSON is unset", () =>
  withTempDir((dir) => {
    const { GOOGLE_SERVICE_ACCOUNT_JSON, ...envWithoutCredential } = process.env;
    const result = runCliWithEnv(envWithoutCredential, "status", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /google_docs_auth:\s+not available/);
  }));

test("status reports Google Docs authentication as available when GOOGLE_SERVICE_ACCOUNT_JSON is set — structural signal only, never the value itself", () =>
  withTempDir((dir) => {
    // Deliberately fake, test-only JSON — never a real credential. Only the
    // presence/non-blankness of the env var is checked by
    // describeGoogleDocsAuthenticationAvailability(), not its shape.
    const env = { ...process.env, GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: "test@example.invalid", private_key: "test-only-not-real" }) };
    const result = runCliWithEnv(env, "status", dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /google_docs_auth:\s+available/);
    assert.doesNotMatch(result.stdout, /test-only-not-real/, "the credential value must never appear in CLI output");
  }));

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "invoke.mjs");
const TOPIC_PACKAGE_FIXTURE = path.join(PROJECT_ROOT, "tests", "fixtures", "topic-package.example.json");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: undefined },
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-invoke-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRequestFile(dir, fields) {
  const filePath = path.join(dir, "request.json");
  writeFileSync(filePath, JSON.stringify(fields), "utf-8");
  return filePath;
}

test("CLI accepts a valid request and prints a completed InvocationResponse", () => {
  withTempDir((dir) => {
    const requestPath = writeRequestFile(dir, {
      request_id: "cli-test-1",
      topic_package_reference: { file_path: TOPIC_PACKAGE_FIXTURE },
    });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(requestPath, ledgerPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Request accepted/);
    assert.match(result.stdout, /request ID:\s*cli-test-1/);
    assert.match(result.stdout, /execution ID:\s*exec_/);
    assert.match(result.stdout, /status:\s*completed/);
    assert.match(result.stdout, /carousel ID:\s*car_/);
  });
});

test("CLI rejects an invalid request (missing topic_package_reference) without touching the ledger", () => {
  withTempDir((dir) => {
    const requestPath = writeRequestFile(dir, { request_id: "cli-test-2" });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(requestPath, ledgerPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Request rejected/);
    assert.match(result.stdout, /status:\s*rejected/);
    assert.match(result.stdout, /error code:\s*InvocationRequestValidationError/);
  });
});

test("CLI reports a real pipeline failure (missing Topic Package file) as a failed, not rejected, invocation", () => {
  withTempDir((dir) => {
    const requestPath = writeRequestFile(dir, {
      request_id: "cli-test-3",
      topic_package_reference: { file_path: "does-not-exist.json" },
    });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(requestPath, ledgerPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /status:\s*failed/);
    assert.match(result.stdout, /error code:\s*TopicPackageNotFoundError/);
  });
});

test("CLI prints usage and exits non-zero when arguments are missing", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("CLI exits non-zero for a missing request file, without a raw stack trace", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(path.join(dir, "does-not-exist.json"), ledgerPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /File not found/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("CLI exits non-zero for malformed JSON in the request file", () => {
  withTempDir((dir) => {
    const requestPath = path.join(dir, "request.json");
    writeFileSync(requestPath, "{ not valid json", "utf-8");
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(requestPath, ledgerPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Malformed JSON/);
  });
});

test("CLI never touches the network — succeeds with no TEMPLATED_API_KEY at all", () => {
  withTempDir((dir) => {
    const requestPath = writeRequestFile(dir, {
      request_id: "cli-test-4",
      topic_package_reference: { file_path: TOPIC_PACKAGE_FIXTURE },
    });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = spawnSync(process.execPath, [CLI_PATH, requestPath, ledgerPath], {
      encoding: "utf-8",
      env: { ...process.env, TEMPLATED_API_KEY: undefined },
    });
    assert.equal(result.status, 0, result.stderr);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "n8n-invoke.mjs");
const TOPIC_PACKAGE_FIXTURE = path.join(PROJECT_ROOT, "tests", "fixtures", "topic-package.example.json");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: undefined },
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-n8n-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeWorkflowInputFile(dir, fields) {
  const filePath = path.join(dir, "workflow-input.json");
  writeFileSync(filePath, JSON.stringify(fields), "utf-8");
  return filePath;
}

test("CLI succeeds for a valid workflow input and prints a safe successful output", () => {
  withTempDir((dir) => {
    const workflowInputPath = writeWorkflowInputFile(dir, {
      requestId: "cli-test-1",
      topicPackageFilePath: TOPIC_PACKAGE_FIXTURE,
    });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(workflowInputPath, ledgerPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /n8n output: success/);
    assert.match(result.stdout, /requestId:\s*cli-test-1/);
    assert.match(result.stdout, /executionId:\s*exec_/);
    assert.match(result.stdout, /status:\s*completed/);
    assert.match(result.stdout, /carousel ID:\s*car_/);
  });
});

test("CLI reports invalid workflow input safely, without a raw stack trace", () => {
  withTempDir((dir) => {
    const workflowInputPath = writeWorkflowInputFile(dir, { requestId: "cli-test-2" });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(workflowInputPath, ledgerPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /n8n output: not successful/);
    assert.match(result.stdout, /status:\s*rejected/);
    assert.match(result.stdout, /error code:\s*InvocationRequestValidationError/);
    assert.doesNotMatch(result.stdout, /at file:\/\//);
  });
});

test("CLI reports a real pipeline failure as failed, not rejected", () => {
  withTempDir((dir) => {
    const workflowInputPath = writeWorkflowInputFile(dir, {
      requestId: "cli-test-3",
      topicPackageFilePath: "does-not-exist.json",
    });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(workflowInputPath, ledgerPath);

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

test("CLI exits non-zero for a missing workflow input file, without a raw stack trace", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(path.join(dir, "does-not-exist.json"), ledgerPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /File not found/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("CLI exits non-zero for malformed JSON in the workflow input file", () => {
  withTempDir((dir) => {
    const workflowInputPath = path.join(dir, "workflow-input.json");
    writeFileSync(workflowInputPath, "{ not valid json", "utf-8");
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(workflowInputPath, ledgerPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Malformed JSON/);
  });
});

test("CLI never touches the network — succeeds with no TEMPLATED_API_KEY at all", () => {
  withTempDir((dir) => {
    const workflowInputPath = writeWorkflowInputFile(dir, {
      requestId: "cli-test-4",
      topicPackageFilePath: TOPIC_PACKAGE_FIXTURE,
    });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = spawnSync(process.execPath, [CLI_PATH, workflowInputPath, ledgerPath], {
      encoding: "utf-8",
      env: { ...process.env, TEMPLATED_API_KEY: undefined },
    });
    assert.equal(result.status, 0, result.stderr);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "production-workflow.mjs");
const TOPIC_PACKAGE_FIXTURE = path.join(PROJECT_ROOT, "tests", "fixtures", "topic-package.example.json");

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: undefined },
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-workflow-cli-"));
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

test("CLI runs a successful workflow, writes output, and prints the summary", () => {
  withTempDir((dir) => {
    const workflowInputPath = writeWorkflowInputFile(dir, {
      requestId: "cli-test-1",
      topicPackageFilePath: TOPIC_PACKAGE_FIXTURE,
    });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const outputPath = path.join(dir, "output.json");
    const result = runCli(workflowInputPath, ledgerPath, outputPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Workflow complete/);
    assert.match(result.stdout, /status:\s*completed/);
    assert.match(result.stdout, /requestId:\s*cli-test-1/);
    assert.match(result.stdout, /executionId:\s*exec_/);
    assert.match(result.stdout, /duration:\s*\d+ms/);
    assert.match(result.stdout, /warning count:\s*0/);
    assert.match(result.stdout, /has error:\s*false/);

    assert.ok(existsSync(outputPath));
    const output = JSON.parse(readFileSync(outputPath, "utf-8"));
    assert.equal(output.summary.status, "completed");
    assert.equal(output.finishedCarousel.overall_status, "completed");
  });
});

test("CLI reports a workflow failure safely, still writing output", () => {
  withTempDir((dir) => {
    const workflowInputPath = writeWorkflowInputFile(dir, {
      requestId: "cli-test-2",
      topicPackageFilePath: "does-not-exist.json",
    });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const outputPath = path.join(dir, "output.json");
    const result = runCli(workflowInputPath, ledgerPath, outputPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Workflow did not complete successfully/);
    assert.match(result.stdout, /status:\s*failed/);
    assert.match(result.stdout, /error code:\s*TopicPackageNotFoundError/);
    assert.doesNotMatch(result.stdout, /at file:\/\//);

    assert.ok(existsSync(outputPath));
    const output = JSON.parse(readFileSync(outputPath, "utf-8"));
    assert.equal(output.summary.status, "failed");
    assert.equal(output.finishedCarousel, null);
  });
});

test("CLI reports invalid workflow input as rejected", () => {
  withTempDir((dir) => {
    const workflowInputPath = writeWorkflowInputFile(dir, { requestId: "cli-test-3" });
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const outputPath = path.join(dir, "output.json");
    const result = runCli(workflowInputPath, ledgerPath, outputPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /status:\s*rejected/);
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
    const outputPath = path.join(dir, "output.json");
    const result = runCli(path.join(dir, "does-not-exist.json"), ledgerPath, outputPath);
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
    const outputPath = path.join(dir, "output.json");
    const result = runCli(workflowInputPath, ledgerPath, outputPath);
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
    const outputPath = path.join(dir, "output.json");
    const result = spawnSync(process.execPath, [CLI_PATH, workflowInputPath, ledgerPath, outputPath], {
      encoding: "utf-8",
      env: { ...process.env, TEMPLATED_API_KEY: undefined },
    });
    assert.equal(result.status, 0, result.stderr);
  });
});

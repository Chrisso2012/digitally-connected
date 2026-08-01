import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "pipeline.mjs");
const TOPIC_PACKAGE_FIXTURE = path.join(PROJECT_ROOT, "tests", "fixtures", "topic-package.example.json");

function runCli(...args) {
  // No TEMPLATED_API_KEY, no network — the pipeline CLI never renders
  // through anything but the mock transport.
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: undefined },
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-pipeline-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI runs the full pipeline successfully and prints PipelineResult + execution summary", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(TOPIC_PACKAGE_FIXTURE, ledgerPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Pipeline OK/);
    assert.match(result.stdout, /execution ID:\s*exec_/);
    assert.match(result.stdout, /success:\s*true/);
    assert.match(result.stdout, /carousel ID:\s*car_/);
    assert.match(result.stdout, /overall status:\s*completed/);
    assert.match(result.stdout, /Execution summary:/);
    assert.match(result.stdout, /record count:\s*8/);
    assert.match(result.stdout, /final status:\s*succeeded/);
  });
});

test("CLI creates the ledger file with one JSONL line per execution record", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(TOPIC_PACKAGE_FIXTURE, ledgerPath);
    assert.equal(result.status, 0, result.stderr);

    assert.ok(existsSync(ledgerPath));
    const lines = readFileSync(ledgerPath, "utf-8").split("\n").filter((l) => l.trim() !== "");
    assert.equal(lines.length, 8);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  });
});

test("CLI fails cleanly for a nonexistent Topic Package file, still recording execution.failed", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli(path.join(PROJECT_ROOT, "tests", "fixtures", "does-not-exist.json"), ledgerPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Pipeline FAILED/);
    assert.match(result.stdout, /failed stage:\s*load-topic/);
    assert.match(result.stdout, /error code:\s*TopicPackageNotFoundError/);
    assert.match(result.stdout, /final status:\s*failed/);
  });
});

test("CLI prints usage and exits non-zero when arguments are missing", () => {
  const result = runCli();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test("CLI never touches the network — succeeds with no TEMPLATED_API_KEY at all", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = spawnSync(process.execPath, [CLI_PATH, TOPIC_PACKAGE_FIXTURE, ledgerPath], {
      encoding: "utf-8",
      env: { ...process.env, TEMPLATED_API_KEY: undefined },
    });
    assert.equal(result.status, 0, result.stderr);
  });
});

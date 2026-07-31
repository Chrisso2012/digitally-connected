import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "ledger.mjs");

function runCli(...args) {
  // No TEMPLATED_API_KEY, no network — proves the ledger CLI has no
  // dependency on either, unlike the renderer/build-carousel CLIs.
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, TEMPLATED_API_KEY: undefined },
  });
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-ledger-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRecordFieldsFile(dir, fields) {
  const filePath = path.join(dir, "record.json");
  writeFileSync(filePath, JSON.stringify(fields), "utf-8");
  return filePath;
}

test("init creates an empty ledger file", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli("init", ledgerPath);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Ledger created OK/);
  });
});

test("init refuses to overwrite an existing ledger file", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    runCli("init", ledgerPath);
    const second = runCli("init", ledgerPath);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /LedgerFileExistsError/);
  });
});

test("append writes a record and prints a safe summary", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const recordFieldsPath = writeRecordFieldsFile(dir, {
      execution_id: "exec_20260801_9f3a2e1c8b4d",
      sequence: 1,
      event_type: "execution.started",
      status: "started",
    });

    const result = runCli("append", ledgerPath, recordFieldsPath);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Record appended OK/);
    assert.match(result.stdout, /event type:\s*execution\.started/);
    assert.match(result.stdout, /status:\s*started/);
  });
});

test("append rejects a duplicate sequence for the same execution via the CLI", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const first = writeRecordFieldsFile(dir, {
      execution_id: "exec_20260801_9f3a2e1c8b4d",
      sequence: 1,
      event_type: "execution.started",
      status: "started",
    });
    runCli("append", ledgerPath, first);

    const second = writeRecordFieldsFile(dir, {
      execution_id: "exec_20260801_9f3a2e1c8b4d",
      sequence: 1,
      event_type: "topic.loaded",
      status: "succeeded",
    });
    const result = runCli("append", ledgerPath, second);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DuplicateSequenceError/);
  });
});

test("read prints every appended record", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    runCli(
      "append",
      ledgerPath,
      writeRecordFieldsFile(dir, {
        execution_id: "exec_20260801_9f3a2e1c8b4d",
        sequence: 1,
        event_type: "execution.started",
        status: "started",
      })
    );
    runCli(
      "append",
      ledgerPath,
      writeRecordFieldsFile(dir, {
        execution_id: "exec_20260801_9f3a2e1c8b4d",
        sequence: 2,
        event_type: "execution.completed",
        status: "succeeded",
      })
    );

    const result = runCli("read", ledgerPath);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 record\(s\)/);
    assert.match(result.stdout, /execution\.started/);
    assert.match(result.stdout, /execution\.completed/);
  });
});

test("read filters by executionId when given", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    runCli(
      "append",
      ledgerPath,
      writeRecordFieldsFile(dir, { execution_id: "exec_20260801_aaaaaaaaaaaa", sequence: 1, event_type: "execution.started", status: "started" })
    );
    runCli(
      "append",
      ledgerPath,
      writeRecordFieldsFile(dir, { execution_id: "exec_20260801_bbbbbbbbbbbb", sequence: 1, event_type: "execution.started", status: "started" })
    );

    const result = runCli("read", ledgerPath, "exec_20260801_aaaaaaaaaaaa");
    assert.match(result.stdout, /1 record\(s\)/);
  });
});

test("reconstruct prints an ordered summary for one execution", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const executionId = "exec_20260801_9f3a2e1c8b4d";
    runCli("append", ledgerPath, writeRecordFieldsFile(dir, { execution_id: executionId, sequence: 1, event_type: "execution.started", status: "started" }));
    runCli("append", ledgerPath, writeRecordFieldsFile(dir, { execution_id: executionId, sequence: 2, event_type: "topic.loaded", status: "succeeded" }));
    runCli("append", ledgerPath, writeRecordFieldsFile(dir, { execution_id: executionId, sequence: 3, event_type: "execution.completed", status: "succeeded" }));

    const result = runCli("reconstruct", ledgerPath, executionId);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Execution reconstructed OK/);
    assert.match(result.stdout, /record count:\s*3/);
    assert.match(result.stdout, /final status:\s*succeeded/);
  });
});

test("reconstruct fails cleanly for an unknown executionId", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    runCli("init", ledgerPath);
    const result = runCli("reconstruct", ledgerPath, "exec_does_not_exist");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ExecutionNotFoundError/);
  });
});

test("append fails cleanly for malformed JSON in the record fields file", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const recordFieldsPath = path.join(dir, "record.json");
    writeFileSync(recordFieldsPath, "{ not valid json", "utf-8");

    const result = runCli("append", ledgerPath, recordFieldsPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Malformed JSON/);
  });
});

test("append fails cleanly for a schema-invalid record", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const recordFieldsPath = writeRecordFieldsFile(dir, {
      execution_id: "exec_20260801_9f3a2e1c8b4d",
      sequence: 1,
      event_type: "not.a.real.event",
      status: "started",
    });
    const result = runCli("append", ledgerPath, recordFieldsPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ExecutionRecordValidationError/);
  });
});

test("CLI never touches the network — works fine with no TEMPLATED_API_KEY at all", () => {
  withTempDir((dir) => {
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const result = runCli("init", ledgerPath);
    assert.equal(result.status, 0, result.stderr);
  });
});

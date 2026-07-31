import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJsonlLedgerStore } from "../../src/jsonl-ledger-store.mjs";
import { MalformedLedgerLineError } from "../../src/execution-ledger-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-ledger-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readAll on a file that doesn't exist yet returns an empty array, not an error", () => {
  withTempDir((dir) => {
    const store = createJsonlLedgerStore({ filePath: path.join(dir, "ledger.jsonl") });
    assert.deepEqual(store.readAll(), []);
  });
});

test("append then readAll round-trips one record", () => {
  withTempDir((dir) => {
    const store = createJsonlLedgerStore({ filePath: path.join(dir, "ledger.jsonl") });
    const record = { record_id: "rec_1", execution_id: "exec_1", sequence: 1 };
    store.append(record);
    assert.deepEqual(store.readAll(), [record]);
  });
});

test("multiple appends preserve file order", () => {
  withTempDir((dir) => {
    const store = createJsonlLedgerStore({ filePath: path.join(dir, "ledger.jsonl") });
    store.append({ record_id: "rec_1", sequence: 1 });
    store.append({ record_id: "rec_2", sequence: 2 });
    store.append({ record_id: "rec_3", sequence: 3 });

    const records = store.readAll();
    assert.deepEqual(
      records.map((r) => r.record_id),
      ["rec_1", "rec_2", "rec_3"]
    );
  });
});

test("append creates the file if it doesn't already exist", () => {
  withTempDir((dir) => {
    const filePath = path.join(dir, "not-yet-created.jsonl");
    const store = createJsonlLedgerStore({ filePath });
    store.append({ record_id: "rec_1" });
    assert.deepEqual(store.readAll(), [{ record_id: "rec_1" }]);
  });
});

test("a malformed line throws MalformedLedgerLineError naming the file and 1-based line number", () => {
  withTempDir((dir) => {
    const filePath = path.join(dir, "ledger.jsonl");
    writeFileSync(filePath, '{"record_id":"rec_1"}\nnot valid json\n{"record_id":"rec_3"}\n', "utf-8");
    const store = createJsonlLedgerStore({ filePath });

    try {
      store.readAll();
      assert.fail("expected to throw");
    } catch (error) {
      assert.ok(error instanceof MalformedLedgerLineError);
      assert.equal(error.lineNumber, 2);
      assert.equal(error.filePath, filePath);
      // The malformed content itself must never leak into the message.
      assert.doesNotMatch(error.message, /not valid json/);
    }
  });
});

test("blank lines are skipped rather than treated as malformed", () => {
  withTempDir((dir) => {
    const filePath = path.join(dir, "ledger.jsonl");
    writeFileSync(filePath, '{"record_id":"rec_1"}\n\n{"record_id":"rec_2"}\n', "utf-8");
    const store = createJsonlLedgerStore({ filePath });
    assert.equal(store.readAll().length, 2);
  });
});

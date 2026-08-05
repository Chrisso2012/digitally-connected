import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-eng-work-order-adapter-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("write() creates storageDir and persists content readable by read()", () =>
  withTempDir((dir) => {
    const storageDir = path.join(dir, "nested", "work-orders");
    const adapter = createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir });
    adapter.write("wo_test0000000001", '{"work_order_id":"wo_test0000000001"}');
    assert.equal(adapter.read("wo_test0000000001"), '{"work_order_id":"wo_test0000000001"}');
    assert.ok(existsSync(storageDir));
  }));

test("exists() reflects write() and is false otherwise", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: dir });
    assert.equal(adapter.exists("wo_test0000000002"), false);
    adapter.write("wo_test0000000002", "{}");
    assert.equal(adapter.exists("wo_test0000000002"), true);
  }));

test("list() returns [] for a storageDir that does not exist yet", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: path.join(dir, "never-created") });
    assert.deepEqual(adapter.list(), []);
  }));

test("list() returns identifiers with the .json extension stripped, ignoring temp files", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: dir });
    adapter.write("wo_alpha0000000001", "{}");
    adapter.write("wo_beta00000000002", "{}");
    assert.deepEqual(adapter.list().sort(), ["wo_alpha0000000001", "wo_beta00000000002"]);
  }));

test("no leftover temp files remain after a successful write", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: dir });
    adapter.write("wo_test0000000003", "{}");
    assert.deepEqual(adapter.list(), ["wo_test0000000003"]);
  }));

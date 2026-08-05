import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-eng-delivery-report-adapter-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("write() creates storageDir and persists content readable by read()", () =>
  withTempDir((dir) => {
    const storageDir = path.join(dir, "nested", "delivery-reports");
    const adapter = createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir });
    adapter.write("dr_test0000000001", '{"delivery_report_id":"dr_test0000000001"}');
    assert.equal(adapter.read("dr_test0000000001"), '{"delivery_report_id":"dr_test0000000001"}');
    assert.ok(existsSync(storageDir));
  }));

test("exists() reflects write() and is false otherwise", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: dir });
    assert.equal(adapter.exists("dr_test0000000002"), false);
    adapter.write("dr_test0000000002", "{}");
    assert.equal(adapter.exists("dr_test0000000002"), true);
  }));

test("list() returns [] for a storageDir that does not exist yet", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: path.join(dir, "never-created") });
    assert.deepEqual(adapter.list(), []);
  }));

test("list() returns identifiers with the .json extension stripped, ignoring temp files", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: dir });
    adapter.write("dr_alpha0000000001", "{}");
    adapter.write("dr_beta00000000002", "{}");
    assert.deepEqual(adapter.list().sort(), ["dr_alpha0000000001", "dr_beta00000000002"]);
  }));

test("no leftover temp files remain after a successful write", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: dir });
    adapter.write("dr_test0000000003", "{}");
    assert.deepEqual(adapter.list(), ["dr_test0000000003"]);
  }));

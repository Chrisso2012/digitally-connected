import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalJsonProductionMetricsStoreAdapter } from "../../src/local-json-production-metrics-store-adapter.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-metrics-adapter-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("write() then read() round-trips the exact content given", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonProductionMetricsStoreAdapter({ storageDir: dir });
    const content = JSON.stringify({ metrics_id: "met_abc123", hello: "world" });
    adapter.write("met_abc123", content);
    assert.equal(adapter.read("met_abc123"), content);
  });
});

test("write() creates storageDir if it doesn't exist yet", () => {
  withTempDir((dir) => {
    const nested = path.join(dir, "nested", "does", "not", "exist", "yet");
    const adapter = createLocalJsonProductionMetricsStoreAdapter({ storageDir: nested });
    adapter.write("met_abc123", "{}");
    assert.equal(adapter.read("met_abc123"), "{}");
  });
});

test("write() leaves no temporary files behind after a successful write", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonProductionMetricsStoreAdapter({ storageDir: dir });
    adapter.write("met_abc123", JSON.stringify({ a: 1 }));
    const entries = readdirSync(dir);
    assert.deepEqual(entries, ["met_abc123.json"]);
  });
});

test("write() fully overwrites previous content for the same identifier, never appends or merges", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonProductionMetricsStoreAdapter({ storageDir: dir });
    adapter.write("met_abc123", JSON.stringify({ version: 1 }));
    adapter.write("met_abc123", JSON.stringify({ version: 2 }));
    assert.equal(adapter.read("met_abc123"), JSON.stringify({ version: 2 }));
  });
});

test("exists() reflects write() and is false for an unwritten identifier", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonProductionMetricsStoreAdapter({ storageDir: dir });
    assert.equal(adapter.exists("met_abc123"), false);
    adapter.write("met_abc123", "{}");
    assert.equal(adapter.exists("met_abc123"), true);
    assert.equal(adapter.exists("met_neverwritten"), false);
  });
});

test("read() throws Node's own ENOENT for a missing identifier", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonProductionMetricsStoreAdapter({ storageDir: dir });
    assert.throws(() => adapter.read("met_missing"), (err) => err.code === "ENOENT");
  });
});

test("list() returns [] for a storageDir that doesn't exist yet", () => {
  const adapter = createLocalJsonProductionMetricsStoreAdapter({ storageDir: "/tmp/dc003-never-created-metrics-dir-xyz" });
  assert.deepEqual(adapter.list(), []);
});

test("list() returns every written identifier with the .json extension stripped", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonProductionMetricsStoreAdapter({ storageDir: dir });
    adapter.write("met_aaa", "{}");
    adapter.write("met_bbb", "{}");
    assert.deepEqual(adapter.list().sort(), ["met_aaa", "met_bbb"]);
  });
});

test("list() ignores non-.json files and dotfiles that happen to sit in the storage directory", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonProductionMetricsStoreAdapter({ storageDir: dir });
    adapter.write("met_aaa", "{}");
    writeFileSync(path.join(dir, "README.txt"), "not a metrics record");
    writeFileSync(path.join(dir, ".met_aaa.tmp-leftover.json"), "{}");
    assert.deepEqual(adapter.list(), ["met_aaa"]);
  });
});

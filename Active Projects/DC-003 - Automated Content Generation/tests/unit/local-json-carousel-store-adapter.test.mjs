import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-carousel-adapter-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("write() then read() round-trips the exact content given", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: dir });
    const content = JSON.stringify({ carousel_id: "car_abc123", hello: "world" });
    adapter.write("car_abc123", content);
    assert.equal(adapter.read("car_abc123"), content);
  });
});

test("write() creates storageDir if it doesn't exist yet", () => {
  withTempDir((dir) => {
    const nested = path.join(dir, "nested", "does", "not", "exist", "yet");
    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: nested });
    adapter.write("car_abc123", "{}");
    assert.equal(adapter.read("car_abc123"), "{}");
  });
});

test("write() leaves no temporary files behind after a successful write", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: dir });
    adapter.write("car_abc123", JSON.stringify({ a: 1 }));
    const entries = readdirSync(dir);
    assert.deepEqual(entries, ["car_abc123.json"]);
  });
});

test("write() fully overwrites previous content for the same identifier, never appends or merges", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: dir });
    adapter.write("car_abc123", JSON.stringify({ version: 1 }));
    adapter.write("car_abc123", JSON.stringify({ version: 2 }));
    assert.equal(adapter.read("car_abc123"), JSON.stringify({ version: 2 }));
  });
});

test("exists() reflects write() and is false for an unwritten identifier", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: dir });
    assert.equal(adapter.exists("car_abc123"), false);
    adapter.write("car_abc123", "{}");
    assert.equal(adapter.exists("car_abc123"), true);
    assert.equal(adapter.exists("car_neverwritten"), false);
  });
});

test("read() throws Node's own ENOENT for a missing identifier", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: dir });
    assert.throws(() => adapter.read("car_missing"), (err) => err.code === "ENOENT");
  });
});

test("list() returns [] for a storageDir that doesn't exist yet", () => {
  const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: "/tmp/dc003-never-created-dir-xyz" });
  assert.deepEqual(adapter.list(), []);
});

test("list() returns every written identifier with the .json extension stripped", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: dir });
    adapter.write("car_aaa", "{}");
    adapter.write("car_bbb", "{}");
    assert.deepEqual(adapter.list().sort(), ["car_aaa", "car_bbb"]);
  });
});

test("list() ignores non-.json files and dotfiles that happen to sit in the storage directory", () => {
  withTempDir((dir) => {
    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: dir });
    adapter.write("car_aaa", "{}");
    // Simulate stray files that should never be treated as stored carousels
    // — e.g. a leftover temp file from an interrupted write, or an
    // unrelated file someone dropped in the storage directory.
    writeFileSync(path.join(dir, "README.txt"), "not a carousel");
    writeFileSync(path.join(dir, ".car_aaa.tmp-leftover.json"), "{}");
    assert.deepEqual(adapter.list(), ["car_aaa"]);
  });
});

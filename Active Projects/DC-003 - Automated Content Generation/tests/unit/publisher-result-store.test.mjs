import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createPublisherResult } from "../../src/publisher-result.mjs";
import {
  InvalidPublisherResultStoreAdapterError,
  InvalidPublisherResultIdentifierError,
  PublisherResultAlreadyExistsError,
  PublisherResultNotFoundError,
  CorruptedPublisherResultError,
} from "../../src/publisher-result-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-publisher-result-store-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir }) });
}

function resultFields(overrides = {}) {
  return {
    carouselId: "car_storetest0001",
    assetPackageId: "pkg_storetest0001",
    executionId: "exec_20260804_deadbeefcafe",
    provider: "google-drive",
    destination: "https://drive.google.com/drive/folders/storetest",
    providerReference: "folder_storetest",
    metadata: { files_uploaded: 7 },
    ...overrides,
  };
}

function buildResult(overrides = {}) {
  return createPublisherResult(resultFields(overrides), { idGenerator: overrides.idGenerator, now: overrides.now });
}

// --- Adapter validation --------------------------------------------------

test("throws InvalidPublisherResultStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createPublisherResultStore({ adapter: { name: "x" } }), InvalidPublisherResultStoreAdapterError);
  assert.throws(() => createPublisherResultStore({ adapter: null }), InvalidPublisherResultStoreAdapterError);
});

// --- save() ----------------------------------------------------------

test("save() persists a valid result and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const result = buildResult();
    const saved = store.save(result);
    assert.equal(saved.publisher_result_id, result.publisher_result_id);
    assert.throws(() => {
      saved.status = "failed";
    }, TypeError);
  }));

test("save() does not mutate the supplied object", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const result = buildResult();
    const before = JSON.stringify(result);
    store.save(result);
    assert.equal(JSON.stringify(result), before);
  }));

test("save() rejects a second save for the same publisher_result_id — never overwrites", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "pub_duplicatetest0001";
    const first = createPublisherResult(resultFields(), { idGenerator: idGen });
    store.save(first);
    const second = createPublisherResult(resultFields(), { idGenerator: idGen });
    assert.throws(() => store.save(second), PublisherResultAlreadyExistsError);
  }));

test("save() allows a genuinely different publisher_result_id for the same carousel_id — a re-publish, not a duplicate", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const first = createPublisherResult(resultFields(), { idGenerator: () => "pub_first0000000001" });
    const second = createPublisherResult(resultFields(), { idGenerator: () => "pub_second000000002" });
    store.save(first);
    assert.doesNotThrow(() => store.save(second));
    assert.equal(store.list().length, 2);
  }));

test("save() rejects a schema-invalid result", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.throws(() => store.save({ publisher_result_id: "pub_invalid", not: "a valid result" }), CorruptedPublisherResultError);
  }));

// --- get() -------------------------------------------------------------

test("get() retrieves a stored result, parsed, validated, and immutable", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const result = buildResult();
    store.save(result);
    const fetched = store.get(result.publisher_result_id);
    assert.equal(fetched.publisher_result_id, result.publisher_result_id);
    assert.throws(() => {
      fetched.status = "failed";
    }, TypeError);
  }));

test("get() throws PublisherResultNotFoundError for an identifier with no stored record", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.throws(() => store.get("pub_doesnotexist0001"), PublisherResultNotFoundError);
  }));

test("get() throws InvalidPublisherResultIdentifierError for a path-traversal identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.throws(() => store.get("../../etc/passwd"), InvalidPublisherResultIdentifierError);
  }));

// --- exists() ----------------------------------------------------------

test("exists() reflects save() and is false for an unknown identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const result = buildResult();
    assert.equal(store.exists(result.publisher_result_id), false);
    store.save(result);
    assert.equal(store.exists(result.publisher_result_id), true);
  }));

// --- list() ------------------------------------------------------------

test("list() returns an empty array for an empty store", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.deepEqual(store.list(), []);
  }));

test("list() returns safe summaries ordered deterministically by publisher_result_id ascending", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const a = createPublisherResult(resultFields(), { idGenerator: () => "pub_bbbb" });
    const b = createPublisherResult(resultFields(), { idGenerator: () => "pub_aaaa" });
    store.save(a);
    store.save(b);
    const summaries = store.list();
    assert.deepEqual(
      summaries.map((s) => s.publisher_result_id),
      ["pub_aaaa", "pub_bbbb"]
    );
    assert.deepEqual(
      Object.keys(summaries[0]).sort(),
      ["publisher_result_id", "carousel_id", "execution_id", "asset_package_id", "provider", "destination", "published_at"].sort()
    );
  }));

test("list() throws CorruptedPublisherResultError naming the specific identifier that is corrupted", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonPublisherResultStoreAdapter({ storageDir: dir });
    adapter.write("pub_corrupted0001", "{ not valid json");
    const store = createPublisherResultStore({ adapter });
    assert.throws(() => store.list(), (error) => {
      assert.ok(error instanceof CorruptedPublisherResultError);
      assert.equal(error.identifier, "pub_corrupted0001");
      return true;
    });
  }));

test("list() returns a deep-frozen array", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildResult());
    const summaries = store.list();
    assert.throws(() => summaries.push({}), TypeError);
  }));

// --- findByCarousel() ----------------------------------------------------

test("findByCarousel() returns every full result matching the given carousel_id, ordered by published_at ascending", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const first = createPublisherResult(resultFields({ carouselId: "car_target0000001" }), { idGenerator: () => "pub_first0000000001", now: () => "2026-08-01T00:00:00.000Z" });
    const second = createPublisherResult(resultFields({ carouselId: "car_target0000001" }), { idGenerator: () => "pub_second000000002", now: () => "2026-08-02T00:00:00.000Z" });
    const nonMatch = createPublisherResult(resultFields({ carouselId: "car_other00000002" }), { idGenerator: () => "pub_nomatch0000001" });
    store.save(second); // saved out of order — result must still come back sorted
    store.save(first);
    store.save(nonMatch);

    const results = store.findByCarousel("car_target0000001");
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((r) => r.publisher_result_id),
      ["pub_first0000000001", "pub_second000000002"]
    );
  }));

test("findByCarousel() returns an empty array, not an error, when nothing matches", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildResult());
    assert.deepEqual(store.findByCarousel("car_nomatch0000001"), []);
  }));

test("findByCarousel() returns full, deep-frozen records, not summaries", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const result = buildResult();
    store.save(result);
    const [found] = store.findByCarousel(result.carousel_id);
    assert.equal(found.provider, "google-drive");
    assert.throws(() => {
      found.status = "failed";
    }, TypeError);
  }));

// --- findByExecution() ----------------------------------------------------

test("findByExecution() returns every full result matching the given execution_id", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const match = createPublisherResult(resultFields({ executionId: "exec_20260804_target00001" }), { idGenerator: () => "pub_match00000001" });
    const nonMatch = createPublisherResult(resultFields({ executionId: "exec_20260804_other000001" }), { idGenerator: () => "pub_nomatch0000001" });
    store.save(match);
    store.save(nonMatch);

    const results = store.findByExecution("exec_20260804_target00001");
    assert.equal(results.length, 1);
    assert.equal(results[0].publisher_result_id, "pub_match00000001");
  }));

test("findByExecution() returns an empty array, not an error, when nothing matches", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildResult());
    assert.deepEqual(store.findByExecution("exec_20260804_nomatch0001"), []);
  }));

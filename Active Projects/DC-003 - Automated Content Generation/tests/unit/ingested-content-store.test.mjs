import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createIngestedContentStore } from "../../src/ingested-content-store.mjs";
import { createLocalJsonIngestedContentStoreAdapter } from "../../src/local-json-ingested-content-store-adapter.mjs";
import { createIngestedContent } from "../../src/ingested-content.mjs";
import {
  InvalidIngestedContentStoreAdapterError,
  InvalidIngestedContentIdentifierError,
  IngestedContentAlreadyExistsError,
  IngestedContentNotFoundError,
} from "../../src/ingested-content-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-ingested-content-store-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createIngestedContentStore({ adapter: createLocalJsonIngestedContentStoreAdapter({ storageDir }) });
}

function buildRecord(overrides = {}, options = {}) {
  return createIngestedContent(
    {
      sourceType: "google_docs",
      sourceReference: "doc-ref-1",
      sourceFingerprint: createHash("sha256").update(overrides.fullArticleText ?? "body").digest("hex"),
      title: "Test Article",
      fullArticleText: "body",
      ...overrides,
    },
    options
  );
}

test("throws InvalidIngestedContentStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createIngestedContentStore({ adapter: { name: "x" } }), InvalidIngestedContentStoreAdapterError);
});

test("save() persists a valid record and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const record = buildRecord({}, { idGenerator: () => "ic_savetest00000001" });
    const saved = store.save(record);
    assert.equal(saved.ingested_content_id, "ic_savetest00000001");
    assert.throws(() => {
      saved.title = "changed";
    }, TypeError);
  }));

test("save() rejects a second save for the same ingested_content_id", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "ic_duplicatetest001";
    store.save(buildRecord({}, { idGenerator: idGen }));
    assert.throws(() => store.save(buildRecord({}, { idGenerator: idGen })), IngestedContentAlreadyExistsError);
  }));

test("get() retrieves a stored record; throws for missing/invalid identifiers", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ title: "Findable" }, { idGenerator: () => "ic_gettest000000001" }));
    assert.equal(store.get("ic_gettest000000001").title, "Findable");
    assert.throws(() => store.get("ic_doesnotexist00001"), IngestedContentNotFoundError);
    assert.throws(() => store.get("../../etc/passwd"), InvalidIngestedContentIdentifierError);
  }));

test("exists() reflects save() and is false for an unknown identifier", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.equal(store.exists("ic_existstest0000001"), false);
    store.save(buildRecord({}, { idGenerator: () => "ic_existstest0000001" }));
    assert.equal(store.exists("ic_existstest0000001"), true);
  }));

test("list() returns safe summaries ordered chronologically by created_at", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildRecord({ title: "Second" }, { idGenerator: () => "ic_second0000000001", now: () => "2026-08-07T11:00:00.000Z" }));
    store.save(buildRecord({ title: "First" }, { idGenerator: () => "ic_first00000000001", now: () => "2026-08-07T10:00:00.000Z" }));
    const summaries = store.list();
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].title, "First");
    assert.equal(summaries[1].title, "Second");
    assert.equal(summaries[0].full_article_text, undefined);
  }));

test("findBySourceReference() returns only matching full records, ordered chronologically", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(
      buildRecord({ sourceReference: "doc-a", fullArticleText: "version one" }, { idGenerator: () => "ic_docav1000000001", now: () => "2026-08-07T10:00:00.000Z" })
    );
    store.save(
      buildRecord({ sourceReference: "doc-a", fullArticleText: "version two" }, { idGenerator: () => "ic_docav2000000001", now: () => "2026-08-07T11:00:00.000Z" })
    );
    store.save(buildRecord({ sourceReference: "doc-b" }, { idGenerator: () => "ic_docb0000000001" }));

    const matches = store.findBySourceReference("doc-a");
    assert.equal(matches.length, 2);
    assert.equal(matches[0].full_article_text, "version one");
    assert.equal(matches[1].full_article_text, "version two");
    assert.equal(store.findBySourceReference("doc-c").length, 0);
  }));

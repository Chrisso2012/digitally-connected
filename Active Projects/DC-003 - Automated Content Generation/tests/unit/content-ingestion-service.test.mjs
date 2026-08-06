import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ingestContent, DEFAULT_MIN_WORD_COUNT } from "../../src/content-ingestion-service.mjs";
import { createContentSourceMockAdapter } from "../../src/content-source-mock-adapter.mjs";
import { createIngestedContentStore } from "../../src/ingested-content-store.mjs";
import { createLocalJsonIngestedContentStoreAdapter } from "../../src/local-json-ingested-content-store-adapter.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { ArticleTooShortError, DuplicateIngestionError } from "../../src/content-ingestion-errors.mjs";
import { ContentSourceNotFoundError } from "../../src/content-source-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-content-ingestion-service-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(dir) {
  return createIngestedContentStore({ adapter: createLocalJsonIngestedContentStoreAdapter({ storageDir: dir }) });
}

const LONG_BODY = Array(250).fill("word").join(" ");
const SHORT_BODY = "too short for ingestion";

test("ingestContent() ingests, persists, and returns an immutable Ingested Content record", () =>
  withTempDir(async (dir) => {
    const store = buildStore(dir);
    const adapter = createContentSourceMockAdapter({ fixtures: { "doc-1": { title: "Long Article", body: LONG_BODY } } });

    const record = await ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { adapter, store });

    assert.equal(record.title, "Long Article");
    assert.equal(record.source_type, "google_docs");
    assert.equal(record.source_reference, "doc-1");
    assert.equal(record.word_count, 250);
    assert.equal(store.get(record.ingested_content_id).ingested_content_id, record.ingested_content_id);
    assert.throws(() => {
      record.title = "changed";
    }, TypeError);
  }));

test("ingestContent() rejects an article below the minimum word count", () =>
  withTempDir(async (dir) => {
    const store = buildStore(dir);
    const adapter = createContentSourceMockAdapter({ fixtures: { "doc-1": { title: "Short", body: SHORT_BODY } } });
    await assert.rejects(() => ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { adapter, store }), ArticleTooShortError);
  }));

test("ingestContent() respects an overridden minWordCount", () =>
  withTempDir(async (dir) => {
    const store = buildStore(dir);
    const adapter = createContentSourceMockAdapter({ fixtures: { "doc-1": { title: "Short", body: SHORT_BODY } } });
    const record = await ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { adapter, store, minWordCount: 3 });
    assert.equal(record.title, "Short");
  }));

test("ingestContent() rejects a duplicate ingestion when the source is unchanged since a prior ingestion", () =>
  withTempDir(async (dir) => {
    const store = buildStore(dir);
    const adapter = createContentSourceMockAdapter({ fixtures: { "doc-1": { title: "Long Article", body: LONG_BODY } } });

    await ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { adapter, store });
    await assert.rejects(() => ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { adapter, store }), DuplicateIngestionError);
  }));

test("ingestContent() allows a new ingestion when the source content has changed since a prior ingestion", () =>
  withTempDir(async (dir) => {
    const store = buildStore(dir);
    const firstAdapter = createContentSourceMockAdapter({ fixtures: { "doc-1": { title: "V1", body: LONG_BODY } } });
    await ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { adapter: firstAdapter, store });

    const changedBody = LONG_BODY + " extra-word-marking-a-real-change";
    const secondAdapter = createContentSourceMockAdapter({ fixtures: { "doc-1": { title: "V2", body: changedBody } } });
    const second = await ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { adapter: secondAdapter, store });

    assert.equal(second.title, "V2");
    assert.equal(store.findBySourceReference("doc-1").length, 2);
  }));

test("ingestContent() propagates the adapter's own typed error for a not-found source", () =>
  withTempDir(async (dir) => {
    const store = buildStore(dir);
    const adapter = createContentSourceMockAdapter({ mode: "not-found" });
    await assert.rejects(() => ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { adapter, store }), ContentSourceNotFoundError);
  }));

test("ingestContent() throws PipelineConfigurationError for missing dependencies.adapter", () =>
  withTempDir(async (dir) => {
    const store = buildStore(dir);
    await assert.rejects(() => ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { store }), PipelineConfigurationError);
  }));

test("ingestContent() throws PipelineConfigurationError for missing dependencies.store", async () => {
  const adapter = createContentSourceMockAdapter();
  await assert.rejects(() => ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { adapter }), PipelineConfigurationError);
});

test("ingestContent() throws PipelineConfigurationError for a missing/empty sourceReference", () =>
  withTempDir(async (dir) => {
    const store = buildStore(dir);
    const adapter = createContentSourceMockAdapter();
    await assert.rejects(() => ingestContent({ sourceType: "google_docs", sourceReference: "" }, { adapter, store }), PipelineConfigurationError);
  }));

test("DEFAULT_MIN_WORD_COUNT is exported and used when minWordCount is not overridden", () =>
  withTempDir(async (dir) => {
    const store = buildStore(dir);
    const justUnderBody = Array(DEFAULT_MIN_WORD_COUNT - 1).fill("word").join(" ");
    const adapter = createContentSourceMockAdapter({ fixtures: { "doc-1": { title: "T", body: justUnderBody } } });
    await assert.rejects(() => ingestContent({ sourceType: "google_docs", sourceReference: "doc-1" }, { adapter, store }), ArticleTooShortError);
  }));

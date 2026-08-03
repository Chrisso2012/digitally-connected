import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveContentAsset } from "../../src/content-asset-resolver.mjs";
import { UnknownSourceReferenceError, SourceResolutionError } from "../../src/content-request-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_CONTENT_ASSETS_DIR = path.join(__dirname, "..", "..", "content-assets");

function baseTopicPackage(overrides = {}) {
  return {
    topic_id: "topic_01J9RESOLVE01",
    working_title: "A resolvable topic",
    audience: "Owner-operators",
    primary_goal: "Book a call",
    funnel_stage: "consideration",
    core_message: "Core message",
    supporting_points: ["Point one", "Point two"],
    cta: "Book now",
    keywords: [],
    brand_voice: "confident-direct",
    status: "approved",
    created_date: "2026-08-01T00:00:00Z",
    updated_date: "2026-08-01T00:00:00Z",
    version: 1,
    schema_version: "1.0",
    source: "backlog",
    backlog_reference_id: null,
    content_pillar: null,
    tags: [],
    priority: null,
    related_topic_ids: [],
    locale: "en",
    owner: "chris@digitallyconnected.net",
    notes: null,
    ...overrides,
  };
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-content-asset-resolver-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeAsset(dir, assetId, overrides = {}) {
  const asset = {
    asset_id: assetId,
    title: "Test",
    summary: "Test summary",
    topic_package: baseTopicPackage({ backlog_reference_id: assetId }),
    status: "approved",
    created_at: "2026-08-01T00:00:00Z",
    metadata: null,
    ...overrides,
  };
  writeFileSync(path.join(dir, `${assetId}.json`), JSON.stringify(asset), "utf-8");
}

test("resolves an existing asset's embedded topic_package, matching I016's original resolveSource() return contract", () => {
  withTempDir((dir) => {
    writeAsset(dir, "GS01");
    const topicPackage = resolveContentAsset({ sourceType: "article", sourceReference: "GS01" }, { contentAssetsDir: dir });
    assert.equal(topicPackage.topic_id, "topic_01J9RESOLVE01");
    assert.equal(topicPackage.backlog_reference_id, "GS01");
    assert.ok(Object.isFrozen(topicPackage));
  });
});

test("throws UnknownSourceReferenceError (I016's original error type, unchanged) when no asset exists for the reference", () => {
  withTempDir((dir) => {
    assert.throws(
      () => resolveContentAsset({ sourceType: "article", sourceReference: "DOES_NOT_EXIST" }, { contentAssetsDir: dir }),
      UnknownSourceReferenceError
    );
  });
});

test("throws SourceResolutionError for an unsupported sourceType", () => {
  withTempDir((dir) => {
    writeAsset(dir, "GS01");
    assert.throws(
      () => resolveContentAsset({ sourceType: "video", sourceReference: "GS01" }, { contentAssetsDir: dir }),
      SourceResolutionError
    );
  });
});

test("throws SourceResolutionError when no contentAssetsDir is configured", () => {
  assert.throws(() => resolveContentAsset({ sourceType: "article", sourceReference: "GS01" }, {}), SourceResolutionError);
});

test("throws SourceResolutionError (not UnknownSourceReferenceError) when the repository itself fails, e.g. a corrupted asset", () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, "GS01.json"), "not valid json", "utf-8");
    assert.throws(
      () => resolveContentAsset({ sourceType: "article", sourceReference: "GS01" }, { contentAssetsDir: dir }),
      SourceResolutionError
    );
  });
});

test("throws SourceResolutionError for a malformed sourceReference (path traversal), never touching the filesystem outside the repository", () => {
  withTempDir((dir) => {
    assert.throws(
      () => resolveContentAsset({ sourceType: "article", sourceReference: "../../etc/passwd" }, { contentAssetsDir: dir }),
      SourceResolutionError
    );
  });
});

test("resolves the real, repository-owned GS01.json shipped with DC-003-I018 — not a test fixture", () => {
  const topicPackage = resolveContentAsset({ sourceType: "article", sourceReference: "GS01" }, { contentAssetsDir: REAL_CONTENT_ASSETS_DIR });
  assert.equal(topicPackage.backlog_reference_id, "GS01");
  assert.equal(topicPackage.status, "approved");
});

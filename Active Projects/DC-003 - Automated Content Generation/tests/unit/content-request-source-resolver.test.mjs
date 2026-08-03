import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveSource } from "../../src/content-request-source-resolver.mjs";
import { UnknownSourceReferenceError, SourceResolutionError } from "../../src/content-request-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_TOPIC_PACKAGES_DIR = path.join(__dirname, "..", "fixtures", "topic-packages");

function baseTopicPackage(overrides = {}) {
  return {
    topic_id: "topic_01J9RESOLVER1",
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
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-source-resolver-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeTopicPackage(dir, filename, overrides = {}) {
  writeFileSync(path.join(dir, filename), JSON.stringify(baseTopicPackage(overrides)), "utf-8");
}

test("resolves a matching approved Topic Package by backlog_reference_id", () => {
  withTempDir((dir) => {
    writeTopicPackage(dir, "match.json", { topic_id: "topic_match0001", backlog_reference_id: "GS01" });
    writeTopicPackage(dir, "unrelated.json", { topic_id: "topic_other0001", backlog_reference_id: "OTHER99" });

    const resolved = resolveSource({ sourceType: "article", sourceReference: "GS01" }, { topicPackagesDir: dir });
    assert.equal(resolved.topic_id, "topic_match0001");
    assert.equal(resolved.backlog_reference_id, "GS01");
  });
});

test("throws UnknownSourceReferenceError when nothing matches", () => {
  withTempDir((dir) => {
    writeTopicPackage(dir, "unrelated.json", { backlog_reference_id: "OTHER99" });
    assert.throws(
      () => resolveSource({ sourceType: "article", sourceReference: "GS01" }, { topicPackagesDir: dir }),
      UnknownSourceReferenceError
    );
  });
});

test("throws UnknownSourceReferenceError for an empty source directory", () => {
  withTempDir((dir) => {
    assert.throws(
      () => resolveSource({ sourceType: "article", sourceReference: "GS01" }, { topicPackagesDir: dir }),
      UnknownSourceReferenceError
    );
  });
});

test("silently skips files that fail to load, validate, or pass readiness — does not error over an unrelated bad file", () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, "malformed.json"), "{ not valid json", "utf-8");
    writeTopicPackage(dir, "draft.json", { backlog_reference_id: "GS01", status: "draft" }); // fails readiness, not schema
    writeTopicPackage(dir, "match.json", { topic_id: "topic_theone0001", backlog_reference_id: "GS01" });

    const resolved = resolveSource({ sourceType: "article", sourceReference: "GS01" }, { topicPackagesDir: dir });
    assert.equal(resolved.topic_id, "topic_theone0001");
  });
});

test("throws SourceResolutionError when more than one approved Topic Package shares the same reference — refuses to guess", () => {
  withTempDir((dir) => {
    writeTopicPackage(dir, "a.json", { topic_id: "topic_dupe0000a", backlog_reference_id: "GS01" });
    writeTopicPackage(dir, "b.json", { topic_id: "topic_dupe0000b", backlog_reference_id: "GS01" });

    assert.throws(
      () => resolveSource({ sourceType: "article", sourceReference: "GS01" }, { topicPackagesDir: dir }),
      SourceResolutionError
    );
  });
});

test("throws SourceResolutionError for an unsupported sourceType", () => {
  withTempDir((dir) => {
    writeTopicPackage(dir, "match.json", { backlog_reference_id: "GS01" });
    assert.throws(
      () => resolveSource({ sourceType: "video", sourceReference: "GS01" }, { topicPackagesDir: dir }),
      SourceResolutionError
    );
  });
});

test("throws SourceResolutionError when no topicPackagesDir is configured", () => {
  assert.throws(() => resolveSource({ sourceType: "article", sourceReference: "GS01" }, {}), SourceResolutionError);
});

test("throws SourceResolutionError for an unreadable source directory", () => {
  assert.throws(
    () => resolveSource({ sourceType: "article", sourceReference: "GS01" }, { topicPackagesDir: "/definitely/does/not/exist/anywhere" }),
    SourceResolutionError
  );
});

test("resolves the real GS01 fixture shipped for DC-003-I016 against the repository's own fixture directory", () => {
  const resolved = resolveSource({ sourceType: "article", sourceReference: "GS01" }, { topicPackagesDir: REAL_TOPIC_PACKAGES_DIR });
  assert.equal(resolved.backlog_reference_id, "GS01");
  assert.equal(resolved.status, "approved");
});

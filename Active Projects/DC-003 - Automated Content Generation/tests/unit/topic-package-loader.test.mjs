import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadTopicPackage, prepareTopicPackage } from "../../src/topic-package-loader.mjs";
import {
  TopicPackageNotFoundError,
  TopicPackageUnreadableError,
  TopicPackageParseError,
  TopicPackageValidationError,
  TopicPackageReadinessError,
} from "../../src/topic-package-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const TOPIC_PACKAGES_DIR = path.join(FIXTURES_DIR, "topic-packages");

function fixturePath(...segments) {
  return path.join(TOPIC_PACKAGES_DIR, ...segments);
}

// --- Successful loading -----------------------------------------------

test("loads a valid approved Topic Package from an absolute path", () => {
  const absPath = fixturePath("approved.valid.json");
  assert.ok(path.isAbsolute(absPath));
  const topic = loadTopicPackage(absPath);
  assert.equal(topic.topic_id, "topic_01J9Y1B2C3");
  assert.equal(topic.status, "approved");
});

test("loads a valid approved Topic Package from a relative path", () => {
  const absPath = fixturePath("approved.valid.json");
  const relativePath = path.relative(process.cwd(), absPath);
  const topic = loadTopicPackage(relativePath);
  assert.equal(topic.topic_id, "topic_01J9Y1B2C3");
});

test("prepareTopicPackage accepts an already-parsed in-memory object", () => {
  const raw = JSON.parse(readFileSync(fixturePath("approved.valid.json"), "utf-8"));
  const topic = prepareTopicPackage(raw);
  assert.equal(topic.topic_id, raw.topic_id);
});

test("returned object preserves every field from the source", () => {
  const raw = JSON.parse(readFileSync(fixturePath("approved.valid.json"), "utf-8"));
  const topic = prepareTopicPackage(structuredClone(raw));
  assert.deepEqual({ ...topic }, raw);
});

test("returned object cannot be mutated", () => {
  const topic = loadTopicPackage(fixturePath("approved.valid.json"));
  assert.throws(() => {
    topic.working_title = "tampered";
  }, TypeError);
  assert.throws(() => {
    topic.supporting_points.push("tampered");
  }, TypeError);
  assert.throws(() => {
    delete topic.status;
  }, TypeError);
  // value is unchanged regardless
  assert.equal(topic.status, "approved");
});

test("loading does not mutate the original file's parsed contents", () => {
  const raw = JSON.parse(readFileSync(fixturePath("approved.valid.json"), "utf-8"));
  const rawSnapshot = structuredClone(raw);
  prepareTopicPackage(raw);
  assert.deepEqual(raw, rawSnapshot, "prepareTopicPackage must not mutate its input");
});

// --- File / parsing failures -------------------------------------------

test("throws TopicPackageNotFoundError for a missing file", () => {
  assert.throws(
    () => loadTopicPackage(fixturePath("does-not-exist.json")),
    TopicPackageNotFoundError
  );
});

test("throws TopicPackageParseError for malformed JSON", () => {
  assert.throws(
    () => loadTopicPackage(fixturePath("malformed.json")),
    TopicPackageParseError
  );
});

test("throws TopicPackageUnreadableError when given a directory instead of a file", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "dc003-topic-dir-"));
  try {
    mkdirSync(path.join(tmp, "looks-like-a-topic.json"));
    assert.throws(
      () => loadTopicPackage(path.join(tmp, "looks-like-a-topic.json")),
      TopicPackageUnreadableError
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Schema validation failures -----------------------------------------

test("schema-invalid Topic Package is rejected with structured, multiple errors", () => {
  const invalidPath = path.join(FIXTURES_DIR, "invalid", "topic-package.invalid.json");
  try {
    loadTopicPackage(invalidPath);
    assert.fail("expected loadTopicPackage to throw");
  } catch (error) {
    assert.ok(error instanceof TopicPackageValidationError);
    assert.ok(error.errors.length > 1, "expected multiple schema errors to be reported");
    assert.equal(error.filePath, path.resolve(invalidPath));
    for (const e of error.errors) {
      assert.equal(typeof e.path, "string");
      assert.equal(typeof e.message, "string");
    }
  }
});

// --- Operational readiness failures --------------------------------------

test("draft Topic Package is rejected by readiness, not schema, validation", () => {
  try {
    loadTopicPackage(fixturePath("draft.not-ready.json"));
    assert.fail("expected loadTopicPackage to throw");
  } catch (error) {
    assert.ok(error instanceof TopicPackageReadinessError);
    assert.ok(error.issues.some((i) => i.check === "approval-state"));
  }
});

test("schema_version incompatible with config/versions.json is rejected", () => {
  try {
    loadTopicPackage(fixturePath("version-incompatible.json"));
    assert.fail("expected loadTopicPackage to throw");
  } catch (error) {
    assert.ok(error instanceof TopicPackageReadinessError);
    assert.ok(error.issues.some((i) => i.check === "schema-version-compatible"));
  }
});

test("whitespace-only operational content is rejected even though schema-valid", () => {
  try {
    loadTopicPackage(fixturePath("whitespace-content.json"));
    assert.fail("expected loadTopicPackage to throw");
  } catch (error) {
    assert.ok(error instanceof TopicPackageReadinessError);
    assert.ok(error.issues.some((i) => i.check === "usable-content"));
  }
});

test("updated_date earlier than created_date is rejected as internally inconsistent", () => {
  try {
    loadTopicPackage(fixturePath("inconsistent-timestamps.json"));
    assert.fail("expected loadTopicPackage to throw");
  } catch (error) {
    assert.ok(error instanceof TopicPackageReadinessError);
    assert.ok(error.issues.some((i) => i.check === "timestamp-sequence"));
  }
});

test("readiness errors expose file path, checks, and readable messages — never a bare message", () => {
  try {
    loadTopicPackage(fixturePath("draft.not-ready.json"));
    assert.fail("expected loadTopicPackage to throw");
  } catch (error) {
    assert.equal(error.filePath, path.resolve(fixturePath("draft.not-ready.json")));
    assert.notEqual(error.message.trim(), "");
    for (const issue of error.issues) {
      assert.equal(typeof issue.check, "string");
      assert.equal(typeof issue.message, "string");
      assert.notEqual(issue.message.trim(), "");
    }
  }
});

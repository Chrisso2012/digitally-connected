import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createIngestedContent } from "../../src/ingested-content.mjs";
import { InvalidIngestedContentInputError, IngestedContentValidationError } from "../../src/ingested-content-errors.mjs";

const VALID_FINGERPRINT = createHash("sha256").update("some body text").digest("hex");

function buildFields(overrides = {}) {
  return {
    sourceType: "google_docs",
    sourceReference: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
    sourceFingerprint: VALID_FINGERPRINT,
    title: "Test Article",
    fullArticleText: "This is a test article body with several words in it for word counting purposes today.",
    ...overrides,
  };
}

test("createIngestedContent() builds a valid, immutable record with computed word_count and checksum", () => {
  const record = createIngestedContent(buildFields(), { idGenerator: () => "ic_test0000000001", now: () => "2026-08-07T10:00:00.000Z" });
  assert.equal(record.ingested_content_id, "ic_test0000000001");
  assert.equal(record.source_type, "google_docs");
  assert.equal(record.status, "ingested");
  assert.equal(record.approval_state, "pending");
  assert.equal(record.word_count, 16);
  assert.equal(record.created_at, "2026-08-07T10:00:00.000Z");
  assert.equal(record.updated_at, "2026-08-07T10:00:00.000Z");
  assert.match(record.checksum, /^[a-f0-9]{64}$/);
  assert.throws(() => {
    record.title = "changed";
  }, TypeError);
});

test("checksum reflects the record's own content — two records with different titles have different checksums", () => {
  const a = createIngestedContent(buildFields({ title: "Title A" }), { idGenerator: () => "ic_aaaaaaaaaaaaaaaa", now: () => "2026-08-07T10:00:00.000Z" });
  const b = createIngestedContent(buildFields({ title: "Title B" }), { idGenerator: () => "ic_bbbbbbbbbbbbbbbb", now: () => "2026-08-07T10:00:00.000Z" });
  assert.notEqual(a.checksum, b.checksum);
});

test("throws InvalidIngestedContentInputError for an unsupported sourceType", () => {
  assert.throws(() => createIngestedContent(buildFields({ sourceType: "markdown" })), InvalidIngestedContentInputError);
});

test("throws InvalidIngestedContentInputError for a missing sourceReference", () => {
  assert.throws(() => createIngestedContent(buildFields({ sourceReference: "" })), InvalidIngestedContentInputError);
});

test("throws InvalidIngestedContentInputError for a malformed sourceFingerprint", () => {
  assert.throws(() => createIngestedContent(buildFields({ sourceFingerprint: "not-a-hash" })), InvalidIngestedContentInputError);
});

test("throws InvalidIngestedContentInputError for a missing title", () => {
  assert.throws(() => createIngestedContent(buildFields({ title: "" })), InvalidIngestedContentInputError);
});

test("throws InvalidIngestedContentInputError for missing fullArticleText", () => {
  assert.throws(() => createIngestedContent(buildFields({ fullArticleText: "" })), InvalidIngestedContentInputError);
});

test("throws InvalidIngestedContentInputError for an invalid approvalState", () => {
  assert.throws(() => createIngestedContent(buildFields({ approvalState: "maybe" })), InvalidIngestedContentInputError);
});

test("accepts and stores an explicit approvalState", () => {
  const record = createIngestedContent(buildFields({ approvalState: "approved" }), { idGenerator: () => "ic_test0000000002" });
  assert.equal(record.approval_state, "approved");
});

test("metadata defaults to null and accepts an object", () => {
  const withoutMetadata = createIngestedContent(buildFields(), { idGenerator: () => "ic_test0000000003" });
  assert.equal(withoutMetadata.metadata, null);

  const withMetadata = createIngestedContent(buildFields({ metadata: { author: "a@b.com" } }), { idGenerator: () => "ic_test0000000004" });
  assert.deepEqual(withMetadata.metadata, { author: "a@b.com" });
});

test("throws IngestedContentValidationError when the assembled record still fails schema validation (invalid injected validator scenario)", () => {
  // A fake validator that always reports invalid — proves the factory
  // surfaces schema failures via the correct error type rather than
  // throwing something else or silently succeeding.
  const fakeValidator = { validate: () => ({ valid: false, errors: [{ path: "(root)", message: "forced failure" }] }) };
  assert.throws(() => createIngestedContent(buildFields(), { validator: fakeValidator }), IngestedContentValidationError);
});

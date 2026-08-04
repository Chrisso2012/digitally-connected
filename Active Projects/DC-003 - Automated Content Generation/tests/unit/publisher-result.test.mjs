import test from "node:test";
import assert from "node:assert/strict";
import { createPublisherResult } from "../../src/publisher-result.mjs";
import { InvalidPublisherResultInputError, PublisherResultValidationError } from "../../src/publisher-result-errors.mjs";

function validFields(overrides = {}) {
  return {
    carouselId: "car_pubtest0000001",
    assetPackageId: "pkg_pubtest0000001",
    executionId: "exec_20260804_deadbeefcafe",
    provider: "google-drive",
    destination: "https://drive.google.com/drive/folders/pubtest",
    providerReference: "folder_pubtest",
    metadata: { files_uploaded: 7 },
    ...overrides,
  };
}

// --- Successful construction, immutability, determinism --------------------

test("builds a valid, schema-conforming Publisher Result", () => {
  const result = createPublisherResult(validFields(), {
    now: () => "2026-08-04T12:00:00.000Z",
    idGenerator: () => "pub_deterministictest01",
  });
  assert.equal(result.publisher_result_id, "pub_deterministictest01");
  assert.equal(result.carousel_id, "car_pubtest0000001");
  assert.equal(result.asset_package_id, "pkg_pubtest0000001");
  assert.equal(result.execution_id, "exec_20260804_deadbeefcafe");
  assert.equal(result.provider, "google-drive");
  assert.equal(result.destination, "https://drive.google.com/drive/folders/pubtest");
  assert.equal(result.published_at, "2026-08-04T12:00:00.000Z");
  assert.equal(result.status, "completed");
  assert.equal(result.provider_reference, "folder_pubtest");
  assert.deepEqual(result.metadata, { files_uploaded: 7 });
});

test("metadata defaults to {} when omitted, never invented beyond what the caller supplies", () => {
  const { metadata, ...rest } = validFields();
  const result = createPublisherResult(rest);
  assert.deepEqual(result.metadata, {});
});

test("returns a fully frozen (immutable) object, including nested sub-objects", () => {
  const result = createPublisherResult(validFields());
  assert.throws(() => {
    result.status = "failed";
  }, TypeError);
  assert.throws(() => {
    result.metadata.files_uploaded = 999;
  }, TypeError);
});

test("generates a unique publisher_result_id per call when no idGenerator is injected", () => {
  const a = createPublisherResult(validFields());
  const b = createPublisherResult(validFields());
  assert.notEqual(a.publisher_result_id, b.publisher_result_id);
  assert.match(a.publisher_result_id, /^pub_[A-Za-z0-9]+$/);
});

// --- Composition-only input validation ---------------------------------

for (const field of ["carouselId", "assetPackageId", "executionId", "provider", "destination", "providerReference"]) {
  test(`throws InvalidPublisherResultInputError when ${field} is missing`, () => {
    const fields = validFields();
    delete fields[field];
    assert.throws(() => createPublisherResult(fields), InvalidPublisherResultInputError);
  });

  test(`throws InvalidPublisherResultInputError when ${field} is a blank string`, () => {
    assert.throws(() => createPublisherResult(validFields({ [field]: "   " })), InvalidPublisherResultInputError);
  });
}

test("throws InvalidPublisherResultInputError when metadata is not a plain object", () => {
  assert.throws(() => createPublisherResult(validFields({ metadata: "not an object" })), InvalidPublisherResultInputError);
  assert.throws(() => createPublisherResult(validFields({ metadata: ["array", "not", "object"] })), InvalidPublisherResultInputError);
});

// --- Schema validation (defense in depth) -----------------------------

test("throws PublisherResultValidationError if the assembled object fails schema validation despite passing composition checks", () => {
  // A structurally malformed carouselId (right type, wrong shape) passes
  // every composition check above but fails publisher-result.schema.json's
  // own pattern — this is what actually exercises the schema-validation
  // path, not the composition-check path.
  assert.throws(() => createPublisherResult(validFields({ carouselId: "not-a-real-carousel-id" })), PublisherResultValidationError);
});

test("status is always \"completed\" — this factory represents one successful publication only", () => {
  const result = createPublisherResult(validFields());
  assert.equal(result.status, "completed");
});

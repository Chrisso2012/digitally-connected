import test from "node:test";
import assert from "node:assert/strict";
import { createContentRequest } from "../../src/content-request.mjs";
import { ContentRequestValidationError } from "../../src/content-request-errors.mjs";

function validFields(overrides = {}) {
  return {
    action: "create",
    designCount: 6,
    sourceType: "article",
    sourceReference: "GS01",
    rawCommand: "Create 6 designs based on article GS01",
    ...overrides,
  };
}

test("builds a well-formed, immutable Content Request with injectable time/ID", () => {
  const contentRequest = createContentRequest(validFields(), {
    now: () => "2026-08-04T00:00:00.000Z",
    idGenerator: () => "req_deterministic0001",
  });

  assert.equal(contentRequest.request_id, "req_deterministic0001");
  assert.equal(contentRequest.action, "create");
  assert.equal(contentRequest.design_count, 6);
  assert.equal(contentRequest.source_type, "article");
  assert.equal(contentRequest.source_reference, "GS01");
  assert.equal(contentRequest.requested_at, "2026-08-04T00:00:00.000Z");
  assert.equal(contentRequest.raw_command, "Create 6 designs based on article GS01");
});

test("raw_command defaults to null for a directly-constructed structured request", () => {
  const contentRequest = createContentRequest({ action: "create", designCount: 6, sourceType: "article", sourceReference: "GS01" });
  assert.equal(contentRequest.raw_command, null);
});

test("generates a distinct request_id per call when no idGenerator is injected", () => {
  const a = createContentRequest(validFields());
  const b = createContentRequest(validFields());
  assert.notEqual(a.request_id, b.request_id);
  assert.match(a.request_id, /^req_[A-Za-z0-9]+$/);
});

test("returns a deeply frozen object", () => {
  const contentRequest = createContentRequest(validFields());
  assert.ok(Object.isFrozen(contentRequest));
  assert.throws(() => {
    contentRequest.design_count = 12;
  }, TypeError);
});

test("throws ContentRequestValidationError for an unsupported action", () => {
  assert.throws(() => createContentRequest(validFields({ action: "delete" })), ContentRequestValidationError);
});

test("throws ContentRequestValidationError for design_count other than 6", () => {
  assert.throws(() => createContentRequest(validFields({ designCount: 3 })), ContentRequestValidationError);
  assert.throws(() => createContentRequest(validFields({ designCount: 12 })), ContentRequestValidationError);
});

test("throws ContentRequestValidationError for an unsupported source_type", () => {
  assert.throws(() => createContentRequest(validFields({ sourceType: "video" })), ContentRequestValidationError);
});

test("throws ContentRequestValidationError for a blank source_reference", () => {
  assert.throws(() => createContentRequest(validFields({ sourceReference: "" })), ContentRequestValidationError);
});

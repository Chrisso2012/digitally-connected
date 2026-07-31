import test from "node:test";
import assert from "node:assert/strict";
import { validateTransportResponse } from "../../src/renderer-response-validator.mjs";
import { ValidationError, RenderRejected } from "../../src/renderer-errors.mjs";

test("a well-formed completed response normalizes correctly", () => {
  const normalized = validateTransportResponse({ id: "render_1", status: "completed", url: "https://example.test/a.png" });
  assert.deepEqual(normalized, { id: "render_1", status: "completed", imageUrl: "https://example.test/a.png" });
});

test("a well-formed pending response normalizes with a null imageUrl", () => {
  const normalized = validateTransportResponse({ id: "render_2", status: "pending" });
  assert.deepEqual(normalized, { id: "render_2", status: "pending", imageUrl: null });
});

test("a non-object response is rejected with ValidationError", () => {
  assert.throws(() => validateTransportResponse("not an object"), ValidationError);
  assert.throws(() => validateTransportResponse(null), ValidationError);
  assert.throws(() => validateTransportResponse([1, 2, 3]), ValidationError);
});

test("a missing id is rejected with ValidationError carrying details", () => {
  try {
    validateTransportResponse({ status: "completed" });
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    assert.ok(error.details.some((d) => d.field === "id"));
  }
});

test("an invalid status is rejected with ValidationError", () => {
  try {
    validateTransportResponse({ id: "render_3", status: "not-a-real-status" });
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    assert.ok(error.details.some((d) => d.field === "status"));
  }
});

test("a non-string url is rejected with ValidationError", () => {
  assert.throws(() => validateTransportResponse({ id: "render_4", status: "completed", url: 12345 }), ValidationError);
});

test("a well-formed failed response is rejected with RenderRejected, not ValidationError", () => {
  try {
    validateTransportResponse({ id: "render_5", status: "failed", error: "bad template" });
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof RenderRejected);
    assert.ok(!(error instanceof ValidationError));
    assert.equal(error.renderId, "render_5");
    assert.equal(error.reason, "bad template");
  }
});

// --- Real Templated create-render response shape (confirmed via live
// verification research: https://templated.io/docs/renders/create/ — no
// explicit "status" field on the documented synchronous success response) ---

test("Templated's real response shape (id + url, no status field) is treated as completed", () => {
  const realShapeResponse = {
    id: "8f3a2e9c-1234-4abc-9def-0123456789ab",
    url: "https://cdn.templated.io/renders/8f3a2e9c.png",
    storage_url: null,
    width: 1080,
    height: 1350,
    format: "png",
    templateId: "748d17c5-c58e-48eb-9f12-434252a6d17f",
    templateName: "DC Carousel — 1. Cover",
    createdAt: "2026-08-01T00:00:00.000Z",
    externalId: null,
  };
  const normalized = validateTransportResponse(realShapeResponse);
  assert.equal(normalized.status, "completed");
  assert.equal(normalized.imageUrl, realShapeResponse.url);
});

test("a response with an id but no url and no status is inferred as processing, not an error", () => {
  const normalized = validateTransportResponse({ id: "render_6" });
  assert.equal(normalized.status, "processing");
  assert.equal(normalized.imageUrl, null);
});

test("an explicit status always wins over inference, even if a url is also present", () => {
  const normalized = validateTransportResponse({ id: "render_7", status: "pending", url: "https://example.test/a.png" });
  assert.equal(normalized.status, "pending");
});

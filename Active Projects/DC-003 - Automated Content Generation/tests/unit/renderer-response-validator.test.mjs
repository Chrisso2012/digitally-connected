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

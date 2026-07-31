import test from "node:test";
import assert from "node:assert/strict";
import { createRenderResult, RENDER_STATUSES } from "../../src/render-result.mjs";

function validFields(overrides = {}) {
  return {
    renderId: "render_test_0001",
    status: "completed",
    imageUrl: "https://example.test/a.png",
    templateId: "748d17c5-c58e-48eb-9f12-434252a6d17f",
    slideType: "cover",
    provider: "mock-transport",
    requestedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:00:01.000Z",
    durationMs: 1000,
    ...overrides,
  };
}

test("creates a successful RenderResult with every field preserved", () => {
  const result = createRenderResult(validFields());
  assert.equal(result.renderId, "render_test_0001");
  assert.equal(result.status, "completed");
  assert.equal(result.durationMs, 1000);
});

test("the returned RenderResult cannot be mutated", () => {
  const result = createRenderResult(validFields());
  assert.throws(() => {
    result.status = "failed";
  }, TypeError);
  assert.equal(result.status, "completed");
});

test("does not expose fields beyond the documented shape", () => {
  const result = createRenderResult({ ...validFields(), extraneous: "should not appear" });
  assert.equal("extraneous" in result, false);
});

test("throws TypeError when a required field is missing", () => {
  const fields = validFields();
  delete fields.renderId;
  assert.throws(() => createRenderResult(fields), TypeError);
});

test("throws TypeError for a status outside RENDER_STATUSES", () => {
  assert.throws(() => createRenderResult(validFields({ status: "not-a-real-status" })), TypeError);
});

test("accepts every status in RENDER_STATUSES, including non-terminal ones", () => {
  for (const status of RENDER_STATUSES) {
    const result = createRenderResult(validFields({ status, imageUrl: status === "completed" ? "https://example.test/a.png" : null }));
    assert.equal(result.status, status);
  }
});

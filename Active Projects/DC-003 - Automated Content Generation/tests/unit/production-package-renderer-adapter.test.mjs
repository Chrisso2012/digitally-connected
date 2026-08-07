import test from "node:test";
import assert from "node:assert/strict";
import { assertValidRendererAdapter } from "../../src/production-package-renderer-adapter.mjs";
import { InvalidRendererAdapterError } from "../../src/production-package-errors.mjs";

test("assertValidRendererAdapter() accepts a well-shaped adapter", () => {
  assert.doesNotThrow(() =>
    assertValidRendererAdapter({ name: "x", renderer: "x", buildSlideSequence: () => {}, mapToRendererPayload: () => {} })
  );
});

test("assertValidRendererAdapter() throws for a missing/malformed adapter", () => {
  assert.throws(() => assertValidRendererAdapter(null), InvalidRendererAdapterError);
  assert.throws(() => assertValidRendererAdapter({ name: "x" }), InvalidRendererAdapterError);
  assert.throws(() => assertValidRendererAdapter({ name: "x", renderer: "x", buildSlideSequence: () => {} }), InvalidRendererAdapterError);
  assert.throws(() => assertValidRendererAdapter({ name: "x", renderer: "x", mapToRendererPayload: () => {} }), InvalidRendererAdapterError);
  assert.throws(() => assertValidRendererAdapter({ renderer: "x", buildSlideSequence: () => {}, mapToRendererPayload: () => {} }), InvalidRendererAdapterError);
});

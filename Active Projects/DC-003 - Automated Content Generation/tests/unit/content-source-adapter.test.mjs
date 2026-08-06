import test from "node:test";
import assert from "node:assert/strict";
import { assertValidContentSourceAdapter, assertValidContentSourceFetchResult } from "../../src/content-source-adapter.mjs";
import { InvalidContentSourceAdapterError, MalformedContentSourceResultError } from "../../src/content-source-errors.mjs";

test("assertValidContentSourceAdapter() accepts a well-shaped adapter", () => {
  assert.doesNotThrow(() => assertValidContentSourceAdapter({ name: "x", fetch: async () => ({}) }));
});

test("assertValidContentSourceAdapter() throws for a missing/malformed adapter", () => {
  assert.throws(() => assertValidContentSourceAdapter(null), InvalidContentSourceAdapterError);
  assert.throws(() => assertValidContentSourceAdapter({ name: "x" }), InvalidContentSourceAdapterError);
  assert.throws(() => assertValidContentSourceAdapter({ fetch: async () => ({}) }), InvalidContentSourceAdapterError);
});

const VALID_RESULT = { title: "T", body: "B", metadata: null, sourceIdentifier: "id-1" };

test("assertValidContentSourceFetchResult() accepts a well-shaped result", () => {
  assert.doesNotThrow(() => assertValidContentSourceFetchResult(VALID_RESULT, "ref"));
  assert.doesNotThrow(() => assertValidContentSourceFetchResult({ ...VALID_RESULT, metadata: { a: 1 } }, "ref"));
});

test("assertValidContentSourceFetchResult() throws for each missing/malformed field", () => {
  assert.throws(() => assertValidContentSourceFetchResult(null, "ref"), MalformedContentSourceResultError);
  assert.throws(() => assertValidContentSourceFetchResult({ ...VALID_RESULT, title: "" }, "ref"), MalformedContentSourceResultError);
  assert.throws(() => assertValidContentSourceFetchResult({ ...VALID_RESULT, body: "" }, "ref"), MalformedContentSourceResultError);
  assert.throws(() => assertValidContentSourceFetchResult({ ...VALID_RESULT, metadata: "not-object" }, "ref"), MalformedContentSourceResultError);
  assert.throws(() => assertValidContentSourceFetchResult({ ...VALID_RESULT, sourceIdentifier: "" }, "ref"), MalformedContentSourceResultError);
});

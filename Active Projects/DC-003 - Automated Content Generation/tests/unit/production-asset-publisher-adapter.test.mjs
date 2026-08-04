// Unit tests for production-asset-publisher-adapter.mjs (DC-003-I022) —
// assertValidPublisherAdapter() only. No filesystem, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { assertValidPublisherAdapter } from "../../src/production-asset-publisher-adapter.mjs";
import { InvalidPublisherAdapterError } from "../../src/production-asset-publisher-errors.mjs";

test("throws InvalidPublisherAdapterError for undefined/null", () => {
  assert.throws(() => assertValidPublisherAdapter(undefined), InvalidPublisherAdapterError);
  assert.throws(() => assertValidPublisherAdapter(null), InvalidPublisherAdapterError);
});

test("throws InvalidPublisherAdapterError when name is missing or not a string", () => {
  assert.throws(() => assertValidPublisherAdapter({ publishPackage: async () => {} }), InvalidPublisherAdapterError);
  assert.throws(() => assertValidPublisherAdapter({ name: 42, publishPackage: async () => {} }), InvalidPublisherAdapterError);
});

test("throws InvalidPublisherAdapterError when publishPackage is missing or not a function", () => {
  assert.throws(() => assertValidPublisherAdapter({ name: "x" }), InvalidPublisherAdapterError);
  assert.throws(() => assertValidPublisherAdapter({ name: "x", publishPackage: "not-a-function" }), InvalidPublisherAdapterError);
});

test("does not throw for a well-shaped adapter", () => {
  assert.doesNotThrow(() => assertValidPublisherAdapter({ name: "fake-adapter", publishPackage: async () => {} }));
});

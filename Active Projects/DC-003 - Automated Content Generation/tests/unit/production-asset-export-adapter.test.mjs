// Unit tests for production-asset-export-adapter.mjs (DC-003-I021) —
// assertValidExportAdapter() only. No filesystem, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { assertValidExportAdapter } from "../../src/production-asset-export-adapter.mjs";
import { InvalidExportAdapterError } from "../../src/production-asset-export-errors.mjs";

test("throws InvalidExportAdapterError for undefined/null", () => {
  assert.throws(() => assertValidExportAdapter(undefined), InvalidExportAdapterError);
  assert.throws(() => assertValidExportAdapter(null), InvalidExportAdapterError);
});

test("throws InvalidExportAdapterError when name is missing or not a string", () => {
  assert.throws(() => assertValidExportAdapter({ exportPackage: async () => {} }), InvalidExportAdapterError);
  assert.throws(() => assertValidExportAdapter({ name: 42, exportPackage: async () => {} }), InvalidExportAdapterError);
});

test("throws InvalidExportAdapterError when exportPackage is missing or not a function", () => {
  assert.throws(() => assertValidExportAdapter({ name: "x" }), InvalidExportAdapterError);
  assert.throws(() => assertValidExportAdapter({ name: "x", exportPackage: "not-a-function" }), InvalidExportAdapterError);
});

test("does not throw for a well-shaped adapter", () => {
  assert.doesNotThrow(() => assertValidExportAdapter({ name: "fake-adapter", exportPackage: async () => {} }));
});

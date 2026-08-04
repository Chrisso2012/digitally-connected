import test from "node:test";
import assert from "node:assert/strict";
import { assertValidMetricsStoreAdapter } from "../../src/production-metrics-store-adapter.mjs";
import { InvalidMetricsStoreAdapterError } from "../../src/production-metrics-errors.mjs";

test("throws InvalidMetricsStoreAdapterError for undefined/null", () => {
  assert.throws(() => assertValidMetricsStoreAdapter(undefined), InvalidMetricsStoreAdapterError);
  assert.throws(() => assertValidMetricsStoreAdapter(null), InvalidMetricsStoreAdapterError);
});

test("throws InvalidMetricsStoreAdapterError when any required method is missing", () => {
  const full = { name: "x", write: () => {}, read: () => {}, list: () => [], exists: () => false };
  for (const key of ["write", "read", "list", "exists"]) {
    const partial = { ...full };
    delete partial[key];
    assert.throws(() => assertValidMetricsStoreAdapter(partial), InvalidMetricsStoreAdapterError);
  }
});

test("throws InvalidMetricsStoreAdapterError when name is not a string", () => {
  assert.throws(
    () => assertValidMetricsStoreAdapter({ name: 1, write: () => {}, read: () => {}, list: () => [], exists: () => false }),
    InvalidMetricsStoreAdapterError
  );
});

test("does not throw for a well-shaped adapter", () => {
  assert.doesNotThrow(() =>
    assertValidMetricsStoreAdapter({ name: "fake", write: () => {}, read: () => {}, list: () => [], exists: () => false })
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { createContentSourceMockAdapter } from "../../src/content-source-mock-adapter.mjs";
import {
  ContentSourceNotFoundError,
  ContentSourceAuthenticationError,
  ContentSourceRateLimitError,
  ContentSourceTransportError,
} from "../../src/content-source-errors.mjs";

test("default mode returns the built-in default fixture for any sourceReference", async () => {
  const adapter = createContentSourceMockAdapter();
  const result = await adapter.fetch({ sourceReference: "anything" });
  assert.equal(result.sourceIdentifier, "anything");
  assert.ok(result.title.length > 0);
  assert.ok(result.body.length > 0);
  assert.notEqual(result.metadata, undefined);
});

test("injected fixtures override the default for a matching sourceReference only", async () => {
  const adapter = createContentSourceMockAdapter({ fixtures: { "doc-1": { title: "Custom Title", body: "Custom body text." } } });
  const custom = await adapter.fetch({ sourceReference: "doc-1" });
  assert.equal(custom.title, "Custom Title");
  assert.equal(custom.body, "Custom body text.");

  const fallback = await adapter.fetch({ sourceReference: "doc-2" });
  assert.notEqual(fallback.title, "Custom Title");
});

test("mode=not-found throws ContentSourceNotFoundError", async () => {
  const adapter = createContentSourceMockAdapter({ mode: "not-found" });
  await assert.rejects(() => adapter.fetch({ sourceReference: "x" }), ContentSourceNotFoundError);
});

test("mode=authentication-error throws ContentSourceAuthenticationError", async () => {
  const adapter = createContentSourceMockAdapter({ mode: "authentication-error" });
  await assert.rejects(() => adapter.fetch({ sourceReference: "x" }), ContentSourceAuthenticationError);
});

test("mode=rate-limit throws ContentSourceRateLimitError", async () => {
  const adapter = createContentSourceMockAdapter({ mode: "rate-limit" });
  await assert.rejects(() => adapter.fetch({ sourceReference: "x" }), ContentSourceRateLimitError);
});

test("mode=transport-error throws ContentSourceTransportError", async () => {
  const adapter = createContentSourceMockAdapter({ mode: "transport-error" });
  await assert.rejects(() => adapter.fetch({ sourceReference: "x" }), ContentSourceTransportError);
});

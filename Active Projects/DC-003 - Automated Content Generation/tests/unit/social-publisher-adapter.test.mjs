import test from "node:test";
import assert from "node:assert/strict";
import { assertValidSocialPublisherAdapter } from "../../src/social-publisher-adapter.mjs";
import { InvalidSocialPublisherAdapterError } from "../../src/social-publisher-service-errors.mjs";
import { createMockInstagramPublisherAdapter } from "../../src/instagram-mock-publisher-adapter.mjs";
import { createMockLinkedInPublisherAdapter } from "../../src/linkedin-mock-publisher-adapter.mjs";

test("throws InvalidSocialPublisherAdapterError for a missing or malformed adapter", () => {
  assert.throws(() => assertValidSocialPublisherAdapter(null), InvalidSocialPublisherAdapterError);
  assert.throws(() => assertValidSocialPublisherAdapter({}), InvalidSocialPublisherAdapterError);
  assert.throws(() => assertValidSocialPublisherAdapter({ name: "x" }), InvalidSocialPublisherAdapterError);
  assert.throws(() => assertValidSocialPublisherAdapter({ name: "x", provider: "instagram" }), InvalidSocialPublisherAdapterError);
  assert.throws(
    () => assertValidSocialPublisherAdapter({ name: "x", provider: "instagram", destination: "acct", publish: "not a function" }),
    InvalidSocialPublisherAdapterError
  );
});

test("accepts the real mock Instagram and LinkedIn adapters — both implement the shape correctly", () => {
  assert.doesNotThrow(() => assertValidSocialPublisherAdapter(createMockInstagramPublisherAdapter()));
  assert.doesNotThrow(() => assertValidSocialPublisherAdapter(createMockLinkedInPublisherAdapter()));
});

test("destination is available synchronously, before any publish() call", () => {
  const adapter = createMockInstagramPublisherAdapter({ destination: "instagram:12345" });
  assert.equal(adapter.destination, "instagram:12345");
  assert.equal(typeof adapter.destination, "string");
});

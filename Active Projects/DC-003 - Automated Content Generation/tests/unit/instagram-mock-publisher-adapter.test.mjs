import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createMockInstagramPublisherAdapter } from "../../src/instagram-mock-publisher-adapter.mjs";
import { InstagramClientError } from "../../src/instagram-publisher-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

function loadFreshCarousel() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
}

test("implements the documented shape: name, provider, destination, publish()", () => {
  const adapter = createMockInstagramPublisherAdapter();
  assert.equal(adapter.name, "mock-instagram-publisher-adapter");
  assert.equal(adapter.provider, "instagram");
  assert.equal(typeof adapter.destination, "string");
  assert.equal(typeof adapter.publish, "function");
});

test("success mode (default) returns a deterministic, complete result and never touches the network", async () => {
  const adapter = createMockInstagramPublisherAdapter({ now: () => "2026-08-05T12:00:00.000Z" });
  const result = await adapter.publish({ manifest: {}, finishedCarousel: loadFreshCarousel() });
  assert.equal(result.postId, "17800000000000000_mock");
  assert.equal(result.postUrl, null);
  assert.equal(result.publishedAt, "2026-08-05T12:00:00.000Z");
  assert.equal(result.itemCount, 6);
  assert.equal(adapter.callCount(), 1);
});

test("failure mode throws InstagramClientError, deterministically", async () => {
  const adapter = createMockInstagramPublisherAdapter({ mode: "failure" });
  await assert.rejects(() => adapter.publish({ manifest: {}, finishedCarousel: loadFreshCarousel() }), InstagramClientError);
});

test("result fields can be overridden for deterministic tests", async () => {
  const adapter = createMockInstagramPublisherAdapter({ postId: "custom_id", postUrl: "https://instagram.com/p/custom", itemCount: 6 });
  const result = await adapter.publish({ manifest: {}, finishedCarousel: loadFreshCarousel() });
  assert.equal(result.postId, "custom_id");
  assert.equal(result.postUrl, "https://instagram.com/p/custom");
});

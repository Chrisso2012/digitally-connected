import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createMockLinkedInPublisherAdapter } from "../../src/linkedin-mock-publisher-adapter.mjs";
import { LinkedInClientError } from "../../src/linkedin-publisher-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

function loadFreshCarousel() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
}

test("implements the documented shape: name, provider, destination, publish()", () => {
  const adapter = createMockLinkedInPublisherAdapter();
  assert.equal(adapter.name, "mock-linkedin-publisher-adapter");
  assert.equal(adapter.provider, "linkedin");
  assert.equal(typeof adapter.destination, "string");
  assert.equal(typeof adapter.publish, "function");
});

test("success mode (default) returns a deterministic, complete result and never touches the network or filesystem", async () => {
  const adapter = createMockLinkedInPublisherAdapter({ now: () => "2026-08-05T12:00:00.000Z" });
  const result = await adapter.publish({ manifest: {}, finishedCarousel: loadFreshCarousel(), assetPackagePath: "/does/not/exist" });
  assert.equal(result.postId, "urn:li:share:7000000000000000000");
  assert.match(result.postUrl, /^https:\/\/www\.linkedin\.com\/feed\/update\//);
  assert.equal(result.publishedAt, "2026-08-05T12:00:00.000Z");
  assert.equal(result.itemCount, 6);
  assert.equal(adapter.callCount(), 1);
});

test("failure mode throws LinkedInClientError, deterministically", async () => {
  const adapter = createMockLinkedInPublisherAdapter({ mode: "failure" });
  await assert.rejects(() => adapter.publish({ manifest: {}, finishedCarousel: loadFreshCarousel(), assetPackagePath: "/does/not/exist" }), LinkedInClientError);
});

test("result fields can be overridden for deterministic tests", async () => {
  const adapter = createMockLinkedInPublisherAdapter({ postId: "urn:li:share:custom", postUrl: "https://www.linkedin.com/feed/update/urn:li:share:custom/" });
  const result = await adapter.publish({ manifest: {}, finishedCarousel: loadFreshCarousel(), assetPackagePath: "/x" });
  assert.equal(result.postId, "urn:li:share:custom");
  assert.equal(result.postUrl, "https://www.linkedin.com/feed/update/urn:li:share:custom/");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mapCarouselToTemplatedPayload } from "../../src/carousel-payload-mapper.mjs";
import { loadTemplatesConfig } from "../../src/config-loader.mjs";
import { SLIDE_ORDER } from "../../src/carousel-slide-spec.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "carousel-content");

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf-8"));
}

test("valid carousel content maps to six payloads, one per slide, in order", () => {
  const carouselContent = loadFixture("valid.json");
  const payloads = mapCarouselToTemplatedPayload(carouselContent);

  assert.equal(payloads.length, 6);
  assert.deepEqual(payloads.map((p) => p.slide_type), SLIDE_ORDER);
  assert.deepEqual(payloads.map((p) => p.slide_number), [1, 2, 3, 4, 5, 6]);
  for (const payload of payloads) {
    assert.equal(payload.carousel_content_id, carouselContent.carousel_content_id);
    assert.match(payload.payload_id, /^pl_[A-Za-z0-9_]+$/);
    assert.equal(payload.format, "png");
  }
});

test("every editable layer for each template is populated in the mapped payload", () => {
  const carouselContent = loadFixture("valid.json");
  const payloads = mapCarouselToTemplatedPayload(carouselContent);
  const templatesConfig = loadTemplatesConfig();

  for (const payload of payloads) {
    const templateEntry = Object.values(templatesConfig.templates).find(
      (entry) => entry.template_id === payload.template_id
    );
    const requiredLayerNames = (templateEntry.layers.variable ?? [])
      .filter((l) => !l.optional)
      .map((l) => l.name);
    for (const name of requiredLayerNames) {
      assert.ok(name in payload.layers, `expected layer "${name}" to be populated for slide_type "${payload.slide_type}"`);
      assert.notEqual(payload.layers[name].text.trim(), "");
    }
  }
});

test("template IDs are resolved from config/templates.json, not hardcoded", () => {
  const carouselContent = loadFixture("valid.json");
  const payloads = mapCarouselToTemplatedPayload(carouselContent);
  const templatesConfig = loadTemplatesConfig();

  for (const payload of payloads) {
    const expected = templatesConfig.templates[payload.slide_type].template_id;
    assert.equal(payload.template_id, expected);
  }
});

test("the returned payload array cannot be mutated", () => {
  const payloads = mapCarouselToTemplatedPayload(loadFixture("valid.json"));
  assert.throws(() => {
    payloads.push({});
  }, TypeError);
  assert.throws(() => {
    payloads[0].slide_type = "tampered";
  }, TypeError);
  assert.throws(() => {
    payloads[0].layers.headline_text = { text: "tampered" };
  }, TypeError);
});

test("mapping is deterministic given the same clock and ID generator", () => {
  const carouselContent = loadFixture("valid.json");
  const fixedNow = () => "2026-08-01T00:00:00.000Z";
  const fixedIds = (slideType) => `pl_fixed_${slideType}`;

  const payloadsA = mapCarouselToTemplatedPayload(carouselContent, { now: fixedNow, payloadId: fixedIds });
  const payloadsB = mapCarouselToTemplatedPayload(structuredClone(carouselContent), { now: fixedNow, payloadId: fixedIds });

  assert.deepEqual(structuredClone(payloadsA), structuredClone(payloadsB));
});

test("content slide's list_items fan out to list_item_1..3_text (list_item_4 optional and absent here)", () => {
  const payloads = mapCarouselToTemplatedPayload(loadFixture("valid.json"));
  const contentPayload = payloads.find((p) => p.slide_type === "content");
  assert.equal(contentPayload.layers.list_item_1_text.text, "Every unconverted lead already raised its hand once");
  assert.equal(contentPayload.layers.list_item_2_text.text, "Automated re-engagement costs nothing new in ad spend");
  assert.equal(contentPayload.layers.list_item_3_text.text, "Segmented follow-up outperforms a single blast");
  assert.equal("list_item_4_text" in contentPayload.layers, false);
});

test("infographic slide's steps fan out to step_1..4_title/_description", () => {
  const payloads = mapCarouselToTemplatedPayload(loadFixture("valid.json"));
  const infographicPayload = payloads.find((p) => p.slide_type === "infographic");
  assert.equal(infographicPayload.layers.step_1_title.text, "Understand");
  assert.equal(infographicPayload.layers.step_4_description.text, "Warm replies are routed straight to a booked call.");
});

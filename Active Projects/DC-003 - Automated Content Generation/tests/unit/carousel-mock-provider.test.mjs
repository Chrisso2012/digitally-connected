import test from "node:test";
import assert from "node:assert/strict";
import { createMockProvider } from "../../src/carousel-mock-provider.mjs";
import { SLIDE_ORDER, SLIDE_CONTENT_SPEC } from "../../src/carousel-slide-spec.mjs";
import { checkCarouselContentShape } from "../../src/carousel-content-shape.mjs";

function baseTopic(overrides = {}) {
  return {
    topic_id: "topic_TEST0001",
    working_title: "Your database is your cheapest lead source",
    audience: "Owner-operators running 10-50 staff service businesses",
    primary_goal: "Book a database audit call",
    core_message: "Unconverted enquiries are still recoverable revenue.",
    supporting_points: ["Point one", "Point two", "Point three", "Point four", "Point five"],
    cta: "Book your audit",
    brand_voice: "confident-direct",
    ...overrides,
  };
}

test("mock provider has a name and an async generateCarousel function", () => {
  const provider = createMockProvider();
  assert.equal(typeof provider.name, "string");
  assert.equal(typeof provider.generateCarousel, "function");
});

test("mock provider returns valid JSON text with exactly six slides in order", async () => {
  const provider = createMockProvider();
  const raw = await provider.generateCarousel("irrelevant prompt text", { topicPackage: baseTopic() });
  const parsed = JSON.parse(raw);

  assert.ok(Array.isArray(parsed.slides));
  assert.equal(parsed.slides.length, SLIDE_ORDER.length);
  assert.deepEqual(parsed.slides.map((s) => s.slide_type), SLIDE_ORDER);
});

test("mock provider output passes the content-shape checker", async () => {
  const provider = createMockProvider();
  const raw = await provider.generateCarousel("prompt", { topicPackage: baseTopic() });
  const parsed = JSON.parse(raw);
  const report = checkCarouselContentShape({ slides: parsed.slides });
  assert.equal(report.ok, true, JSON.stringify(report.issues));
});

test("mock provider output is grounded in the actual Topic Package content", async () => {
  const topic = baseTopic();
  const provider = createMockProvider();
  const raw = await provider.generateCarousel("prompt", { topicPackage: topic });
  const parsed = JSON.parse(raw);

  const cover = parsed.slides.find((s) => s.slide_type === "cover");
  assert.equal(cover.content.headline_text, topic.working_title);

  const ctaSlide = parsed.slides.find((s) => s.slide_type === "cta");
  assert.equal(ctaSlide.content.button_label, topic.cta);
});

test("mock provider is deterministic — same topic in, identical output out", async () => {
  const provider = createMockProvider();
  const topic = baseTopic();
  const rawA = await provider.generateCarousel("prompt", { topicPackage: topic });
  const rawB = await provider.generateCarousel("prompt", { topicPackage: structuredClone(topic) });
  assert.equal(rawA, rawB);
});

test("mock provider fills content list_items to 3-4 items even with fewer supporting_points", async () => {
  const topic = baseTopic({ supporting_points: ["Only one point"] });
  const provider = createMockProvider();
  const raw = await provider.generateCarousel("prompt", { topicPackage: topic });
  const parsed = JSON.parse(raw);
  const contentSlide = parsed.slides.find((s) => s.slide_type === "content");
  const rule = SLIDE_CONTENT_SPEC.content.arrayFields.list_items;
  assert.ok(contentSlide.content.list_items.length >= rule.min);
  assert.ok(contentSlide.content.list_items.length <= rule.max);
});

test("mock provider always produces exactly 4 infographic steps", async () => {
  const topic = baseTopic({ supporting_points: ["Only one point"] });
  const provider = createMockProvider();
  const raw = await provider.generateCarousel("prompt", { topicPackage: topic });
  const parsed = JSON.parse(raw);
  const infographic = parsed.slides.find((s) => s.slide_type === "infographic");
  assert.equal(infographic.content.steps.length, 4);
  for (const step of infographic.content.steps) {
    assert.notEqual(step.title.trim(), "");
    assert.notEqual(step.description.trim(), "");
  }
});

test("mock provider throws a clear error if called without topicPackage context", async () => {
  const provider = createMockProvider();
  await assert.rejects(() => provider.generateCarousel("prompt"), /topicPackage/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { validateGeneratedCarousel } from "../../src/carousel-content-validator.mjs";
import { createMockProvider } from "../../src/carousel-mock-provider.mjs";

function baseMetadata(overrides = {}) {
  return {
    carousel_content_id: "cc_TEST00000001",
    topic_id: "topic_TEST0001",
    generated_at: "2026-07-31T00:00:00.000Z",
    llm_model: "test-provider",
    prompt_version: "carousel-copy.v1",
    schema_version: "1.0",
    ...overrides,
  };
}

function baseTopic() {
  return {
    topic_id: "topic_TEST0001",
    working_title: "Your database is your cheapest lead source",
    audience: "Owner-operators",
    primary_goal: "Book a call",
    core_message: "Recoverable revenue.",
    supporting_points: ["Point one", "Point two", "Point three"],
    cta: "Book now",
    brand_voice: "confident-direct",
  };
}

test("valid provider output assembles into a schema-valid, shape-valid Carousel Content Object", async () => {
  const raw = await createMockProvider().generateCarousel("prompt", { topicPackage: baseTopic() });
  const result = validateGeneratedCarousel(raw, baseMetadata());
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result));
  assert.equal(result.carouselContent.carousel_content_id, "cc_TEST00000001");
  assert.equal(result.carouselContent.slides.length, 6);
});

test("malformed JSON is rejected at the 'parse' stage", () => {
  const result = validateGeneratedCarousel("{ this is not valid json", baseMetadata());
  assert.equal(result.ok, false);
  assert.equal(result.stage, "parse");
  assert.notEqual(result.message.trim(), "");
});

test("valid JSON that isn't a { slides: [...] } object is rejected at the 'parse' stage", () => {
  const result = validateGeneratedCarousel(JSON.stringify(["just", "an", "array"]), baseMetadata());
  assert.equal(result.ok, false);
  assert.equal(result.stage, "parse");
});

test("too few slides is rejected at the 'schema' stage", () => {
  const raw = JSON.stringify({
    slides: [{ slide_type: "cover", content: { eyebrow_text: "A", headline_text: "B", body_text: "C" } }],
  });
  const result = validateGeneratedCarousel(raw, baseMetadata());
  assert.equal(result.ok, false);
  assert.equal(result.stage, "schema");
  assert.ok(result.details.length > 0);
});

test("invalid content (missing required field for a slide type) is rejected at the 'content-shape' stage", async () => {
  const raw = await createMockProvider().generateCarousel("prompt", { topicPackage: baseTopic() });
  const parsed = JSON.parse(raw);
  parsed.slides[0].content.headline_text = "";
  const result = validateGeneratedCarousel(JSON.stringify(parsed), baseMetadata());
  assert.equal(result.ok, false);
  assert.equal(result.stage, "content-shape");
  assert.ok(result.details.some((issue) => issue.check === "blank-field"));
});

test("schema failures preserve multiple structured errors, not just the first", () => {
  const raw = JSON.stringify({ slides: [] });
  const result = validateGeneratedCarousel(raw, baseMetadata());
  assert.equal(result.ok, false);
  assert.equal(result.stage, "schema");
  for (const detail of result.details) {
    assert.equal(typeof detail.path, "string");
    assert.equal(typeof detail.message, "string");
  }
});

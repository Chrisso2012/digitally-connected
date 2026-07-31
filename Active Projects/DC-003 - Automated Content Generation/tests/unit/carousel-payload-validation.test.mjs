import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mapCarouselToTemplatedPayload } from "../../src/carousel-payload-mapper.mjs";
import {
  UnknownTemplateError,
  MissingLayerError,
  DuplicateLayerMappingError,
  UnsupportedContentError,
  TemplatedPayloadValidationError,
} from "../../src/carousel-payload-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "carousel-content");

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf-8"));
}

test("unknown template (unrecognized slide_type) is rejected with UnknownTemplateError", () => {
  const carouselContent = loadFixture("unknown-template.json");
  assert.throws(() => mapCarouselToTemplatedPayload(carouselContent), (error) => {
    assert.ok(error instanceof UnknownTemplateError);
    assert.equal(error.slideType, "banner");
    return true;
  });
});

test("a slide missing a required content field is rejected with MissingLayerError", () => {
  const carouselContent = loadFixture("missing-layer.json");
  assert.throws(() => mapCarouselToTemplatedPayload(carouselContent), (error) => {
    assert.ok(error instanceof MissingLayerError);
    assert.equal(error.slideType, "cover");
    assert.equal(error.layerName, "body_text");
    return true;
  });
});

test("a repeated slide_type across the carousel is rejected with DuplicateLayerMappingError", () => {
  const carouselContent = loadFixture("duplicate-layer.json");
  assert.throws(() => mapCarouselToTemplatedPayload(carouselContent), (error) => {
    assert.ok(error instanceof DuplicateLayerMappingError);
    assert.equal(error.slideType, "cover");
    return true;
  });
});

test("a malformed carousel_content_id produces a valid mapping but fails final payload schema validation", () => {
  const carouselContent = loadFixture("invalid-payload.json");
  assert.throws(() => mapCarouselToTemplatedPayload(carouselContent), (error) => {
    assert.ok(error instanceof TemplatedPayloadValidationError);
    assert.ok(error.errors.length > 0);
    for (const e of error.errors) {
      assert.equal(typeof e.path, "string");
      assert.equal(typeof e.message, "string");
    }
    return true;
  });
});

test("a content slide with too few list_items is rejected with UnsupportedContentError", () => {
  const carouselContent = loadFixture("valid.json");
  const contentSlide = carouselContent.slides.find((s) => s.slide_type === "content");
  contentSlide.content.list_items = ["only one"];

  assert.throws(() => mapCarouselToTemplatedPayload(carouselContent), (error) => {
    assert.ok(error instanceof UnsupportedContentError);
    assert.equal(error.field, "list_items");
    return true;
  });
});

test("an infographic slide with the wrong number of steps is rejected with UnsupportedContentError", () => {
  const carouselContent = loadFixture("valid.json");
  const infographicSlide = carouselContent.slides.find((s) => s.slide_type === "infographic");
  infographicSlide.content.steps = infographicSlide.content.steps.slice(0, 3);

  assert.throws(() => mapCarouselToTemplatedPayload(carouselContent), (error) => {
    assert.ok(error instanceof UnsupportedContentError);
    assert.equal(error.field, "steps");
    return true;
  });
});

test("all five mapper error classes have a readable, non-generic message", () => {
  const cases = [
    ["unknown-template.json", UnknownTemplateError],
    ["missing-layer.json", MissingLayerError],
    ["duplicate-layer.json", DuplicateLayerMappingError],
    ["invalid-payload.json", TemplatedPayloadValidationError],
  ];
  for (const [fixture, ErrorClass] of cases) {
    try {
      mapCarouselToTemplatedPayload(loadFixture(fixture));
      assert.fail(`expected ${fixture} to throw`);
    } catch (error) {
      assert.ok(error instanceof ErrorClass, `expected ${fixture} to throw ${ErrorClass.name}, got ${error.constructor.name}`);
      assert.notEqual(error.message.trim(), "");
      assert.notEqual(error.message, "validation failed");
    }
  }
});

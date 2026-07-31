import test from "node:test";
import assert from "node:assert/strict";
import { checkCarouselContentShape } from "../../src/carousel-content-shape.mjs";

function validSlides() {
  return [
    { slide_type: "cover", content: { eyebrow_text: "A", headline_text: "B", body_text: "C" } },
    {
      slide_type: "content",
      content: { eyebrow_text: "A", headline_text: "B", body_text: "C", list_items: ["1", "2", "3"] },
    },
    {
      slide_type: "statistic",
      content: { eyebrow_text: "A", stat_value: "50%", supporting_stat_text: "B", stat_caption: "C" },
    },
    { slide_type: "quote", content: { quote_text: "A", attribution_name: "B", attribution_role: "C" } },
    {
      slide_type: "infographic",
      content: {
        eyebrow_text: "A",
        headline_text: "B",
        steps: [
          { title: "1", description: "1" },
          { title: "2", description: "2" },
          { title: "3", description: "3" },
          { title: "4", description: "4" },
        ],
      },
    },
    {
      slide_type: "cta",
      content: { eyebrow_text: "A", headline_text: "B", body_text: "C", button_label: "D" },
    },
  ];
}

test("a fully valid six-slide carousel has no issues", () => {
  const report = checkCarouselContentShape({ slides: validSlides() });
  assert.equal(report.ok, true, JSON.stringify(report.issues));
});

test("fewer than six slides is a slide-count issue", () => {
  const slides = validSlides().slice(0, 5);
  const report = checkCarouselContentShape({ slides });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "slide-count"));
});

test("slides out of order is a slide-order issue", () => {
  const slides = validSlides();
  [slides[0], slides[1]] = [slides[1], slides[0]];
  const report = checkCarouselContentShape({ slides });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "slide-order"));
});

test("a blank required field is rejected even though it's schema-valid (non-empty type)", () => {
  const slides = validSlides();
  slides[0].content.headline_text = "   ";
  const report = checkCarouselContentShape({ slides });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "blank-field" && i.message.includes("headline_text")));
});

test("content slide with only 2 list_items fails the array-length check", () => {
  const slides = validSlides();
  slides[1].content.list_items = ["only one"];
  const report = checkCarouselContentShape({ slides });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "array-length" && i.message.includes("list_items")));
});

test("infographic with only 3 steps fails the array-length check", () => {
  const slides = validSlides();
  slides[4].content.steps.pop();
  const report = checkCarouselContentShape({ slides });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "array-length" && i.message.includes("steps")));
});

test("infographic step missing a description fails a blank-nested-field check", () => {
  const slides = validSlides();
  delete slides[4].content.steps[0].description;
  const report = checkCarouselContentShape({ slides });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "blank-nested-field"));
});

test("an unrecognized slide_type is reported distinctly", () => {
  const slides = validSlides();
  slides[0] = { slide_type: "not-a-real-type", content: {} };
  const report = checkCarouselContentShape({ slides });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "unknown-slide-type"));
});

test("collects multiple issues across multiple slides at once", () => {
  const slides = validSlides();
  slides[0].content.headline_text = "";
  slides[3].content.attribution_name = "";
  const report = checkCarouselContentShape({ slides });
  assert.equal(report.ok, false);
  assert.ok(report.issues.length >= 2);
});

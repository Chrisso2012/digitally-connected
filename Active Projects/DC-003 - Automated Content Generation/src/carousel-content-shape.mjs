// DC-003-I004 — Carousel Content Object per-slide-type shape checks.
//
// Runs only after generic schema validation has already passed (see
// carousel-content-validator.mjs) — this module checks what
// carousel-content.schema.json deliberately leaves generic: whether each
// slide's `content` actually has the fields its slide_type requires, in
// the right shapes, non-blank. Reads its rules from
// carousel-slide-spec.mjs, the same source the Prompt Builder reads from,
// so what the LLM is asked for and what gets accepted can never drift
// apart. Mirrors the same "collect every issue" pattern as
// topic-package-readiness.mjs and integrity-checks.mjs.

import { SLIDE_ORDER, SLIDE_CONTENT_SPEC } from "./carousel-slide-spec.mjs";

function isBlank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function checkSlideFields(slide, index, issues) {
  const spec = SLIDE_CONTENT_SPEC[slide.slide_type];
  if (!spec) {
    issues.push({ check: "unknown-slide-type", message: `slide[${index}] has an unrecognized slide_type "${slide.slide_type}"` });
    return;
  }

  const content = slide.content ?? {};

  for (const field of spec.fields ?? []) {
    if (isBlank(content[field])) {
      issues.push({ check: "blank-field", message: `slide[${index}] (${slide.slide_type}): "${field}" is blank or missing` });
    }
  }

  for (const [field, rule] of Object.entries(spec.arrayFields ?? {})) {
    const value = content[field];
    if (!Array.isArray(value) || value.length < rule.min || value.length > rule.max) {
      issues.push({
        check: "array-length",
        message: `slide[${index}] (${slide.slide_type}): "${field}" must be an array of ${rule.min}-${rule.max} items`,
      });
    } else if (value.some(isBlank)) {
      issues.push({ check: "blank-array-item", message: `slide[${index}] (${slide.slide_type}): "${field}" has blank entries` });
    }
  }

  for (const [field, rule] of Object.entries(spec.objectArrayFields ?? {})) {
    const value = content[field];
    if (!Array.isArray(value) || value.length !== rule.exact) {
      issues.push({
        check: "array-length",
        message: `slide[${index}] (${slide.slide_type}): "${field}" must be an array of exactly ${rule.exact} items`,
      });
      continue;
    }
    value.forEach((item, itemIndex) => {
      for (const subField of rule.fields) {
        if (!item || isBlank(item[subField])) {
          issues.push({
            check: "blank-nested-field",
            message: `slide[${index}] (${slide.slide_type}): "${field}[${itemIndex}].${subField}" is blank or missing`,
          });
        }
      }
    });
  }
}

/**
 * Runs every per-slide-type content check against a schema-valid Carousel
 * Content Object. Returns { ok, issues } — never throws on its own.
 */
export function checkCarouselContentShape(carouselContent) {
  const issues = [];
  const slides = Array.isArray(carouselContent?.slides) ? carouselContent.slides : [];

  if (slides.length !== SLIDE_ORDER.length) {
    issues.push({ check: "slide-count", message: `expected exactly ${SLIDE_ORDER.length} slides, got ${slides.length}` });
  }

  slides.forEach((slide, index) => checkSlideFields(slide, index, issues));

  const presentOrder = slides.map((slide) => slide.slide_type);
  if (JSON.stringify(presentOrder) !== JSON.stringify(SLIDE_ORDER)) {
    issues.push({
      check: "slide-order",
      message: `expected slide order [${SLIDE_ORDER.join(", ")}], got [${presentOrder.join(", ")}]`,
    });
  }

  return { ok: issues.length === 0, issues };
}

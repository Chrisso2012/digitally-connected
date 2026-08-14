// DC-003-I035 — browser-based capacity validation. Implements the
// `production_authority.capacity_validation_required: true` promise
// carousel-content-package.schema.json already declares but does not
// itself enforce (see this milestone's own investigation report,
// "Layout/capacity controls: ADJUST").
//
// Deliberately NOT a character-count heuristic — measures the REAL
// rendered DOM, after real fonts/images are ready, using the real
// browser's own layout engine: every element the templates mark with
// `data-capacity-field`/`data-capacity-axis` (carousel-renderer-templates.mjs)
// is checked for scrollHeight>clientHeight (vertical) or
// scrollWidth>clientWidth (horizontal) — genuine overflow, not a guess.
// Never truncates, resizes, or rewrites anything; only reports.

import { CarouselCapacityValidationError } from "./carousel-renderer-errors.mjs";

// DC-003-I035 — empirically measured (not guessed): a text block that
// visually fits entirely within N line-boxes can still report
// scrollHeight a few CSS pixels taller than clientHeight, even with zero
// extra lines — confirmed directly by inspecting a genuine 2-line
// headline ("The Myth of the Dead Database", Noto Sans 700 30px/1.15):
// getClientRects() showed exactly one 69px-tall box (2 lines x 34.5px
// line-height, matching CSS to the pixel) while scrollHeight read 72px.
// This is the font's own glyph ascent/descent slightly exceeding its
// nominal CSS line-box, a standard, harmless browser text-metrics
// behaviour — not real overflow. A genuine extra line adds a full
// line-height (30+ CSS px here), far beyond this tolerance, so this
// value only absorbs measurement noise, never masks a real capacity
// failure.
const OVERFLOW_TOLERANCE_PX = 6;

// Runs inside the browser page via page.evaluate() — must be a plain,
// serialisable function (no closures over Node-side values).
function collectOverflowInBrowser(tolerancePx) {
  const elements = Array.from(document.querySelectorAll("[data-capacity-field]"));
  return elements.map((el) => {
    const field = el.getAttribute("data-capacity-field");
    const axis = el.getAttribute("data-capacity-axis");
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const scrollWidth = el.scrollWidth;
    const clientWidth = el.clientWidth;
    const verticalOverflow = scrollHeight > clientHeight + tolerancePx;
    const horizontalOverflow = scrollWidth > clientWidth + tolerancePx;
    const overflowed = axis === "horizontal" ? horizontalOverflow : verticalOverflow;
    return { field, axis, scrollHeight, clientHeight, scrollWidth, clientWidth, overflowed };
  });
}

/**
 * Checks every `[data-capacity-field]` element on the given Playwright
 * `page` for real DOM overflow on its designated axis. Never mutates the
 * page. Returns nothing on success.
 *
 * slideNumber/template — used only to build a precise error.
 *
 * Throws CarouselCapacityValidationError (naming slide number, template,
 * field, and failure type for every overflowing field on this one
 * slide) when any designated field overflows its container.
 */
export async function checkPageCapacity(page, { slideNumber, template }) {
  const results = await page.evaluate(collectOverflowInBrowser, OVERFLOW_TOLERANCE_PX);

  const violations = results
    .filter((r) => r.overflowed)
    .map((r) => ({
      slideNumber,
      template,
      field: r.field,
      failureType: r.axis === "horizontal" ? "horizontal_overflow" : "vertical_overflow",
      scrollHeight: r.scrollHeight,
      clientHeight: r.clientHeight,
      scrollWidth: r.scrollWidth,
      clientWidth: r.clientWidth,
    }));

  if (violations.length > 0) {
    throw new CarouselCapacityValidationError(violations);
  }
}

// DC-003-I035.2 — real-browser geometry regression coverage for the
// multi-line headline emphasis collision fix. A pure DOM/unit assertion
// (string-matching generated HTML) cannot prove two rendered lines don't
// physically overlap — this requires a real browser laying out real text
// with the real font (Noto Sans), then measuring actual element geometry
// (Range.getClientRects() / getBoundingClientRect()), the same
// methodology used to diagnose the original defect.
//
// Root cause (see carousel-renderer-brand.mjs's own HEADLINE_LINE_HEIGHT_WITH_EMPHASIS
// comment for the full account): `.headline`'s line-height (1.15) is
// tighter than Noto Sans 700's own natural per-line content height at
// 26px (measured ~1.3846x font-size) — invisible for plain text, but a
// <mark>'s own inline background paints across that same natural
// per-line box, so on a multi-line headline it visibly bled into the
// descenders of the line above. Fixed via a scoped `.headline-has-emphasis`
// class (line-height 1.45), applied only when a headline actually
// contains an emphasis mark.
//
// Requires a real Chromium binary — see README "HTML Carousel Renderer".

import test from "node:test";
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { buildContentSlideHtml, buildCloseBlackSlideHtml } from "../../src/carousel-renderer-templates.mjs";
import { resolveChromiumExecutablePath } from "../../src/carousel-renderer-config.mjs";

const INDUSTRY_SERIES = "Real Estate Industry Series";

function contentSlide(overrides = {}) {
  return {
    slide_number: 6,
    role: "content",
    template: "content_white",
    industry_series: INDUSTRY_SERIES,
    body: "Body copy here.",
    image_layout: "none",
    emphasis_instructions: [],
    ...overrides,
  };
}

function closeSlide(overrides = {}) {
  return {
    slide_number: 7,
    role: "close",
    template: "close_black",
    industry_series: INDUSTRY_SERIES,
    body: "Body copy here.",
    soft_cta: "See more.",
    emphasis_instructions: [],
    ...overrides,
  };
}

// Measures, for the FIRST <mark> in .headline, whether the wrapped text
// line immediately preceding it (if any) physically overlaps the mark's
// own background box. Returns null for "no preceding line" (mark is on
// the first line) — collision is only possible when there IS a line
// above the mark.
async function measureHeadlineMarkOverlap(page, html) {
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);

  return page.evaluate(() => {
    const headline = document.querySelector(".headline");
    const mark = headline.querySelector("mark.emphasis-highlight");
    if (!mark) return { hasMark: false };

    let prevNode = mark.previousSibling;
    while (prevNode && prevNode.nodeType !== Node.TEXT_NODE) prevNode = prevNode.previousSibling;

    const markRect = mark.getBoundingClientRect();
    if (!prevNode || prevNode.textContent.trim() === "") {
      return { hasMark: true, precedingLineBottom: null, markTop: markRect.top, overlap: null };
    }

    const range = document.createRange();
    range.selectNodeContents(prevNode);
    const rects = Array.from(range.getClientRects()).filter((r) => r.bottom <= markRect.top + 1);
    const precedingLineBottom = rects.length ? Math.max(...rects.map((r) => r.bottom)) : null;

    return {
      hasMark: true,
      precedingLineBottom,
      markTop: markRect.top,
      overlap: precedingLineBottom === null ? null : precedingLineBottom - markRect.top,
      hasEmphasisClass: headline.classList.contains("headline-has-emphasis"),
      headlineLineHeight: getComputedStyle(headline).lineHeight,
    };
  });
}

test("real-browser geometry: content_white headline highlight on the 2nd line does not overlap the line above (the real production defect)", async (t) => {
  const browser = await chromium.launch({ executablePath: resolveChromiumExecutablePath(), args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 420, height: 525 } });

  const html = buildContentSlideHtml(
    contentSlide({
      headline: "Your appraisal history is a source of future listings.",
      emphasis_instructions: [{ phrase: "source of future listings", style: "highlight" }],
    }),
    {}
  );

  const result = await measureHeadlineMarkOverlap(page, html);
  assert.equal(result.hasMark, true);
  assert.equal(result.hasEmphasisClass, true);
  assert.ok(result.precedingLineBottom !== null, "expected the highlighted phrase to be on a wrapped second line for this test to be meaningful");
  assert.ok(result.overlap <= 0, `expected no physical overlap between the highlight and the line above (measured overlap: ${result.overlap}px)`);
});

test("real-browser geometry: content_orange headline highlight on the 2nd line does not overlap the line above (cream override + line-height fix together)", async (t) => {
  const browser = await chromium.launch({ executablePath: resolveChromiumExecutablePath(), args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 420, height: 525 } });

  const html = buildContentSlideHtml(
    contentSlide({
      template: "content_orange",
      headline: "Your appraisal history is a source of future listings.",
      emphasis_instructions: [{ phrase: "source of future listings", style: "highlight" }],
    }),
    {}
  );

  const result = await measureHeadlineMarkOverlap(page, html);
  assert.equal(result.hasMark, true);
  assert.ok(result.precedingLineBottom !== null);
  assert.ok(result.overlap <= 0, `expected no physical overlap (measured: ${result.overlap}px)`);
});

test("real-browser geometry: close_black headline highlight on the 2nd line does not overlap the line above", async (t) => {
  const browser = await chromium.launch({ executablePath: resolveChromiumExecutablePath(), args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 420, height: 525 } });

  const html = buildCloseBlackSlideHtml(
    closeSlide({
      headline: "Your appraisal history is a source of future listings.",
      emphasis_instructions: [{ phrase: "source of future listings", style: "highlight" }],
    })
  );

  const result = await measureHeadlineMarkOverlap(page, html);
  assert.equal(result.hasMark, true);
  assert.ok(result.precedingLineBottom !== null);
  assert.ok(result.overlap <= 0, `expected no physical overlap (measured: ${result.overlap}px)`);
});

test("real-browser geometry: a highlighted phrase on the FIRST line of a multi-line headline also renders without collision (checked in both directions)", async (t) => {
  const browser = await chromium.launch({ executablePath: resolveChromiumExecutablePath(), args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 420, height: 525 } });

  // Short enough that the highlighted phrase's own line is the first
  // line, with the remaining copy wrapping to a second line below it.
  const html = buildContentSlideHtml(
    contentSlide({
      headline: "This first line is highlighted, then more text continues.",
      emphasis_instructions: [{ phrase: "This first line is highlighted", style: "highlight" }],
    }),
    {}
  );

  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);

  const result = await page.evaluate(() => {
    const headline = document.querySelector(".headline");
    const mark = headline.querySelector("mark.emphasis-highlight");
    const markRect = mark.getBoundingClientRect();

    // Text node after the mark — the remainder of the headline, which
    // should wrap onto the line(s) below the mark.
    let nextNode = mark.nextSibling;
    while (nextNode && nextNode.nodeType !== Node.TEXT_NODE) nextNode = nextNode.nextSibling;
    if (!nextNode) return { hasFollowingLine: false };

    const range = document.createRange();
    range.selectNodeContents(nextNode);
    // Only rects genuinely on a line BELOW the mark's own line (top >=
    // the mark's own bottom) — excludes any same-line trailing rect
    // (e.g. immediate punctuation right after the mark, still on its line).
    const rects = Array.from(range.getClientRects()).filter((r) => r.top >= markRect.bottom - 1);
    const followingLineTop = rects.length ? Math.min(...rects.map((r) => r.top)) : null;

    return {
      hasFollowingLine: followingLineTop !== null,
      markBottom: markRect.bottom,
      followingLineTop,
      overlap: followingLineTop === null ? null : markRect.bottom - followingLineTop,
    };
  });

  assert.equal(result.hasFollowingLine, true, "expected the headline to wrap to a line below the highlighted first line for this test to be meaningful");
  assert.ok(result.overlap <= 0, `expected the mark's own background not to overlap the line below it (measured overlap: ${result.overlap}px)`);
});

test("real-browser geometry: a multi-line headline with NO emphasis keeps the original tighter line-height (unaffected by this fix)", async (t) => {
  const browser = await chromium.launch({ executablePath: resolveChromiumExecutablePath(), args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 420, height: 525 } });

  const html = buildContentSlideHtml(
    contentSlide({
      headline: "A perfectly ordinary two line headline with no emphasis in it at all.",
      emphasis_instructions: [],
    }),
    {}
  );

  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);

  const result = await page.evaluate(() => {
    const headline = document.querySelector(".headline");
    return {
      hasEmphasisClass: headline.classList.contains("headline-has-emphasis"),
      lineHeight: getComputedStyle(headline).lineHeight,
    };
  });

  assert.equal(result.hasEmphasisClass, false);
  assert.equal(result.lineHeight, "29.9px"); // 26px * 1.15, the original, unchanged base line-height
});

test("real-browser geometry: a single-line highlighted headline renders the mark correctly with no adjacent line to collide with", async (t) => {
  const browser = await chromium.launch({ executablePath: resolveChromiumExecutablePath(), args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 420, height: 525 } });

  const html = buildContentSlideHtml(
    contentSlide({
      headline: "Short highlighted headline.",
      emphasis_instructions: [{ phrase: "highlighted", style: "highlight" }],
    }),
    {}
  );

  const result = await measureHeadlineMarkOverlap(page, html);
  assert.equal(result.hasMark, true);
  assert.equal(result.hasEmphasisClass, true);
  assert.equal(result.precedingLineBottom, null, "a single-line headline has no preceding line to collide with");
});

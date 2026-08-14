// DC-003-I035 — regression coverage for carousel-renderer-templates.mjs:
// template dispatch by the slide's own `template` field, image_layout
// none/corner/strip markup, content_orange rendering without an image, and
// direct regression tests for three CSS bugs found and fixed during this
// milestone's own development: (1) FONT_FAMILY's literal double quotes
// silently truncated an inline style="..." attribute — fixed by moving
// the soft_cta's styling into a real .soft-cta CSS class; (2) the
// series-label rule-icon (tick/bar/tick) had its colour hardcoded to
// ACCENT in the shared stylesheet, so on content_orange (background ===
// ACCENT) it rendered orange-on-orange and disappeared — fixed by always
// giving it the same labelColor already computed for its sibling label
// text; (3) the highlight emphasis mark's background (EMPHASIS_HIGHLIGHT_BACKGROUND,
// also ACCENT) was likewise invisible against content_orange's own page
// background — found during the first real production render — fixed
// with a smallest-possible, background-specific override
// (.slide-content-orange .emphasis-highlight) that swaps in a pale
// cream (EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE) only on that one
// template, leaving the strike treatment and every other template's
// highlight untouched.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSlideHtml,
  buildCoverBlackSlideHtml,
  buildContentSlideHtml,
  buildCloseBlackSlideHtml,
} from "../../src/carousel-renderer-templates.mjs";
import { ACCENT, TEXT_PRIMARY_ON_ORANGE, EMPHASIS_HIGHLIGHT_BACKGROUND, EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE } from "../../src/carousel-renderer-brand.mjs";

function labelRowColors(html) {
  const labelMatch = html.match(/<span class="label" style="color:([^"]+)"/);
  const tickColors = [...html.matchAll(/<span class="tick" style="background:([^"]+)"><\/span>/g)].map((m) => m[1]);
  const barMatch = html.match(/<span class="bar" style="background:([^"]+)"><\/span>/);
  return { label: labelMatch && labelMatch[1], ticks: tickColors, bar: barMatch && barMatch[1] };
}

const INDUSTRY_SERIES = "Real Estate Industry Series";

function coverSlide(overrides = {}) {
  return {
    slide_number: 1,
    role: "cover",
    template: "cover_black",
    industry_series: INDUSTRY_SERIES,
    headline: "The Myth of the Dead Database",
    supporting_line: "Why timing, not interest, is the real reason old enquiries go quiet.",
    ...overrides,
  };
}

function contentSlide(template, overrides = {}) {
  return {
    slide_number: 2,
    role: "content",
    template,
    industry_series: INDUSTRY_SERIES,
    headline: "Every Enquiry Already Cost You Something",
    body: "Marketing spend, staff time and trust were already paid for.",
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
    headline: "One Question Reopens the Conversation",
    body: "Ask every old enquiry: has anything changed since we last spoke?",
    soft_cta: "See what's already in your CRM.",
    emphasis_instructions: [],
    ...overrides,
  };
}

test("buildSlideHtml dispatches to the correct template by slide.template", () => {
  assert.match(buildSlideHtml(coverSlide()), /class="cover-content"/);
  assert.match(buildSlideHtml(contentSlide("content_white")), /class="content-block"/);
  assert.match(buildSlideHtml(contentSlide("content_orange")), /class="content-block"/);
  assert.match(buildSlideHtml(closeSlide()), /class="close-content"/);
});

test("buildSlideHtml throws for an unknown template", () => {
  assert.throws(() => buildSlideHtml({ ...contentSlide("content_white"), template: "not_a_real_template" }), /unknown template/);
});

test("content_orange renders without an image and without accessing any image markup", () => {
  const html = buildContentSlideHtml(contentSlide("content_orange"), {});
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Every Enquiry Already Cost You Something/);
});

test("image_layout:none renders without an image tag even when no imageDataUri is supplied", () => {
  const html = buildContentSlideHtml(contentSlide("content_white", { image_layout: "none" }), {});
  assert.doesNotMatch(html, /<img/);
});

test("image_layout:corner renders the corner image region", () => {
  const html = buildContentSlideHtml(contentSlide("content_white", { image_layout: "corner" }), { imageDataUri: "data:image/png;base64,AAAA" });
  assert.match(html, /class="image-corner"/);
  assert.doesNotMatch(html, /class="image-strip"/);
});

test("image_layout:strip renders the strip image region", () => {
  const html = buildContentSlideHtml(contentSlide("content_white", { image_layout: "strip" }), { imageDataUri: "data:image/png;base64,AAAA" });
  assert.match(html, /class="image-strip"/);
  assert.doesNotMatch(html, /class="image-corner"/);
});

test("every capacity-checked field carries data-capacity-field/data-capacity-axis", () => {
  assert.match(buildCoverBlackSlideHtml(coverSlide()), /data-capacity-field="headline" data-capacity-axis="vertical"/);
  assert.match(buildCoverBlackSlideHtml(coverSlide()), /data-capacity-field="supporting_line" data-capacity-axis="vertical"/);
  assert.match(buildCloseBlackSlideHtml(closeSlide()), /data-capacity-field="soft_cta" data-capacity-axis="horizontal"/);
});

test("regression: soft_cta styling lives in the .soft-cta CSS class, never a quote-breaking inline style", () => {
  const html = buildCloseBlackSlideHtml(closeSlide());
  // The bug: FONT_FAMILY's literal quotes truncated an inline style="..."
  // attribute mid-declaration. Guard: the CTA element's own inline style
  // attribute must be quote-free (only the safe "margin-top:18px;" value),
  // and the real background colour must be declared in the shared <style>
  // block's .soft-cta rule, not inline.
  const ctaMatch = html.match(/<div class="soft-cta"[^>]*style="([^"]*)"/);
  assert.ok(ctaMatch, "expected a .soft-cta div with an inline style attribute");
  assert.equal(ctaMatch[1], "margin-top:18px;");
  assert.match(html, new RegExp(`\\.soft-cta \\{[^}]*background: ${ACCENT.replace("#", "#")}`));
});

test("regression: the series-label rule-icon always matches its own sibling label text colour on every template", () => {
  const cases = [
    buildCoverBlackSlideHtml(coverSlide()),
    buildContentSlideHtml(contentSlide("content_white"), {}),
    buildContentSlideHtml(contentSlide("content_orange"), {}),
    buildCloseBlackSlideHtml(closeSlide()),
  ];
  for (const html of cases) {
    const { label, ticks, bar } = labelRowColors(html);
    assert.ok(label, "expected a label-row with an inline label colour");
    assert.equal(ticks.length, 2, "expected both tick spans to carry an inline background colour");
    assert.equal(ticks[0], label);
    assert.equal(ticks[1], label);
    assert.equal(bar, label);
  }
});

test("regression: on content_orange, the rule-icon uses the dark contrasting colour, never orange-on-orange", () => {
  const html = buildContentSlideHtml(contentSlide("content_orange"), {});
  const { label, ticks, bar } = labelRowColors(html);
  assert.equal(label, TEXT_PRIMARY_ON_ORANGE);
  assert.notEqual(label, ACCENT);
  for (const tick of ticks) {
    assert.equal(tick, TEXT_PRIMARY_ON_ORANGE);
    assert.notEqual(tick, ACCENT);
  }
  assert.equal(bar, TEXT_PRIMARY_ON_ORANGE);
  assert.notEqual(bar, ACCENT);
});

test("on dark/white templates, the rule-icon still uses ACCENT (unchanged treatment)", () => {
  for (const html of [buildCoverBlackSlideHtml(coverSlide()), buildContentSlideHtml(contentSlide("content_white"), {}), buildCloseBlackSlideHtml(closeSlide())]) {
    const { label, ticks, bar } = labelRowColors(html);
    assert.equal(label, ACCENT);
    assert.deepEqual(ticks, [ACCENT, ACCENT]);
    assert.equal(bar, ACCENT);
  }
});

test("the shared stylesheet no longer hardcodes a rule-icon background (colour is always applied inline per slide)", () => {
  const html = buildContentSlideHtml(contentSlide("content_orange"), {});
  assert.doesNotMatch(html, /\.rule-icon \.tick \{[^}]*background/);
  assert.doesNotMatch(html, /\.rule-icon \.bar \{[^}]*background/);
});

test("regression: content_orange's own EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE is visibly distinct from its own page background", () => {
  // The bug this guards against: EMPHASIS_HIGHLIGHT_BACKGROUND === ACCENT
  // === ORANGE_BACKGROUND, so the base highlight colour is invisible on
  // a content_orange page. The override token must not be that same
  // colour, and must not be the plain base highlight colour either
  // (otherwise the override would be a no-op).
  assert.notEqual(EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE, ACCENT);
  assert.notEqual(EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE, EMPHASIS_HIGHLIGHT_BACKGROUND);
});

test("regression: highlight emphasis on content_orange renders with the cream override, scoped to that slide only", () => {
  const slide = contentSlide("content_orange", {
    body: "The old lens was interested or not. The better lens is ready or not ready yet.",
    emphasis_instructions: [
      { phrase: "ready or not ready yet", style: "highlight" },
      { phrase: "interested or not", style: "strike" },
    ],
  });
  const html = buildContentSlideHtml(slide, {});

  // The slide's own <section> carries the scoping class.
  assert.match(html, /<section class="slide slide-content-orange"/);

  // The mark itself is still the same shared .emphasis-highlight element
  // (text colour/padding/border-radius untouched) — only its background
  // is overridden, and only inside a .slide-content-orange scope.
  assert.match(html, /<mark class="emphasis-highlight">ready or not ready yet<\/mark>/);
  assert.match(html, new RegExp(`\\.slide-content-orange \\.emphasis-highlight \\{ background: ${EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE} ?; ?\\}`));

  // Strike treatment is completely unaffected by this fix.
  assert.match(html, /<s class="emphasis-strike">interested or not<\/s>/);
});

test("regression: highlight emphasis on content_white and close_black is unchanged by the content_orange fix", () => {
  const whiteHtml = buildContentSlideHtml(
    contentSlide("content_white", { body: "Speed matters most.", emphasis_instructions: [{ phrase: "matters most", style: "highlight" }] }),
    {}
  );
  const closeHtml = buildCloseBlackSlideHtml(
    closeSlide({ body: "Ask every old enquiry a question.", emphasis_instructions: [{ phrase: "a question", style: "highlight" }] })
  );

  for (const html of [whiteHtml, closeHtml]) {
    // No content_orange scoping class or override rule leaks into other templates.
    assert.doesNotMatch(html, /slide-content-orange/);
    assert.doesNotMatch(html, new RegExp(EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE));
  }
  // The shared, un-scoped rule (still ACCENT) is what actually applies here.
  assert.match(whiteHtml, new RegExp(`\\.emphasis-highlight \\{\\s*background: ${EMPHASIS_HIGHLIGHT_BACKGROUND};`));
  assert.match(closeHtml, new RegExp(`\\.emphasis-highlight \\{\\s*background: ${EMPHASIS_HIGHLIGHT_BACKGROUND};`));
});

// --- DC-003-I035.1 — headline emphasis (fixes a real render crash) --------
// A real production render of ccp_c1894dc4d8b04563 threw because the
// renderer used to apply emphasis only to slide.body — an approved phrase
// living only in the headline crashed renderTextWithEmphasisHtml()'s own
// defensive "should never happen" check. Fixed by resolving each
// instruction to whichever field (headline/body) it actually matches
// (carousel-content-package-emphasis.mjs's partitionEmphasisInstructionsByField,
// the SAME resolver the factory validates against) and rendering each
// field with only its own instructions.

test("regression: a highlight phrase in a content-slide headline renders successfully (the real production defect)", () => {
  const slide = contentSlide("content_white", {
    headline: "Your appraisal history is a source of future listings.",
    body: "Not a record of past misses.",
    emphasis_instructions: [{ phrase: "source of future listings", style: "highlight" }],
  });
  const html = buildContentSlideHtml(slide, {});
  assert.match(html, /<h2 class="headline"[^>]*>Your appraisal history is a <mark class="emphasis-highlight">source of future listings<\/mark>\.<\/h2>/);
});

test("regression: a strike phrase in a content-slide headline renders successfully", () => {
  const slide = contentSlide("content_white", {
    headline: "A stalled appraisal doesn't look like a dead end.",
    body: "It looks like an asset waiting on timing.",
    emphasis_instructions: [{ phrase: "dead end", style: "strike" }],
  });
  const html = buildContentSlideHtml(slide, {});
  assert.match(html, /<h2 class="headline"[^>]*>A stalled appraisal doesn&#39;t look like a <s class="emphasis-strike">dead end<\/s>\.<\/h2>/);
});

test("regression: headline and body emphasis both render correctly on the same slide", () => {
  const slide = contentSlide("content_white", {
    headline: "Your appraisal history is a source of future listings.",
    body: "Not a record of past misses. Who is ready today?",
    emphasis_instructions: [
      { phrase: "source of future listings", style: "highlight" },
      { phrase: "ready today", style: "strike" },
    ],
  });
  const html = buildContentSlideHtml(slide, {});
  assert.match(html, /<mark class="emphasis-highlight">source of future listings<\/mark>/);
  assert.match(html, /<s class="emphasis-strike">ready today<\/s>/);
});

test("regression: existing body-only highlight/strike still render exactly as before (no headline instructions present)", () => {
  const slide = contentSlide("content_white", {
    headline: "Plain headline with no emphasis field at all.",
    body: "The old lens was interested or not. The better lens is ready or not ready yet.",
    emphasis_instructions: [
      { phrase: "interested or not", style: "strike" },
      { phrase: "ready or not ready yet", style: "highlight" },
    ],
  });
  const html = buildContentSlideHtml(slide, {});
  assert.match(html, /<h2 class="headline"[^>]*>Plain headline with no emphasis field at all\.<\/h2>/);
  assert.match(html, /<s class="emphasis-strike">interested or not<\/s>/);
  assert.match(html, /<mark class="emphasis-highlight">ready or not ready yet<\/mark>/);
});

test("regression: close-slide headline emphasis renders correctly", () => {
  const slide = closeSlide({
    headline: "Not mass outreach. Not pressure.",
    body: "Just a structured, respectful way of asking.",
    emphasis_instructions: [{ phrase: "Not mass outreach", style: "highlight" }],
  });
  const html = buildCloseBlackSlideHtml(slide);
  assert.match(html, /<h1 class="headline"[^>]*><mark class="emphasis-highlight">Not mass outreach<\/mark>\. Not pressure\.<\/h1>/);
});

test("cover_black remains unsupported for emphasis — supporting_line always renders as plain escaped text", () => {
  // cover_black has no emphasis_instructions field in the CCP schema at
  // all; buildCoverBlackSlideHtml() never reads or applies one, even if
  // a caller hands it a slide-like object that happens to carry one.
  const slide = { ...coverSlide(), emphasis_instructions: [{ phrase: "interest", style: "highlight" }] };
  const html = buildCoverBlackSlideHtml(slide);
  assert.doesNotMatch(html, /<mark class="emphasis-highlight">/);
  assert.doesNotMatch(html, /<s class="emphasis-strike">/);
  assert.match(html, /Why timing, not interest, is the real reason old enquiries go quiet\./);
});

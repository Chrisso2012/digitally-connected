// DC-003-I035 — regression coverage for carousel-renderer-templates.mjs:
// template dispatch by the slide's own `template` field, image_layout
// none/corner/strip markup, content_orange rendering without an image, and
// a direct regression test for the CSS-quote-truncation bug found and fixed
// during this milestone's own development (FONT_FAMILY's literal double
// quotes silently truncated an inline style="..." attribute — fixed by
// moving the soft_cta's styling into a real .soft-cta CSS class).

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSlideHtml,
  buildCoverBlackSlideHtml,
  buildContentSlideHtml,
  buildCloseBlackSlideHtml,
} from "../../src/carousel-renderer-templates.mjs";
import { ACCENT } from "../../src/carousel-renderer-brand.mjs";

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

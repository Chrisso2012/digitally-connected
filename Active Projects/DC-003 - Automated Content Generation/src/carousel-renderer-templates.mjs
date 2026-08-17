// DC-003-I035 — the four deterministic HTML/CSS template families:
// cover_black, content_white, content_orange, close_black. Visual-system
// rules live entirely here (and in carousel-renderer-brand.mjs) — never
// in the Carousel Content Package itself, per the I032.10 architectural
// principle. Pure functions of already-approved data: no copy is ever
// written, rewritten, shortened, or reinterpreted here — every text
// field is escaped and placed verbatim (with only its own approved
// emphasis markup applied via carousel-renderer-emphasis-html.mjs).
//
// Every field that must survive real-DOM capacity validation
// (carousel-renderer-capacity.mjs) is marked with
// `data-capacity-field="<name>"` and `data-capacity-axis="vertical|
// horizontal"` — a stable, generic contract the capacity checker reads
// without hardcoding field/template names itself.
//
// Layout is flow-based (flexbox, wrapping text, bounded containers),
// deliberately NOT the fragile hand-tuned absolute positioning the
// carousel-poc/phase-3-complex-fidelity README itself flags as "the
// wrong foundation for a template meant to be repopulated with
// different copy lengths" — this milestone's own capacity-validation
// gate is what makes flow layout safe: content that would overflow its
// bounded container fails the render instead of silently overlapping.

import { renderTextWithEmphasisHtml } from "./carousel-renderer-emphasis-html.mjs";
import { partitionEmphasisInstructionsByField } from "./carousel-content-package-emphasis.mjs";
import {
  CANVAS_WIDTH_CSS_PX,
  CANVAS_HEIGHT_CSS_PX,
  SAFE_MARGIN_X_PX,
  DARK_BACKGROUND,
  ACCENT,
  TEXT_PRIMARY_ON_DARK,
  TEXT_SECONDARY_ON_DARK,
  LIGHT_BACKGROUND,
  TEXT_PRIMARY_ON_LIGHT,
  TEXT_SECONDARY_ON_LIGHT,
  ORANGE_BACKGROUND,
  TEXT_PRIMARY_ON_ORANGE,
  TEXT_SECONDARY_ON_ORANGE,
  FONT_FAMILY,
  FONT_WEIGHT_HEADLINE,
  FONT_WEIGHT_LABEL,
  FONT_WEIGHT_BODY,
  EMPHASIS_HIGHLIGHT_BACKGROUND,
  EMPHASIS_HIGHLIGHT_TEXT,
  EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE,
  HEADLINE_LINE_HEIGHT_WITH_EMPHASIS,
} from "./carousel-renderer-brand.mjs";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- shared chrome -------------------------------------------------------

function buildLogoHtml() {
  return `<div class="logo"><span>DC</span></div>`;
}

// DC-003-I035 — regression fix: the rule-icon (tick/bar/tick) must always
// share the same contrasting colour as its own label text. It previously
// had its background hardcoded to ACCENT in the shared stylesheet, so on
// content_orange (background: ORANGE_BACKGROUND === ACCENT) the icon
// rendered orange-on-orange and effectively disappeared. Fixed by giving
// it the SAME labelColor already computed per-slide for contrast — never
// a new colour, just applied consistently. Safe as an inline style here:
// every colour token ever passed as labelColor (ACCENT / TEXT_PRIMARY_ON_ORANGE)
// is a quote-free hex string, so it cannot hit the FONT_FAMILY-style
// quote-truncation hazard documented on .soft-cta above.
function buildLabelRowHtml(industrySeries, labelColor) {
  return `
    <div class="label-row" data-capacity-field="industry_series" data-capacity-axis="horizontal">
      <span class="rule-icon">
        <span class="tick" style="background:${labelColor}"></span>
        <span class="bar" style="background:${labelColor}"></span>
        <span class="tick" style="background:${labelColor}"></span>
      </span>
      <span class="label" style="color:${labelColor}">${escapeHtml(industrySeries)}</span>
    </div>`;
}

// Cover/close full-canvas background treatment: a provided image fills
// the entire canvas via object-fit:cover, with a fixed dark gradient
// overlay so text stays readable — deterministic, never a
// creatively-chosen crop (object-position is a single fixed value, not
// tuned per image).
function buildBackgroundLayerHtml(imageDataUri) {
  if (!imageDataUri) return "";
  return `
    <img class="bg-image" src="${imageDataUri}" alt="" />
    <div class="bg-overlay"></div>`;
}

function sharedStyles() {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${CANVAS_WIDTH_CSS_PX}px; height: ${CANVAS_HEIGHT_CSS_PX}px; overflow: hidden; }
    body { font-family: ${FONT_FAMILY}; }
    .slide {
      position: relative;
      width: ${CANVAS_WIDTH_CSS_PX}px;
      height: ${CANVAS_HEIGHT_CSS_PX}px;
      flex: none;
      overflow: hidden;
    }
    .logo {
      position: absolute;
      left: 17px;
      top: 19px;
      width: 22px;
      height: 22px;
      background: ${ACCENT};
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2;
    }
    .logo span {
      font-family: ${FONT_FAMILY};
      font-weight: ${FONT_WEIGHT_LABEL};
      font-size: 9px;
      letter-spacing: 0.02em;
      color: ${TEXT_PRIMARY_ON_LIGHT};
    }
    .label-row {
      display: flex;
      align-items: center;
      gap: 6px;
      max-width: ${CANVAS_WIDTH_CSS_PX - SAFE_MARGIN_X_PX * 2}px;
      overflow: hidden;
      white-space: nowrap;
    }
    .rule-icon { display: flex; align-items: center; width: 14px; height: 6px; flex: none; }
    /* DC-003-I035 — no default background here on purpose: the tick/bar
       colour is always set inline by buildLabelRowHtml() to match its
       own slide's labelColor (see that function's own comment) — a
       stylesheet default previously hardcoded to ACCENT caused the
       icon to render orange-on-orange on content_orange slides. */
    .rule-icon .tick { width: 1px; height: 6px; }
    .rule-icon .bar { flex: 1; height: 1px; }
    .label {
      font-family: ${FONT_FAMILY};
      font-weight: ${FONT_WEIGHT_LABEL};
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .headline {
      font-family: ${FONT_FAMILY};
      font-weight: ${FONT_WEIGHT_HEADLINE};
      line-height: 1.15;
      letter-spacing: -0.01em;
      overflow: hidden;
    }
    /* DC-003-I035.2 — regression fix: 1.15 is TIGHTER than Noto Sans
       700's own natural per-line content height at this font size
       (measured in real Chromium: ~1.3846x font-size vs 1.15x line-box)
       — invisible for plain text, but a <mark>'s own inline background
       paints across that same natural per-line box, so on a multi-line
       headline it visibly bled into the descenders of the line above.
       Scoped via this class (added only when a headline actually
       contains emphasis — see buildContentSlideHtml()/
       buildCloseBlackSlideHtml()) so the vast majority of headlines,
       which have no emphasis at all, keep the original, already
       capacity-validated 1.15 line-height completely unchanged. */
    .headline.headline-has-emphasis {
      line-height: ${HEADLINE_LINE_HEIGHT_WITH_EMPHASIS};
    }
    .body-copy {
      font-family: ${FONT_FAMILY};
      font-weight: ${FONT_WEIGHT_BODY};
      line-height: 1.5;
      overflow: hidden;
    }
    .bg-image {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: 50% 50%;
      z-index: 0;
    }
    .bg-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(to bottom, rgba(15,13,23,0.35) 0%, rgba(15,13,23,0.85) 100%);
      z-index: 1;
    }
    .emphasis-highlight {
      background: ${EMPHASIS_HIGHLIGHT_BACKGROUND};
      color: ${EMPHASIS_HIGHLIGHT_TEXT};
      padding: 0 2px;
      border-radius: 2px;
    }
    .emphasis-strike { text-decoration: line-through; text-decoration-thickness: 1.5px; }
    /* DC-003-I035 — a real bug caught during this milestone's own
       development: FONT_FAMILY contains literal double quotes
       ('"Noto Sans", sans-serif'), which silently truncates any
       double-quoted inline style="..." attribute it's embedded in —
       everything after it in that attribute is dropped by the HTML
       parser (confirmed via a real render: the CTA pill's own
       background/padding/border-radius never appeared, because they
       were declared AFTER font-family in the same inline attribute).
       Fixed at the root, not just patched: any element needing
       FONT_FAMILY now always uses a real CSS class from this shared
       stylesheet, never an inline style="..." attribute. */
    .soft-cta {
      display: inline-flex;
      overflow: hidden;
      white-space: nowrap;
      font-family: ${FONT_FAMILY};
      font-weight: ${FONT_WEIGHT_LABEL};
      font-size: 12px;
      letter-spacing: 0.04em;
      color: ${TEXT_PRIMARY_ON_LIGHT};
      background: ${ACCENT};
      padding: 9px 16px;
      border-radius: 3px;
      max-width: ${CANVAS_WIDTH_CSS_PX - SAFE_MARGIN_X_PX * 2}px;
    }
  `;
}

function pageShell({ bodyBackground, bodyContent }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Carousel Slide</title>
<style>
  ${sharedStyles()}
  html, body { background: ${bodyBackground}; }
</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

// ---- cover_black -----------------------------------------------------

export function buildCoverBlackSlideHtml(slide, { imageDataUri } = {}) {
  const bg = imageDataUri ? buildBackgroundLayerHtml(imageDataUri) : "";
  const content = `
  <section class="slide" style="background:${DARK_BACKGROUND};color:${TEXT_PRIMARY_ON_DARK}">
    ${bg}
    ${buildLogoHtml()}
    <div class="cover-content" style="position:absolute;left:${SAFE_MARGIN_X_PX}px;right:${SAFE_MARGIN_X_PX}px;bottom:44px;z-index:2;">
      ${buildLabelRowHtml(slide.industry_series, ACCENT)}
      <h1 class="headline" data-capacity-field="headline" data-capacity-axis="vertical"
          style="font-size:30px;max-height:150px;margin-top:14px;color:${TEXT_PRIMARY_ON_DARK}">${escapeHtml(slide.headline)}</h1>
      <p class="body-copy" data-capacity-field="supporting_line" data-capacity-axis="vertical"
         style="font-size:14px;max-height:90px;margin-top:16px;color:${TEXT_SECONDARY_ON_DARK}">${escapeHtml(slide.supporting_line)}</p>
    </div>
  </section>`;
  return pageShell({ bodyBackground: DARK_BACKGROUND, bodyContent: content });
}

// ---- content_white / content_orange -----------------------------------

function buildImageRegionHtml(imageLayout, imageDataUri) {
  if (imageLayout === "corner") {
    return `<div class="image-corner"><img src="${imageDataUri}" alt="" /></div>`;
  }
  if (imageLayout === "strip") {
    return `<div class="image-strip"><img src="${imageDataUri}" alt="" /></div>`;
  }
  return "";
}

export function buildContentSlideHtml(slide, { imageDataUri } = {}) {
  const isOrange = slide.template === "content_orange";
  const background = isOrange ? ORANGE_BACKGROUND : LIGHT_BACKGROUND;
  const textPrimary = isOrange ? TEXT_PRIMARY_ON_ORANGE : TEXT_PRIMARY_ON_LIGHT;
  const textSecondary = isOrange ? TEXT_SECONDARY_ON_ORANGE : TEXT_SECONDARY_ON_LIGHT;
  const labelColor = isOrange ? TEXT_PRIMARY_ON_ORANGE : ACCENT;
  const logoOnLight = `<div class="logo" style="background:${isOrange ? TEXT_PRIMARY_ON_ORANGE : ACCENT}"><span style="color:${isOrange ? ORANGE_BACKGROUND : TEXT_PRIMARY_ON_LIGHT}">DC</span></div>`;

  // DC-003-I035.1 — emphasis instructions are resolved to whichever real
  // field (headline or body) they actually match, using the SAME shared
  // resolver the factory already validated every instruction against at
  // import time (carousel-content-package-emphasis.mjs) — never a second,
  // independently-guessed matching system. Each field is rendered with
  // only its own instructions, so renderTextWithEmphasisHtml() never sees
  // a phrase it can't find (that used to crash the render whenever an
  // approved phrase happened to live in the headline instead of the body).
  const { headline: headlineInstructions, body: bodyInstructions } = partitionEmphasisInstructionsByField(
    { headline: slide.headline, body: slide.body },
    slide.emphasis_instructions
  );
  const headlineHtml = renderTextWithEmphasisHtml(slide.headline, headlineInstructions);
  const bodyHtml = renderTextWithEmphasisHtml(slide.body, bodyInstructions);
  const imageRegion = imageDataUri ? buildImageRegionHtml(slide.image_layout, imageDataUri) : "";
  const hasImage = imageDataUri && slide.image_layout !== "none";
  const contentTop = slide.image_layout === "strip" ? 260 : slide.image_layout === "corner" ? 190 : 0;

  const content = `
  <section class="slide${isOrange ? " slide-content-orange" : ""}" style="background:${background};color:${textPrimary}">
    ${imageRegion}
    ${logoOnLight}
    <div class="content-block" style="position:absolute;left:${SAFE_MARGIN_X_PX}px;right:${SAFE_MARGIN_X_PX}px;top:${hasImage ? contentTop : 0}px;bottom:40px;display:flex;flex-direction:column;justify-content:${hasImage ? "flex-start" : "center"};z-index:2;">
      ${buildLabelRowHtml(slide.industry_series, labelColor)}
      <h2 class="headline${headlineInstructions.length > 0 ? " headline-has-emphasis" : ""}" data-capacity-field="headline" data-capacity-axis="vertical"
          style="font-size:26px;max-height:130px;margin-top:12px;color:${textPrimary}">${headlineHtml}</h2>
      <p class="body-copy" data-capacity-field="body" data-capacity-axis="vertical"
         style="font-size:13.5px;max-height:${hasImage ? 130 : 170}px;margin-top:14px;color:${textSecondary}">${bodyHtml}</p>
    </div>
  </section>`;

  const extraStyles = `
    .image-corner { position: absolute; right: ${SAFE_MARGIN_X_PX}px; top: 56px; width: 150px; height: 130px; overflow: hidden; z-index: 1; }
    .image-corner img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 50%; border-radius: 4px; }
    .image-strip { position: absolute; left: 0; right: 0; top: 0; height: 220px; overflow: hidden; z-index: 1; }
    .image-strip img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 50%; }
    ${isOrange ? `
    /* DC-003-I035 — regression fix: EMPHASIS_HIGHLIGHT_BACKGROUND (ACCENT)
       is identical to this template's own page background
       (ORANGE_BACKGROUND === ACCENT), making a highlight mark invisible
       here. Smallest possible background-specific override — only the
       background changes (a pale cream, EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE),
       scoped to content_orange alone via .slide-content-orange; every
       other property (text colour, padding, border-radius) still comes
       from the shared .emphasis-highlight rule above, and .emphasis-strike
       and every other template are completely untouched. */
    .slide-content-orange .emphasis-highlight { background: ${EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE}; }` : ""}
  `;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Carousel Slide</title>
<style>
  ${sharedStyles()}
  ${extraStyles}
  html, body { background: ${background}; }
</style>
</head>
<body>
${content}
</body>
</html>`;
}

// ---- close_black --------------------------------------------------------

export function buildCloseBlackSlideHtml(slide, { imageDataUri } = {}) {
  const bg = imageDataUri ? buildBackgroundLayerHtml(imageDataUri) : "";
  // DC-003-I035.1 — see the identical comment in buildContentSlideHtml()
  // above: instructions resolved per-field via the same shared resolver
  // the factory already validated them against.
  const { headline: headlineInstructions, body: bodyInstructions } = partitionEmphasisInstructionsByField(
    { headline: slide.headline, body: slide.body },
    slide.emphasis_instructions
  );
  const headlineHtml = renderTextWithEmphasisHtml(slide.headline, headlineInstructions);
  const bodyHtml = renderTextWithEmphasisHtml(slide.body, bodyInstructions);
  const content = `
  <section class="slide" style="background:${DARK_BACKGROUND};color:${TEXT_PRIMARY_ON_DARK}">
    ${bg}
    ${buildLogoHtml()}
    <div class="close-content" style="position:absolute;left:${SAFE_MARGIN_X_PX}px;right:${SAFE_MARGIN_X_PX}px;bottom:44px;z-index:2;">
      ${buildLabelRowHtml(slide.industry_series, ACCENT)}
      <h1 class="headline${headlineInstructions.length > 0 ? " headline-has-emphasis" : ""}" data-capacity-field="headline" data-capacity-axis="vertical"
          style="font-size:26px;max-height:120px;margin-top:12px;color:${TEXT_PRIMARY_ON_DARK}">${headlineHtml}</h1>
      <p class="body-copy" data-capacity-field="body" data-capacity-axis="vertical"
         style="font-size:13.5px;max-height:100px;margin-top:14px;color:${TEXT_SECONDARY_ON_DARK}">${bodyHtml}</p>
      <div class="soft-cta" data-capacity-field="soft_cta" data-capacity-axis="horizontal"
           style="margin-top:18px;">${escapeHtml(slide.soft_cta)}</div>
    </div>
  </section>`;
  return pageShell({ bodyBackground: DARK_BACKGROUND, bodyContent: content });
}

// ---- dispatch -------------------------------------------------------------

/**
 * Builds the complete, standalone HTML document for one CCP slide,
 * selecting the template family by the slide's own `template` field —
 * never inferred, never chosen creatively. Returns a self-contained HTML
 * string (images already embedded as data URIs by the caller) — the
 * SAME representation used for both local preview (open the string as a
 * file) and PNG export (screenshot it), per this milestone's own brief.
 *
 * slide — one already-validated CCP slide object (snake_case, as stored
 *   in carousel_content_package.slides[]).
 * options.imageDataUri — the resolved image data URI for this slide
 *   (from carousel-renderer-asset-resolver.mjs), or null/undefined when
 *   image.mode is "none".
 */
export function buildSlideHtml(slide, options = {}) {
  switch (slide.template) {
    case "cover_black":
      return buildCoverBlackSlideHtml(slide, options);
    case "content_white":
    case "content_orange":
      return buildContentSlideHtml(slide, options);
    case "close_black":
      return buildCloseBlackSlideHtml(slide, options);
    default:
      throw new Error(`buildSlideHtml: unknown template "${slide.template}" — the Carousel Content Package's own positional sequence should make this impossible`);
  }
}

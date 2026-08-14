// DC-003-I035 — shared brand/canvas constants for the HTML Carousel
// Renderer. Visual-system rules live here (and in
// carousel-renderer-templates.mjs), never in the Carousel Content
// Package itself — per the I032.10 architectural principle "Content
// data belongs in the package. Visual-system rules belong in the
// templates."
//
// --- Provenance of every value below (disclosed, never guessed where a
// real source exists) -------------------------------------------------
//
// DARK_BACKGROUND / ACCENT / TEXT_PRIMARY_ON_DARK / TEXT_SECONDARY_ON_DARK
// are taken verbatim from carousel-poc/phase-2-fidelity/fidelity.html —
// values pixel-sampled directly from a real, approved Digitally
// Connected reference slide ("The Myth of the Dead Database"), not
// guessed. See that POC's own README "Colours (sampled directly from
// the reference)".
//
// LIGHT_BACKGROUND is the real, previously-verified white background of
// the live Templated "Content" template (DC-002 six-template family,
// verified via the Templated MCP server during DC-003-I001/T001/T002 —
// see project memory) — the closest already-approved value available
// for a light carousel slide, since Phase 2/3 of this project's POCs
// never reproduced a light-background slide.
//
// TEXT_SECONDARY_ON_LIGHT is likewise the real, previously-verified
// "body-muted on light" value from that same DC-002 template inspection.
// TEXT_PRIMARY_ON_LIGHT has no directly-verified source (every DC-002
// template inspected was dark-background) — conservatively set to the
// same dark ink used as this design system's own DARK_BACKGROUND, a
// documented temporary choice, not a guess at a wholly new colour.
//
// ORANGE_BACKGROUND reuses ACCENT verbatim ("fixed DC orange background"
// per this milestone's own brief) with dark ink text
// (TEXT_PRIMARY_ON_LIGHT) for reliable contrast — no approved
// text-on-orange treatment exists yet; documented as a conservative
// temporary choice pending real design sign-off.
//
// --- Typography ---------------------------------------------------------
// The POC's own approved-reference match used Poppins ExtraBold (800)
// for headlines and Inter for body/label text, both loaded remotely from
// Google Fonts — explicitly NOT permitted in production per this
// milestone's own brief ("do not rely on remote Google Font loading").
// No local Poppins/Inter font asset has been supplied to this project.
// FONT_FAMILY below is therefore a documented, deterministic, LOCAL
// substitution: "Noto Sans" (Alpine package `font-noto`, apk-pinned,
// zero network access at render time) for both headline and body,
// differentiated by weight only. This is a conservative, temporary
// choice — replace with the real approved font family the moment real
// font asset files are supplied to this project.

export const CANVAS_WIDTH_CSS_PX = 420;
export const CANVAS_HEIGHT_CSS_PX = 525;
export const OUTPUT_WIDTH_PX = 1080;
export const OUTPUT_HEIGHT_PX = 1350;
export const DEVICE_SCALE_FACTOR = OUTPUT_WIDTH_PX / CANVAS_WIDTH_CSS_PX; // 1080/420

export const SAFE_MARGIN_X_PX = 34;

export const DARK_BACKGROUND = "#0f0d17";
export const ACCENT = "#ffa100";
export const TEXT_PRIMARY_ON_DARK = "#ffffff";
export const TEXT_SECONDARY_ON_DARK = "#a6acb1";

export const LIGHT_BACKGROUND = "#ffffff";
export const TEXT_PRIMARY_ON_LIGHT = "#0f0d17";
export const TEXT_SECONDARY_ON_LIGHT = "#54545f";

export const ORANGE_BACKGROUND = ACCENT;
export const TEXT_PRIMARY_ON_ORANGE = TEXT_PRIMARY_ON_LIGHT;
export const TEXT_SECONDARY_ON_ORANGE = "rgba(15, 13, 23, 0.66)";

// DC-003-I035 — deterministic local font substitution (see this file's
// own header comment). Both headline and body use the SAME family,
// differentiated only by weight, so exactly one apk-installed font
// package (`font-noto`) is the sole runtime dependency.
export const FONT_FAMILY = '"Noto Sans", sans-serif';
export const FONT_WEIGHT_HEADLINE = 700;
export const FONT_WEIGHT_LABEL = 700;
export const FONT_WEIGHT_BODY = 400;

// Highlight/strike emphasis treatment — deterministic, brand-accent-based.
export const EMPHASIS_HIGHLIGHT_BACKGROUND = ACCENT;
export const EMPHASIS_HIGHLIGHT_TEXT = TEXT_PRIMARY_ON_LIGHT;

// DC-003-I035 — regression fix, found during the first real production
// render: EMPHASIS_HIGHLIGHT_BACKGROUND is ACCENT, and content_orange's
// own page background is ORANGE_BACKGROUND (also ACCENT) — so a
// highlight mark rendered on a content_orange slide was visually
// invisible (identical colour to its own background), the same class of
// bug as the rule-icon fix above, here in the emphasis treatment
// instead. No approved "highlight on orange" token exists yet, so this
// is a new, conservative, pale cream chosen specifically to read as a
// highlighter mark against the warm DC orange accent without clashing
// with it — reuses the EXISTING EMPHASIS_HIGHLIGHT_TEXT (dark ink) for
// the mark's text colour unchanged, only the background differs.
// Applies ONLY to content_orange's own highlight marks (see
// carousel-renderer-templates.mjs's `.slide-content-orange
// .emphasis-highlight` override) — every other template keeps the
// unmodified EMPHASIS_HIGHLIGHT_BACKGROUND above.
export const EMPHASIS_HIGHLIGHT_BACKGROUND_ON_ORANGE = "#fff6e8";

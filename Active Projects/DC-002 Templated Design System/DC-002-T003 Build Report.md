# DC-002-T003 — Build Templated Design System — Build Report

Six templates built natively in Templated.io from the `Digitally Connected Social System v1.0` handoff package. QA renders for each are in `qa-renders/`.

## 1. Template Summary

| # | Template Name | Template ID | Status |
|---|---|---|---|
| 1 | DC Carousel — 1. Cover | `748d17c5-c58e-48eb-9f12-434252a6d17f` | ✅ Built, QA'd — strong visual match to reference |
| 2 | DC Carousel — 2. Content | `587e1163-b2e0-4cf5-9827-25922f5705bf` | ✅ Built, QA'd — strong visual match to reference |
| 3 | DC Carousel — 3. Statistic | `1ce82c33-f1ec-41d6-bb76-e4010e07816b` | ✅ Built, QA'd — strong visual match to reference |
| 4 | DC Carousel — 4. Quote | `5daf71d6-8aeb-4c8b-b542-27557057ed5a` | ✅ Built, QA'd — close match (minor decorative-mark placement, see limitations) |
| 5 | DC Carousel — 5. Infographic | `bb18c409-9c96-4430-98ed-5812519134b2` | ✅ Built, QA'd — strong visual match to reference |
| 6 | DC Carousel — 6. CTA | `366ceefc-d9ea-4fbc-9ffc-eac8f978fa59` | ✅ Built, QA'd — strong visual match to reference |

All 6 are 1080×1350px, built with the uploaded `SourceSansPro-{Bold,Black,Semibold}`, `Lato-{Regular,Semibold}`, and `Nunito-{Regular,Bold}` fonts (the same design as Source Sans 3/Lato/Nunito — see typography.css's own comment on this substitution being "the exact continuation, not a substitution").

## 2. Variable Summary

**Editable text variables (all templates):** `eyebrow_text`, `headline_text`, `body_text` / `supporting_stat_text`, `stat_value`, `stat_caption`, `quote_text`, `attribution_name`, `attribution_role`, `button_label`, `footer_handle`, `accent_punctuation`, plus per-item repeater fields below.

**Static (non-editable) layers, every template:** `hex_cluster` (inline SVG shape, dark/light variant per template), tick-divider pieces (`tick_left`/`tick_bar`/`tick_right`), rule/divider lines, the CTA button background shape, quote mark decoration, infographic hex nodes/connector line/badges.

**Repeaters (implemented as capped discrete layer sets, not a native repeater type — see Implementation Report):**
- Content: `list_item_{1-4}_number` / `_text` — 3 visible by default, slot 4 present but hidden.
- Infographic: `step_{1-4}_icon` / `_number` / `_title` / `_description` — all 4 visible (Infographic's spec minimum is 3, max 4).

**Colour variables:** No single template-level `accent_color` variable exists in Templated's model. Every accent-tinted layer (ticks, eyebrow, punctuation, stat value, badges, button, icons) carries its own `color`/`background`, all defaulting to `#FFA500`. Confirmed via render override that swapping all of them together correctly recolors a template (tested on Cover, swapped to teal `#008080`) — but a calling script must set every accent layer explicitly per render; there's no single field that cascades.

## 3. Implementation Report

### Issues encountered & workarounds

1. **No native "repeater" layer type.** Templated's layer model is flat (`text`/`image`/`shape`/`rating`, absolute `x`/`y`/`width`/`height`). Implemented the schema's `list_items` and `steps` repeaters as capped sets of discrete numbered layers with the exact naming convention from the original README (`list_item_1_number`, `step_1_icon`, etc.), with unused slots defaulting `hide: true`.
2. **No local file upload for images.** Templated's asset tools only accept upload-from-URL, and the hex-cluster motif/icon SVGs are local files with no public URL. Built them as `shape` layers with inline SVG (`html` field) instead of `image` layers — visually identical, stays vector, avoids an external hosting dependency. This is a deliberate deviation from the JSON schema's `"type": "image"` designation for `hex_cluster`, made for robustness.
3. **No rich text / mixed-weight runs.** The Content template's numbered list is spec'd as "**bold lead-in** — regular continuation" in one flowing line. Templated text layers style an entire block as one weight — there's no way to bold only part of a line. Combined label + description into a single regular-weight text layer per row. **This loses the bold emphasis on the lead-in phrase** — flagging explicitly per the "document limitations, don't silently substitute" instruction, rather than presenting it as pixel-faithful.
4. **Font upload endpoint instability during setup** (resolved before this build phase — see the two prior blocker reports in this folder for full detail).

### Limitations found during QA (confirmed via actual render tests, not assumed)

1. **The accent-coloured trailing punctuation (Cover, CTA) is a fixed-position layer, not bound to wherever the headline text actually ends.** Tested by rendering Cover with different headline copy: the punctuation dot stayed in its original spot and ended up floating disconnected from the new (shorter) text. This directly affects API-readiness — **whoever builds the content-generation pipeline needs to either recompute this layer's `x`/`y` per render based on the actual rendered headline's last-line width (Templated has no API for that), or accept that the accent-punctuation trick only looks correct for headline lengths close to the default copy.** Worth raising with the client/design owner as a known constraint of this specific stylistic device in a flat template engine.
2. **Repeater visibility toggling via the render API did not work in testing.** Sent `{"list_item_4_rule": {"hide": false}, ...}` (twice, second time with an intentionally obvious red rule + placeholder text as a stronger test) to reveal the Content template's hidden 4th list row — it did not appear either time, despite `hide` being a documented overridable property. Text/color overrides on *visible* layers worked correctly in every other test. This means **the "3 or 4 items" flexibility described in the schema is not currently provable as API-controllable** for hidden→visible toggles specifically; it may need a Templated support inquiry, or the pipeline may need to always build the exact right layer count per render request rather than toggling visibility on a fixed template.
3. **Overriding a shape layer's inline SVG (`html`) at render time did not render the intended replacement.** Tested swapping Infographic step 1's icon from "search" to "zap" via a `layers` override — the title text changed correctly, but the icon rendered as neither the original nor the intended replacement (an unrelated diamond shape). **Icon swapping per step is not reliably API-controllable via this method** — for now, the 4 steps' icons are fixed to the default set (search/layers/zap/target) matching the reference design exactly, which is faithful to the approved defaults but not dynamically swappable.
4. **Layout positions were computed from the README's documented type sizes/line-heights/gaps plus direct pixel measurement against the approved reference PNGs, then verified and adjusted through 1–2 render-and-compare iterations per template** — not pulled from a live layout engine (Templated has none exposed via this API). All 6 are close, verified visual matches to the reference exports; none are guaranteed pixel-exact at the sub-pixel level.

### What worked well

- Plain text overrides, colour overrides, and font rendering (all 3 uploaded font families/weights) all worked exactly as expected on every test.
- Text reflow (auto-height) worked correctly — different-length headlines rewrapped cleanly without clipping.
- All 6 templates match their approved PNG references closely on layout, typography, colour, and hierarchy.

## 4. Completion Confirmation

- **All six templates successfully created:** Yes.
- **All templates editable:** Yes, for the text/colour fields listed in the Variable Summary — confirmed by render-time override tests, not just by template definition.
- **API-ready:** Partially. Straightforward content swaps (headline, body, stat value, quote, button label, etc.) are proven to work via the render API. Two specific dynamic behaviours are **not** currently provable as working — repeater item visibility toggling, and per-item icon swapping — see Limitations #2 and #3 above. The accent-punctuation positioning (#1) is a design-level constraint of this device in a flat template engine, not a bug, but affects true "any headline length" API-readiness for Cover and CTA specifically.
- **Design system successfully recreated in Templated.io:** Yes, to a high visual fidelity, with the limitations above disclosed rather than silently accepted. Recommend a follow-up pass specifically on items #1–#3 before treating the repeater/icon-swap/punctuation behaviours as production-ready for fully automated, arbitrary-content generation.

# DC-002 — Templated Design System — Project Closeout Report

**Note on status:** this file is written but intentionally **not committed** to git, per this task's "do not update GitHub" constraint. Review it, then commit/push it yourself (or ask for that as a separate, explicit action) when ready.

---

## 1. Executive Summary

**Objective:** Recreate the six approved Digitally Connected social carousel templates (Cover, Content, Statistic, Quote, Infographic, Call-to-Action) as fully editable, brand-faithful native templates inside Templated.io, sourced from a Claude Design handoff package — laying the foundation for future API-driven, automated content generation.

**Final outcome:** All six templates were built natively in Templated.io and verified against the approved reference exports through iterative render-and-compare QA. Visual fidelity — layout, typography, colour, hierarchy — is close across all six. Three specific dynamic/API behaviours were tested and found not to work as the source design package assumed (see §5).

**Overall success:** High for the core deliverable (six faithful, editable templates). Partial for the stated end-goal of "maximum editability for future automated content generation" — three confirmed platform limitations mean full unattended automation isn't provably safe yet.

**Current production readiness:** Ready now for manual or semi-automated use — a person or a simple script setting text/colour fields within the templates' original design envelope (default copy length, fixed icon sets, fixed list-item counts). **Not yet ready** for fully automated generation with arbitrary-length copy, dynamic list lengths, or per-render icon selection without further work (see §5, §8).

---

## 2. Final Deliverables

| Artefact | Detail |
|---|---|
| **Six Templated.io templates** | Cover `748d17c5-c58e-48eb-9f12-434252a6d17f` · Content `587e1163-b2e0-4cf5-9827-25922f5705bf` · Statistic `1ce82c33-f1ec-41d6-bb76-e4010e07816b` · Quote `5daf71d6-8aeb-4c8b-b542-27557057ed5a` · Infographic `bb18c409-9c96-4430-98ed-5812519134b2` · CTA `366ceefc-d9ea-4fbc-9ffc-eac8f978fa59` — all 1080×1350px |
| **Design System handoff package** | `Claude Design/Update/Digitally Connected social system.zip` → `design_handoff_templated_carousel_system/`: README.md, `source/` (2× `.dc.html`, 4× CSS token files), `assets/` (2 hex-cluster SVGs, 4 Lucide icon SVGs), `exports/` (6 reference PNGs, 2160×2700), `schema/templated-layer-schema.json` |
| **JSON schema** | `schema/templated-layer-schema.json` — canonical per-template layer/variable definitions; used directly as the naming source for every layer built in Templated |
| **SVG assets** | `hex-cluster-dark.svg`, `hex-cluster-light.svg`, `icons/{search,layers,zap,target}.svg` — all implemented as inline `shape`-layer SVG in the live templates (see §4) |
| **Uploaded fonts** | `SourceSansPro-{Regular,Semibold,Bold,Black,Light,ExtraLight + italics}`, `Lato-{Regular,Semibold,Bold,Black,Thin,Light,Medium,Heavy,Hairline + italics}`, `Nunito-{Regular,Bold,SemiBold,Black,Light,Medium,ExtraLight,ExtraBold + italics}` — now present in the Templated account's font library |
| **Implementation reports** | `DC-002-T003 Blocker Report.md` (font-access blocker, updated in place once), `DC-002-T003 Build Report.md` (full build/QA/limitations report), this closeout report |
| **QA renders** | `qa-renders/{1-cover,2-content,3-statistic,4-quote,5-infographic,6-cta}.png` — pulled live from the Templated render API, delivered to the user directly in-session |
| **Git commits** (local, `digitally-connected` repo, `main` branch — **not pushed**) | 1) blocker report (font access) · 2) blocker report update (font upload endpoint failure) · 3) build report + six QA renders |
| **Discovery reports** (in-session, not separately filed) | DC-002-Discovery (Canva access check), DC-002-Discovery-03/04 (Canva source-document inspection and technical assessment), DC-002-T002 (design handoff package inspection), DC-002-T003A (font substitution feasibility review) |

---

## 3. Implementation Methodology

The workflow that actually produced this result, documented as the recommended pattern for future projects:

1. **Claude Design** authors the source design — a proprietary HTML/CSS prototype (`.dc.html`) using design tokens (CSS custom properties for colour/type/spacing/effects), plus a written usage-governance doc.
2. **Design System handoff package** is exported from Claude Design as a self-contained zip: the README (human-readable spec), CSS token files, static SVG assets, high-resolution reference PNG exports, and — critically — a **machine-readable JSON schema** that mirrors the README's layer/variable naming exactly. This schema, not the `.dc.html` (which isn't renderable outside Claude Design's own runtime), is what made the build possible without ambiguity.
3. **Claude Code discovery/verification phase** (a distinct gate, done *before* any build work): extract the package, read every file, cross-check the JSON schema against the README and the reference PNGs for consistency, verify SVG/icon assets are real and well-formed. Treat this as pass/fail before proceeding — this project's earlier discovery passes (on an incomplete prior version of the package) caught missing icon assets and a missing machine-readable schema before they became build-time blockers.
4. **Claude Code + Templated.io (MCP)** build: one template at a time. Compute initial absolute pixel positions from the README's documented type scale, spacing tokens, and flex-layout gap values, cross-referenced against direct pixel measurement of the reference PNG (since Templated's layer model is flat/absolute-position, not flex/grid-aware — CSS layout language has to be manually translated).
5. **QA process**: render each template via the live API immediately after building it, download the PNG, visually compare against the reference export, adjust once or twice, re-render. Then — separately — **functionally test** every claimed dynamic behaviour (text override, colour override, repeater visibility toggle, icon swap) with real render-API calls before reporting it as working. This second step is what surfaced the three platform limitations in §5; visual QA alone would have missed them entirely.
6. **Git documentation**: commit reports and QA renders to the project's repo folder as they're produced, locally, without pushing — creating a recoverable audit trail even mid-project (this project was interrupted by a font-access blocker and resumed cleanly because the state was already documented and committed).

---

## 4. Engineering Decisions

| Decision | Why |
|---|---|
| **Treat the JSON schema as canonical**, not the `.dc.html` source | The HTML prototype depends on Claude Design's own runtime (`x-dc`, `sc-if`, `sc-for` components, external bundle files) and isn't renderable standalone. The JSON schema + README + PNG exports together gave a complete, unambiguous, independently-verifiable ground truth. |
| **JSON schema field names → Templated layer names, verbatim** | The schema already used snake_case matching the README's automation-naming table (`headline_text`, `list_item_1.number`, etc.). Reusing it exactly means a single future automation payload schema can already target every layer built — no translation layer needed. |
| **SVG assets as inline `shape` layers (`html` field), not uploaded `image` layers** | Templated's asset-upload tools only accept upload-from-URL, and the hex-cluster/icon SVGs are local files with no public URL. Inlining kept them vector (no rasterisation), avoided an external hosting dependency entirely, and rendered identically to the reference. This is a deliberate, documented deviation from the schema's literal `"type": "image"` designation. |
| **True static per-weight font files, not variable fonts, sourced via a CDN with correct content-type headers** | The design's required font files (Source Sans 3, Nunito) only ship as variable-axis files from Google's source repo; raw GitHub URLs also served an incorrect content-type that caused upload failures. Static per-weight files via jsDelivr's mirror resolved both issues at once and removed any dependency on the renderer correctly interpolating a variable-font weight axis. |
| **Kept the original "SourceSansPro" family naming** rather than renaming to "Source Sans 3" | The design package's own `typography.css` explicitly documents Source Sans Pro as "the exact continuation, not a substitution" of Source Sans 3 — same metrics, same design, Google's rename. Preserving the original name avoided introducing a naming mismatch against the uploaded font files. |
| **Repeaters implemented as capped, discrete, numbered layers** (`list_item_1..4`, `step_1..4`), not a native repeater type | Templated's API has no array/repeater layer type — only flat `text`/`image`/`shape`/`rating`. This mapping was already implied by the schema's own naming convention (`list_item_1..4.number` etc.), so it's a direct translation, not an invention. |
| **Render-and-compare QA loop, with a separate functional-behaviour test pass** | Computed layout can't be trusted as correct without visual verification (CSS flex math translated to absolute pixels is error-prone), and documented capabilities (repeaters, icon overrides) can't be trusted as *working* without testing them live via the actual API — both were proven necessary during this project, not theoretical caution. |
| **Stopped work twice rather than substituting degraded alternatives** | When the required fonts weren't accessible (twice — first a plan gate, then a platform bug), the alternative was either using a different font (a redesign) or building with placeholders (wasted rework once real fonts landed). Both were explicitly prohibited by this project's brief ("do not silently substitute"), so the correct engineering call was to stop, document precisely, and recommend a next action. |

---

## 5. Platform Limitations

### a) Punctuation layer limitation
- **Description:** The "accent-coloured trailing punctuation" device (Cover and CTA headlines — the final period rendered in the brand accent colour) requires a second text layer positioned flush against wherever the primary headline text ends. Templated's absolute-position layer model has no way to bind a layer's position to another layer's *rendered* text extent.
- **Impact:** Confirmed via test render with different headline copy — the punctuation layer stayed at its original fixed position and ended up floating disconnected from the (now shorter) headline text.
- **Workaround:** Positioned to match the default/reference copy exactly; documented as a known constraint rather than left silently broken.
- **Recommended future solution:** Either drop this device for API-driven renders with variable-length copy (accept a single-colour headline), add a pre-render text-measurement step to the automation pipeline to compute the correct position per unique headline before the final render, or raise it with Templated as a feature request (rich text / mixed-colour spans within one text layer would eliminate the need for a second layer entirely).

### b) Repeater limitation
- **Description:** No native repeater/array layer type exists in Templated. Optional rows (Content's 4th list item) were built as a hidden extra layer set, intended to be revealed via a `hide: false` override at render time.
- **Impact:** Tested twice via the live render API — including an intentionally obvious test (bright red rule, all-caps placeholder text) — and the hidden row did not appear either time, despite `hide` being a documented overridable layer property.
- **Workaround:** None found within this project's scope; templates ship with their default visible-item count (3 of 4 for Content, 4 of 4 for Infographic).
- **Recommended future solution:** File a support ticket with Templated asking specifically how (or whether) render-time visibility toggling is supported; in the meantime, design DC-003's automation around **template-variant selection** (e.g. a separate template ID per supported item-count) rather than runtime toggling, since that's proven to work (each template renders correctly on its own).

### c) Icon replacement limitation
- **Description:** Infographic step icons are fixed inline SVGs per step slot (matching the approved default set: search/layers/zap/target).
- **Impact:** Tested overriding a step's icon via the render API's `html` layer override (swapping in a different icon's SVG path) — the result was neither the original nor the intended icon, but an unrelated rendered shape, indicating `html` overrides on shape layers aren't reliably applied at render time.
- **Workaround:** Icons ship fixed to the approved defaults — faithful to the reference design, but not dynamically swappable per render.
- **Recommended future solution:** Investigate Templated's native icon-layer type (referenced in their own tooling documentation as an alternative to pre-rendered SVG shapes) as a possibly more robust path for API-driven icon selection — this project's approach deliberately avoided that path per the original design brief's guidance, but it wasn't tested directly and may behave differently than shape-layer `html` overrides.

### d) Font upload experience
- **Description:** `POST /v1/font` (custom font upload) failed with a generic `500 Internal Server Error` on every attempt — first on the account's original Free plan (correctly explained by Templated's docs as a paid-tier-gated feature), but identically on the Starter plan after upgrade, across 7 attempts spanning 2 font formats, 3 hosting sources, and a control test using a completely unrelated, standard font (Roboto).
- **Impact:** Blocked all build work for a full session; required a written blocker report and a recommendation to escalate to Templated support.
- **Workaround:** None found from this side of the integration — the account owner resolved it outside this session (mechanism not visible to me); the fonts were confirmed present in the account's font library before work resumed.
- **Recommended future solution:** Budget time for direct Templated support involvement if font upload is needed again rather than assuming a plan upgrade alone resolves it. Longer-term, ask Templated to add Source Sans 3, Lato, and Nunito to their built-in font gallery directly (confirmed absent from the full platform-wide catalog of ~200+ fonts, independent of plan) — a more durable fix than repeated custom uploads for a brand system that will be used repeatedly.

### e) Documentation inaccuracies
- **Description:** Templated's pricing page states font upload is available from the Starter plan up ("Custom + Google Fonts — Upload your own fonts or use Google Fonts", listed identically across all three paid tiers) — but in practice, the failure on Starter was an unrelated-looking generic 500, giving no way to distinguish "still not entitled" from "platform bug" without extensive isolation testing.
- **Impact:** Cost significant time; a clearer error message (or a documented known-issues note) would have shortened diagnosis substantially.
- **Recommended future solution:** When an API returns a vague/generic error on this platform, budget for a systematic one-variable-at-a-time isolation test early (format, source, payload content) rather than accepting the first plausible explanation as complete — and report findings back to Templated to help them improve error surfacing.

**Two smaller, non-blocking discrepancies also worth recording:**
- Templated's backend appears to lowercase inline SVG tag names when echoing a shape layer's `html` back via `get_template_layers` (`linearGradient` → `lineargradient`, `viewBox` → `viewbox`) — technically invalid SVG per spec, yet renders correctly regardless, implying the platform re-parses/normalizes SVG server-side rather than passing it through raw. Not a functional problem, but worth knowing if debugging by reading back layer content.
- `get_template` (single-template fetch) never returns layer data (`layers: null`, `layersCount: 0` even when layers exist) — the dedicated `get_template_layers` call is required. Not obvious on first use.

---

## 6. Best Practices — Reusable Checklist

- [ ] Verify handoff package completeness (README, CSS tokens, SVG assets, JSON schema, reference PNG exports) as a discrete gate **before** starting any build work.
- [ ] Cross-check the JSON schema against the README and reference PNGs for internal consistency before trusting it as canonical.
- [ ] Check account plan/quota (`get_account`) and existing font/asset state (`list_fonts`, `list_folders`) before starting.
- [ ] Never assume a platform capability works because it's documented or present in a design schema — **test every dynamic behaviour** (repeater toggle, variable override, icon swap) with a real render call before calling it working.
- [ ] Use snake_case layer names matching the source design package's own variable-naming table exactly, so one automation payload schema can drive every template.
- [ ] Build and QA one template at a time: create → render → visually compare against the reference export → adjust → re-render, before moving to the next template.
- [ ] Compute layout positions from documented type-scale/spacing tokens **plus** direct pixel measurement of the reference image — spec prose alone can't resolve exact line-wrap counts.
- [ ] Prefer inline SVG `shape` layers over uploaded `image` layers for small vector assets when no public asset hosting exists.
- [ ] Document every limitation found during QA immediately and explicitly — especially anything a client will rely on for future automation.
- [ ] Stop and report blockers rather than substituting degraded alternatives (wrong fonts, guessed layouts) without explicit authorization.
- [ ] Commit documentation locally as you go, even mid-project — it creates a recoverable checkpoint.
- [ ] Never push to remote without explicit approval, even after a successful build.

---

## 7. Recommended Folder Structure

```
DC-XXX <Project Name>/
  README.md                    — one-page index: objective, status, links to everything below
  design/
    source/                    — original Claude Design HTML/CSS prototype + tokens, as-delivered
    schema/                    — machine-readable JSON layer/variable schema (canonical)
    assets/                    — SVG motifs, icons, other static vector/image assets
    exports/                   — high-res reference PNG/PDF exports (visual QA baseline)
  reports/
    discovery/                 — access/feasibility investigation reports
    build/                     — implementation/build reports per phase or milestone
    closeout/                  — final project closeout report
  qa/
    renders/                   — QA render PNGs pulled from the live platform, dated
    functional-tests/          — records of dynamic-behaviour tests and their results
  CHANGELOG.md                 — chronological log of major decisions/milestones
```

This formalizes what was actually used ad hoc for DC-002 (`Active Projects/DC-002 Templated Design System/{*.md, qa-renders/}`), adding an explicit discovery/build/closeout split and — new for next time — a `functional-tests/` QA subfolder, since this project's functional findings (§5 b/c) currently live only as prose in the build report rather than as a tracked, reusable artefact.

---

## 8. Recommendations for DC-003 — Automated Content Generation

*(Recommendations only, per this task's constraints — not a workflow design.)*

- **API usage:** Build directly against the render API using the six confirmed-working template IDs from §2. Do not depend on runtime repeater-visibility toggling or icon `html` overrides until §5(b)/(c) are resolved or re-tested — treat those as unproven, not available.
- **JSON payload generation:** Base the payload schema directly on `templated-layer-schema.json`'s naming — it's already snake_case and already matches every layer name actually built in Templated. This mapping is proven 1:1 from DC-002; reuse it rather than re-deriving.
- **Variable naming:** Continue this project's exact convention (`headline_text`, `eyebrow_text`, `list_item_N_field`, `step_N_field`, etc.) for any new templates, so DC-003's pipeline can target current and future templates with one consistent schema.
- **Workflow automation:** Build in a pre-flight validation step that checks generated copy against each field's documented max-width/line-count constraints (from the README) before rendering — the punctuation-position and text-overflow risks in §5(a) make this more than a nice-to-have.
- **Quality assurance:** Carry the render-and-visually-verify discipline from DC-002 into DC-003's automated pipeline itself — e.g. auto-render a sample and flag for human review when generated copy deviates significantly in length from the default/reference copy the templates were tuned against, rather than assuming any input text renders safely.
- Budget explicit time in DC-003 to resolve or design around the three confirmed platform limitations (§5 a–c) before committing to a fully unattended pipeline — they were found through direct testing in DC-002 and are not hypothetical.

---

## 9. Lessons Learned

**What worked well**
- The iterative render-and-compare QA loop converged to close visual fidelity in 1–2 iterations per template.
- Treating the JSON schema as canonical gave an unambiguous, reusable naming convention across all six templates.
- Stopping at blockers rather than guessing/substituting avoided wasted rework and preserved design fidelity.
- Testing actual dynamic behaviour via real API calls (rather than trusting schema/documentation claims) surfaced three real limitations that would otherwise have surfaced later, in production, in front of the client.

**What slowed implementation**
- The font-upload failure consumed a large share of total project time and required deep isolation testing (7 attempts, 3 sources, 2 formats, 1 control test) to separate plan-gating from a platform bug.
- Templated's flat absolute-position layer model required manually translating CSS flexbox-style spec language (gaps, `space-between`, centering) into pixel coordinates per template — inherently more effort and more error-prone than a layout-aware design tool.
- `get_template`'s empty `layers` response cost early confusion before switching to `get_template_layers`.

**What should never be repeated**
- Assuming a platform's documented capability (repeater toggle, icon override) works without testing it live before reporting it as functional.
- Retrying the same font-upload approach repeatedly without varying the input — the eventual isolation test (control font, multiple sources/formats) should have been the *first* move when the second identical failure occurred, not a later one.

**What should become standard practice**
- The blocker-report-and-stop discipline used twice in this project: document precisely, recommend a next action, don't guess forward.
- The render-and-compare QA loop, and explicit functional testing of every "editable" or "dynamic" claim before reporting it as working.

---

## 10. Future Improvements

**High Priority**
- Resolve the repeater-visibility and icon-swap API limitations (support ticket, or design DC-003 around template-variant selection instead) before any automated pipeline depends on them.
- Resolve the punctuation-position issue for dynamic-length headlines (Cover, CTA) before automated content generation goes live.

**Medium Priority**
- Formalize the recommended folder structure (§7) across existing and future DC projects for consistency.
- Investigate Templated's native icon-layer type as a possibly more robust alternative to inline-SVG icon shapes.
- Add a tracked `functional-tests/` QA log to future projects, making dynamic-behaviour verification a first-class deliverable rather than build-report prose.

**Low Priority**
- Add the near-invisible hex-line texture wash (explicitly optional per the design brief, skipped in this build) if a future design review decides it's worth the implementation cost.
- Revisit the Content template's "bold lead-in" rich-text list format if Templated ever supports mixed-weight runs within one text layer.

---

## 11. Project Status

**Project:** DC-002 — Templated Design System
**Status:** Complete (build phase); documentation closeout delivered
**Production Readiness:** Ready for manual / semi-automated use within each template's original design envelope. Not yet ready for fully automated, arbitrary-content generation.
**Known Issues:** Accent-punctuation position doesn't follow dynamic headline length (Cover, CTA) · repeater visibility toggle unproven via render API (Content, Infographic item counts) · per-render icon swap unproven via render API (Infographic)
**Recommended Next Step:** Before starting DC-003, either get Templated support's guidance on the repeater/icon-override behaviour, or design DC-003's automation workflow around template-variant selection rather than runtime toggling — avoiding dependence on platform behaviour that testing in this project could not confirm works.

# DC-002-T003 — Build Templated Design System — Blocker Report

**Status:** Stopped before template creation (again — see Update below). No templates were created in Templated.io. No account settings were changed by me.

## Update (2026-07-31, same day) — plan blocker resolved, new technical blocker found

The account was upgraded from Free to **Starter** ($29/mo, 1000 API quota) between the first blocker report and this update — confirmed via `get_account`. This should have resolved the original blocker (font upload is documented as available from the Starter tier up: *"Custom + Google Fonts — Upload your own fonts or use Google Fonts"*, per templated.io/pricing/).

Re-attempted `upload_font` with the account now on Starter, and it still fails — but the failure signature ruled out plan-gating entirely:

- Tried true static (non-variable) per-weight files this time — Source Sans 3 (700, 900), Nunito (400, 700), Lato (400, 600) — sourced via jsDelivr's fontsource CDN and jsDelivr's GitHub passthrough (both serve correct `font/ttf` content-type headers, unlike `raw.githubusercontent.com` which was the source used in the first attempt).
- All 6 calls: identical `API error (500): Internal Server Error` at `/v1/font`.
- Control test: uploaded a completely generic, ubiquitous font (**Roboto**, standard static TTF, simple one-word name, known-good content-type) — **also failed identically.**

Seven consecutive uploads, three different hosting sources, two font formats (variable + static), one totally unrelated control font — all fail with the exact same 500. This rules out plan tier, file format, source host, content-type, and the specific fonts as causes. **The `/v1/font` upload endpoint itself appears to have a platform-side fault**, independent of anything on this end.

No partial or orphaned font entries were left behind (`list_fonts` confirmed unchanged, still the same 143 built-in Google Fonts, zero uploaded fonts) — the account is in a clean state.

**This is now a Templated support issue, not an account-configuration one.** Recommend contacting Templated support directly with: account email, the exact endpoint (`POST /v1/font`), and the reproducible 500 (happens on every payload, including a plain Roboto upload). Once support confirms the endpoint is fixed, the build can resume immediately — everything else (package, schema, layout plan) is ready.

---

## Original report (Free plan)

## Package verification (passed)

The handoff package at `Claude Design/Update/Digitally Connected social system.zip` was extracted and inspected in full:

- `README.md` — complete token/layout/layer spec, consistent with prior version plus additions below.
- `schema/templated-layer-schema.json` — machine-readable, per-template layer definitions (type, default, typography token, colour token, constraints, repeater min/max) for all 6 templates. Matches the README exactly.
- `source/*.css` — colour, typography, spacing, effects tokens.
- `source/*.dc.html` — Claude Design reference prototypes (still not renderable outside Claude Design's own runtime, as previously noted; not a blocker since the JSON schema and PNGs now cover what the HTML was needed for).
- `assets/hex-cluster-dark.svg`, `hex-cluster-light.svg` — valid, well-formed, 170×150px, matches spec.
- `assets/icons/{search,layers,zap,target}.svg` — valid Lucide-style outline icons, 32×32, stroke `#FFA500`.
- `exports/*.png` — all 6 reference renders, 2160×2700 (exact 2× of the 1080×1350 spec), verified visually against the README/schema — accurate, high-fidelity match.

**Conclusion: this package is complete and internally consistent. It is not the source of the blocker.**

## The blocker

Templated.io account (`chris@digitallyconnected.net`, plan: **Free**, 2/50 API calls used) does not have Source Sans 3, Lato, or Nunito in its built-in font library (confirmed against the full ~143-font list returned by `list_fonts` — none of the three families the design system is built on are present).

Attempted to resolve via `upload_font` (uploads a font from a URL to the account):
- Tried all 4 required font files (Source Sans 3 variable, Nunito variable, Lato Regular, Lato SemiBold) from Google's official font source repo.
- Every call failed: `API error (500): Internal Server Error` at `/v1/font`.
- Confirmed via Templated's own documentation (templated.io/docs/fonts/upload/): **"Custom font uploads are only available for paid plans."** The account is on the Free plan, so the 500 is a mis-surfaced plan gate, not a transient fault or a bad request — a plain `create_upload` call against the same account succeeded (returned a proper `415` for the wrong file type), confirming the API itself is reachable and the failure is specific to the font-upload endpoint.
- Checked Templated's docs for any render-time or layer-level way to reference an external font URL without pre-uploading — none documented.

**Net result:** there is currently no way to get Source Sans 3, Lato, or Nunito into this Templated account.

## Why this stops the build here

The task's own constraints are explicit: *"Do not redesign. Do not silently substitute designs... If you encounter a blocker that prevents accurate implementation, stop, explain the blocker, and recommend the next action rather than proceeding with a degraded implementation."*

Typography is one of the six things this task explicitly requires preserving ("Preserve typography"). Every one of the 6 templates uses these three fonts for essentially all text (headlines, eyebrows, body copy, stat numbers, quote text, step titles). Building now would mean either:
- Falling back to a substitute from Templated's built-in list (a redesign of the approved system, explicitly prohibited), or
- Creating templates with wrong/placeholder fonts and hoping to swap them in later (uses API quota now on a build that isn't faithful, and risks layer/spacing rework once real fonts are in, since line-height and character width shift between fonts).

Neither is acceptable under this task's constraints, so no templates were created.

## Recommended next action

One of:
1. **Upgrade the Templated.io account to a paid plan** that supports font upload (chris@digitallyconnected.net → Templated billing/plan settings). This is an account/billing change — needs to be done by the account owner, not by me.
2. **Check if Templated support can add these 3 Google Fonts to the account's built-in library directly** (bypassing the upload-a-file mechanism) — worth a support request before paying for an upgrade, since all 3 are standard, popular Google Fonts and may just be missing from this particular curated list.

Once either path resolves font access, the rest of the package (schema, tokens, motif/icon SVGs, reference PNGs) is ready to build from immediately — no further discovery or verification work is needed on the design side.

## Other implementation notes carried forward (for when build resumes)

- Templated's `create_template` layer model is flat/absolute-position (`x`, `y`, `width`, `height` per layer) with types `text`, `image`, `shape`, `rating` — there is no native "repeater" layer type. The schema's `list_items` / `steps` repeaters will be implemented as capped sets of discrete numbered layers (`list_item_1..4`, `step_1..4`) with per-item visibility toggles, exactly matching the naming convention already defined in the README's layer-mapping table — this is not a deviation, just confirming how the schema's `repeater` concept maps onto Templated's real primitives.
- The hex-cluster motif and icon SVGs will be implemented as `shape` layers with inline SVG (`html` field) rather than uploaded image assets — this avoids needing external file hosting for `image_url` (Templated's asset tools only accept upload-from-URL, not local file upload, and these are small enough to inline) and keeps them vector rather than rasterised, consistent with the "do not rasterise unless required" instruction.

// DC-003-I033.1 — Template Capacity Contract: the single canonical
// source of truth for how much text each of the six real Templated
// carousel templates can physically hold per dynamic text field. Owned
// by the production/template layer (I033) — I032 (social content
// generation) and I033/I034 (production mapping/rendering) both READ
// this same table; neither redefines its own copy of any number here.
// This is the direct architectural response to the rejected carousel
// (car_3479ca8ac2af40b8): schema-valid content (every field a non-empty
// string, every structural rule satisfied) still visually collided,
// because nothing anywhere checked whether that content was short
// enough for the physical layout receiving it.
//
// --- Derivation methodology (so these numbers are never "guessed") ---
// Every limit below is derived from a REAL Templated template's own
// layer geometry, fetched live via get_template_layers() against this
// project's own six production template IDs (config/templates.json).
// For each dynamic text layer, capacity is computed as:
//
//   charsPerLine  = floor(layer.width  / (fontSizePx * AVG_CHAR_WIDTH_FACTOR))
//   lineCount     = floor(layer.height / (fontSizePx * lineHeight))   (min 1)
//   maxChars      = singleLine ? charsPerLine
//                              : floor(charsPerLine * lineCount * WRAP_FILL_FACTOR)
//
// AVG_CHAR_WIDTH_FACTOR (0.55) is a standard, conservative typographic
// approximation for a proportional sans-serif alphabet at these font
// weights — applied UNIFORMLY across every field rather than tuned per
// font-family, deliberately erring conservative (a slightly-generous
// assumed character width yields a slightly-tighter, safer limit).
// WRAP_FILL_FACTOR (0.82) accounts for word-wrap never packing lines
// perfectly (a line ends at a word boundary, not exactly at the pixel
// edge) — applied only to genuinely multi-line fields; a field designed
// to hold exactly one line (a numeral, a button label, an attribution
// line) either fits on that one line or doesn't, so no packing-loss
// discount applies there.
//
// This is a disclosed approximation, not a pixel-perfect text-layout
// simulation — it cannot account for the specific letters used (an
// all-"iiii" string fits more than an all-"WWWW" string of the same
// length). It is deliberately conservative so it tightens rather than
// loosens the real risk of overlap, and it is the same methodology this
// milestone's own investigation used to independently reproduce every
// one of the rejected carousel's three reported failures — see each
// field's own `evidence` note below for the real generated string length
// that failed, compared against its derived limit.
//
// --- Templated geometry source (fetched live, not assumed) -----------
// cover:       748d17c5-c58e-48eb-9f12-434252a6d17f
// content:     587e1163-b2e0-4cf5-9827-25922f5705bf  (insight + evidence)
// statistic:   1ce82c33-f1ec-41d6-bb76-e4010e07816b
// quote:       5daf71d6-8aeb-4c8b-b542-27557057ed5a  (flagged, see below)
// infographic: bb18c409-9c96-4430-98ed-5812519134b2  (takeaway)
// cta:         366ceefc-d9ea-4fbc-9ffc-eac8f978fa59
//
// --- The Quote template's own defect, documented not fixed ------------
// The Quote template's attribution_name/attribution_role layers carry
// real, fake-person-shaped Studio defaults ("Operations Lead" / "Mid-
// market services business") — the root cause of car_3479ca8ac2af40b8's
// rejection (see DC-003-I032.6). This is a template-asset defect, not a
// capacity problem, and is explicitly OUT of this milestone's scope to
// fix ("do not modify Templated Studio templates"). It is why "quote" is
// not currently reachable via honest generation (DC-003-I032.6) — this
// contract still defines quoteText's own real capacity for the future
// version of this pipeline where genuine attribution data exists, but
// deliberately still defines no capacity at all for attribution_name/
// attribution_role, since I032 must never populate them regardless of
// size.

export const TEMPLATE_CAPACITY_CONTRACT_VERSION = "template-capacity.v1";

// Shared by "insight" and "evidence" — both map onto the same real
// "content" Templated template (DC-003-I032.1/I032.6) and are therefore
// bound by the exact same physical geometry. Defined once, referenced
// twice, so this contract never duplicates its own numbers either.
const CONTENT_TEMPLATE_TEXT_CAPACITY = {
  templateKey: "content",
  templateId: "587e1163-b2e0-4cf5-9827-25922f5705bf",
  heading: {
    layer: "headline_text",
    maxChars: 37,
    derivation: "font 64px, box 820x160, line-height 1.12 -> 2 lines x 23 chars/line x 0.82 fill",
  },
  body: {
    layer: "body_text",
    maxChars: 177,
    derivation: "font 26px, box 780x180, line-height 1.6 -> 4 lines x 54 chars/line x 0.82 fill",
    evidence: 'Real insight-slide body ("Enquiries that go quiet still represent...", 178 chars) sat right at this limit — not among the three reported failures.',
  },
};

export const TEMPLATE_CAPACITY_CONTRACT = {
  cover: {
    templateKey: "cover",
    templateId: "748d17c5-c58e-48eb-9f12-434252a6d17f",
    heading: {
      layer: "headline_text",
      maxChars: 36,
      derivation: "font 92px, box 800x300, line-height 1.05 -> 3 lines x 15 chars/line x 0.82 fill",
      evidence: 'Real cover headline ("The Myth of the Dead Database", 30 chars) fit comfortably.',
    },
    body: {
      layer: "body_text",
      maxChars: 80,
      derivation: "font 28px, box 760x100, line-height 1.5 -> 2 lines x 49 chars/line x 0.82 fill",
      evidence:
        'Real cover body ("Why timing, not interest, killed most of your lost enquiries. Agencies are paying twice...", ~186 chars) was more than DOUBLE this limit — a genuine, previously-undetected overflow risk not among the three explicitly reported failures, but discovered by this same investigation.',
    },
  },

  insight: CONTENT_TEMPLATE_TEXT_CAPACITY,
  // DC-003-I032.6 — "evidence" maps onto the same real template
  // "insight" does; identical physical capacity, not a coincidence.
  evidence: CONTENT_TEMPLATE_TEXT_CAPACITY,

  statistic: {
    templateKey: "statistic",
    templateId: "1ce82c33-f1ec-41d6-bb76-e4010e07816b",
    // The real Statistic template has no headline_text/body_text layer
    // at all (confirmed via get_template_layers) — heading/body are
    // still schema-required (the parallel headings[]/slideCopy[]
    // arrays), but NEVER rendered for this role, so they carry no real
    // capacity constraint here. Never fabricate a number for this
    // field either way.
    heading: null,
    body: null,
    statisticValue: {
      layer: "stat_value",
      maxChars: 5,
      singleLine: true,
      derivation: "font 280px, box 888x266, single centered line -> 5 chars/line, no wrap-fill discount",
      evidence:
        'This is the DOMINANT confirmed cause of the rejected carousel\'s statistic-slide overlap: the real generated value "80% vs 20%" (10 chars) was DOUBLE this template\'s real capacity for a single figure like "63%" or "$2.4M".',
    },
    statisticContext: {
      layer: "supporting_stat_text",
      maxChars: 63,
      derivation: "font 36px, box 788x100, line-height 1.35 -> 2 lines x 39 chars/line x 0.82 fill",
    },
  },

  quote: {
    templateKey: "quote",
    templateId: "5daf71d6-8aeb-4c8b-b542-27557057ed5a",
    // No headline_text/body_text layer on the real Quote template either.
    heading: null,
    body: null,
    quoteText: {
      layer: "quote_text",
      maxChars: 68,
      derivation: "font 56px, box 880x220, line-height 1.25 -> 3 lines x 28 chars/line x 0.82 fill",
      evidence: 'Real quote text ("Not interested versus interested is the wrong lens...", 99 chars) exceeded this limit — a real, undersized-container risk once "quote" ever becomes reachable again.',
    },
    // Deliberately no attributionName/attributionRole entries at all —
    // I032 must never populate those fields regardless of length; see
    // this file's own header comment on the Quote template's defect.
  },

  takeaway: {
    templateKey: "infographic",
    templateId: "bb18c409-9c96-4430-98ed-5812519134b2",
    heading: {
      layer: "headline_text",
      maxChars: 42,
      derivation: "font 56px, box 820x140, line-height 1.15 -> 2 lines x 26 chars/line x 0.82 fill",
    },
    // No separate body_text layer on the Infographic template — the
    // takeaway role's own real content lives entirely in keyPoints.
    body: null,
    keyPoints: {
      maxItems: 4,
      itemMaxChars: 46,
      derivation:
        "step_N_description: font 17px, box 182x90, line-height 1.5 -> 3 lines x 19 chars/line x 0.82 fill. " +
        "step_N_title (a mechanically-truncated copy of the same point, existing behavior, untouched this round) has an even tighter real single-line capacity (~18 chars, font 22px box 222x32) — " +
        "a keyPoint within this 46-char limit is not guaranteed to also fit the title layer's own tighter space; flagged as a residual, distinct risk for a future text-capacity milestone, not solved here (see this milestone's own report).",
      evidence:
        'All four real key_points in the rejected carousel (69/83/80/94 chars) were 1.5x-2x this limit — the dominant confirmed cause of the reported infographic overflow.',
    },
  },

  cta: {
    templateKey: "cta",
    templateId: "366ceefc-d9ea-4fbc-9ffc-eac8f978fa59",
    heading: {
      layer: "headline_text",
      maxChars: 32,
      derivation: "font 72px, box 800x160, line-height 1.1, centered -> 2 lines x 20 chars/line x 0.82 fill",
      evidence: 'Real CTA-slide heading ("Reopen the Conversations Waiting on One Question", 50 chars) exceeded this limit.',
    },
    body: {
      layer: "body_text",
      maxChars: 67,
      derivation: "font 28px, box 640x100, line-height 1.55, centered -> 2 lines x 41 chars/line x 0.82 fill",
      evidence: "Real CTA-slide body (~195 chars, the full call_to_action sentence) was nearly 3x this limit.",
    },
    // DC-003-I033.1's single most consequential finding: the top-level
    // callToAction field is not only marketing copy — it is copied
    // verbatim onto this exact slide's own button_label layer
    // (templated-renderer-adapter.mjs's buildSlideSequence():
    // ctaMapping = callToAction on the final slide). That layer sits
    // inside a FIXED 272x64px button shape, not a flexible text box.
    ctaMapping: {
      layer: "button_label",
      maxChars: 24,
      singleLine: true,
      derivation: "font 20px, fixed 272x64px button (single-line by both geometry and UI convention) -> 24 chars/line, no wrap-fill discount",
      evidence:
        'The rejected carousel\'s callToAction ("Audit your CRM now for appraisal, buyer and landlord enquiries...", ~195 chars) was used verbatim as this button\'s own label — roughly 8x over capacity. This is the single dominant cause of the reported CTA-slide collision.',
    },
  },
};

function normalizeForCounting(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Non-empty-after-trim character count — the same counting convention
 * every canonical schema in this project already uses for minLength. */
export function countChars(value) {
  return normalizeForCounting(value).length;
}

/**
 * Checks one string value against one capacity entry (or `null`, meaning
 * "not rendered onto any Templated layer, no real constraint"). Never
 * throws — returns a plain result so callers decide what to do with a
 * violation (reject deterministically, never silently truncate/rewrite).
 */
export function checkFieldCapacity(value, capacityEntry) {
  if (!capacityEntry) return { compliant: true, length: countChars(value), maxChars: null };
  const length = countChars(value);
  return { compliant: length <= capacityEntry.maxChars, length, maxChars: capacityEntry.maxChars };
}

/**
 * DC-003-I033.1 — the pre-render capacity gate. Checks a renderer-
 * agnostic slideSequence (the exact shape createProductionPackage()
 * itself receives — { slideNumber, slideRole, headlineMapping,
 * bodyCopyMapping, ctaMapping, structuredContent: { statistic, quote,
 * keyPoints } }, six entries) against TEMPLATE_CAPACITY_CONTRACT.
 *
 * Never throws itself and never truncates/rewrites/drops anything —
 * returns `{ compliant, violations }`; `violations` is `[]` when
 * compliant. Each violation names the exact slide/field/limit/actual
 * length, safe to surface in an error message (never the actual
 * over-length string content itself, matching this project's own
 * established diagnostic-safety discipline).
 *
 * Unknown/malformed slideRole values are skipped here — that is
 * checkSlideSequence()'s own, already-run responsibility; this function
 * only ever runs on an input already confirmed structurally valid.
 */
export function validateSlideSequenceCapacity(slideSequence) {
  const violations = [];
  if (!Array.isArray(slideSequence)) return { compliant: true, violations };

  slideSequence.forEach((slide, index) => {
    const contract = TEMPLATE_CAPACITY_CONTRACT[slide?.slideRole];
    if (!contract) return;

    const heading = checkFieldCapacity(slide.headlineMapping, contract.heading);
    if (!heading.compliant) {
      violations.push({ slideIndex: index, slideRole: slide.slideRole, field: "headlineMapping", ...heading });
    }
    const body = checkFieldCapacity(slide.bodyCopyMapping, contract.body);
    if (!body.compliant) {
      violations.push({ slideIndex: index, slideRole: slide.slideRole, field: "bodyCopyMapping", ...body });
    }

    const structured = slide.structuredContent ?? {};

    if (contract.statisticValue && structured.statistic) {
      const statValue = checkFieldCapacity(structured.statistic.value, contract.statisticValue);
      if (!statValue.compliant) {
        violations.push({ slideIndex: index, slideRole: slide.slideRole, field: "structuredContent.statistic.value", ...statValue });
      }
      const statContext = checkFieldCapacity(structured.statistic.context, contract.statisticContext);
      if (!statContext.compliant) {
        violations.push({ slideIndex: index, slideRole: slide.slideRole, field: "structuredContent.statistic.context", ...statContext });
      }
    }

    if (contract.quoteText && structured.quote) {
      const quote = checkFieldCapacity(structured.quote.quoteText, contract.quoteText);
      if (!quote.compliant) {
        violations.push({ slideIndex: index, slideRole: slide.slideRole, field: "structuredContent.quote.quoteText", ...quote });
      }
    }

    if (contract.keyPoints) {
      const keyPoints = structured.keyPoints ?? [];
      if (keyPoints.length > contract.keyPoints.maxItems) {
        violations.push({
          slideIndex: index,
          slideRole: slide.slideRole,
          field: "structuredContent.keyPoints",
          compliant: false,
          length: keyPoints.length,
          maxChars: null,
          maxItems: contract.keyPoints.maxItems,
        });
      }
      keyPoints.forEach((point, itemIndex) => {
        const item = checkFieldCapacity(point, { maxChars: contract.keyPoints.itemMaxChars });
        if (!item.compliant) {
          violations.push({ slideIndex: index, slideRole: slide.slideRole, field: `structuredContent.keyPoints[${itemIndex}]`, ...item });
        }
      });
    }

    if (contract.ctaMapping) {
      const cta = checkFieldCapacity(slide.ctaMapping, contract.ctaMapping);
      if (!cta.compliant) {
        violations.push({ slideIndex: index, slideRole: slide.slideRole, field: "ctaMapping", ...cta });
      }
    }
  });

  return { compliant: violations.length === 0, violations };
}

// Human-readable per-role field label, in the vocabulary I032's own
// prompt already uses (heading/body/statistic.value/etc.), not
// Templated's internal layer names — kept here, next to the data it
// describes, so a future capacity change never needs a second prompt-
// text edit anywhere else.
const ROLE_ORDER = ["cover", "insight", "statistic", "evidence", "quote", "takeaway", "cta"];

/**
 * Renders TEMPLATE_CAPACITY_CONTRACT into the exact prompt text
 * social-media-package-prompt-builder.mjs embeds — the "smallest clean
 * mechanism" by which I032 receives these constraints: this function
 * IS the one canonical place the numbers become instructional text, so
 * a future contract change never needs a second, independent prompt
 * edit anywhere else (DC-003-I033.1's own "avoid duplicating capacity
 * constants" requirement, applied to the prompt layer too).
 */
export function describeCapacityForPrompt() {
  const lines = [];
  for (const role of ROLE_ORDER) {
    const contract = TEMPLATE_CAPACITY_CONTRACT[role];
    const parts = [];
    if (contract.heading) parts.push(`heading max ${contract.heading.maxChars} characters`);
    if (contract.body) parts.push(`body max ${contract.body.maxChars} characters`);
    if (contract.statisticValue) {
      parts.push(`statistic.value max ${contract.statisticValue.maxChars} characters — a short figure only (e.g. "63%", "$2.4M", "10x"), NEVER a comparison or multi-figure string (e.g. "80% vs 20%" does not fit)`);
    }
    if (contract.statisticContext) parts.push(`statistic.context max ${contract.statisticContext.maxChars} characters`);
    if (contract.quoteText) parts.push(`quote.quoteText max ${contract.quoteText.maxChars} characters (not available today — see "Position 4" above)`);
    if (contract.keyPoints) parts.push(`keyPoints: max ${contract.keyPoints.maxItems} items, each max ${contract.keyPoints.itemMaxChars} characters`);
    if (contract.ctaMapping) {
      parts.push(
        `callToAction max ${contract.ctaMapping.maxChars} characters — a short button label only (e.g. "Book your audit"), NEVER a full sentence, because it is rendered verbatim onto this slide's own small fixed-size button`
      );
    }
    lines.push(`  - ${role}: ${parts.join("; ")}.`);
  }
  return lines.join("\n");
}

// DC-003-I033.1 — regression coverage for the Template Capacity
// Contract: the canonical, single source of truth for how much text
// each real Templated template can physically hold. Direct regression
// coverage for the rejected carousel's (car_3479ca8ac2af40b8) three
// reported visual collisions — statistic, infographic, and CTA.

import test from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATE_CAPACITY_CONTRACT,
  TEMPLATE_CAPACITY_CONTRACT_VERSION,
  countChars,
  checkFieldCapacity,
  validateSlideSequenceCapacity,
  describeCapacityForPrompt,
} from "../../src/template-capacity-contract.mjs";

function buildSlide(overrides = {}) {
  return {
    slideNumber: 1,
    slideRole: "cover",
    headlineMapping: "Short.",
    bodyCopyMapping: "Short body.",
    ctaMapping: null,
    structuredContent: { statistic: null, quote: null, keyPoints: [] },
    ...overrides,
  };
}

// --- One canonical capacity definition --------------------------------

test("TEMPLATE_CAPACITY_CONTRACT is exported and versioned", () => {
  assert.equal(typeof TEMPLATE_CAPACITY_CONTRACT, "object");
  assert.equal(TEMPLATE_CAPACITY_CONTRACT_VERSION, "template-capacity.v1");
});

test("every one of the seven semantic slide roles has a contract entry", () => {
  for (const role of ["cover", "insight", "statistic", "evidence", "quote", "takeaway", "cta"]) {
    assert.ok(TEMPLATE_CAPACITY_CONTRACT[role], `expected a contract entry for role "${role}"`);
  }
});

test('"insight" and "evidence" reference the exact same capacity object — one canonical definition, never duplicated', () => {
  assert.equal(TEMPLATE_CAPACITY_CONTRACT.insight, TEMPLATE_CAPACITY_CONTRACT.evidence);
});

test("statistic and quote have no headline_text/body_text capacity — those layers do not exist on the real templates", () => {
  assert.equal(TEMPLATE_CAPACITY_CONTRACT.statistic.heading, null);
  assert.equal(TEMPLATE_CAPACITY_CONTRACT.statistic.body, null);
  assert.equal(TEMPLATE_CAPACITY_CONTRACT.quote.heading, null);
  assert.equal(TEMPLATE_CAPACITY_CONTRACT.quote.body, null);
});

test("the Quote template's own attribution layers have no capacity entry at all — I032 must never populate them regardless of length", () => {
  assert.equal(TEMPLATE_CAPACITY_CONTRACT.quote.attributionName, undefined);
  assert.equal(TEMPLATE_CAPACITY_CONTRACT.quote.attributionRole, undefined);
});

// --- checkFieldCapacity() / countChars() -------------------------------

test("countChars() counts trimmed length, matching this project's own minLength convention", () => {
  assert.equal(countChars("  hello  "), 5);
  assert.equal(countChars(""), 0);
  assert.equal(countChars(null), 0);
});

test("checkFieldCapacity() with a null capacity entry is always compliant — 'not rendered, no real constraint'", () => {
  const result = checkFieldCapacity("an arbitrarily long string that would never be rendered anywhere at all", null);
  assert.equal(result.compliant, true);
  assert.equal(result.maxChars, null);
});

test("checkFieldCapacity() reports compliant:false with the real limit and actual length when exceeded", () => {
  const result = checkFieldCapacity("12345678901", { maxChars: 5 });
  assert.equal(result.compliant, false);
  assert.equal(result.length, 11);
  assert.equal(result.maxChars, 5);
});

// --- Compliant content passes ------------------------------------------

test("validateSlideSequenceCapacity() reports compliant:true, violations:[] for content within every real limit", () => {
  const slides = [
    buildSlide({ slideNumber: 1, slideRole: "cover" }),
    buildSlide({ slideNumber: 2, slideRole: "insight" }),
    buildSlide({
      slideNumber: 3,
      slideRole: "statistic",
      structuredContent: { statistic: { value: "63%", context: "Short context." }, quote: null, keyPoints: [] },
    }),
    buildSlide({ slideNumber: 4, slideRole: "evidence" }),
    buildSlide({
      slideNumber: 5,
      slideRole: "takeaway",
      structuredContent: { statistic: null, quote: null, keyPoints: ["Short point one.", "Short point two."] },
    }),
    buildSlide({ slideNumber: 6, slideRole: "cta", ctaMapping: "Book your audit" }),
  ];
  const result = validateSlideSequenceCapacity(slides);
  assert.equal(result.compliant, true);
  assert.deepEqual(result.violations, []);
});

test("validateSlideSequenceCapacity() never throws and skips slides with an unrecognised slideRole", () => {
  const result = validateSlideSequenceCapacity([buildSlide({ slideRole: "not-a-real-role" })]);
  assert.equal(result.compliant, true);
});

test("validateSlideSequenceCapacity() returns compliant:true for a non-array input, never throws", () => {
  assert.doesNotThrow(() => validateSlideSequenceCapacity(undefined));
  assert.equal(validateSlideSequenceCapacity(null).compliant, true);
});

// --- Oversized headline/body/item content fails deterministically -----
// Direct regression coverage for the three reported failures.

test('statistic.value: "80% vs 20%" (the real rejected value) fails — a comparison string never fits the single-figure stat_value layer', () => {
  const slides = [buildSlide({ slideRole: "statistic", structuredContent: { statistic: { value: "80% vs 20%", context: "Short." }, quote: null, keyPoints: [] } })];
  const result = validateSlideSequenceCapacity(slides);
  assert.equal(result.compliant, false);
  const violation = result.violations.find((v) => v.field === "structuredContent.statistic.value");
  assert.ok(violation);
  assert.equal(violation.length, 10);
  assert.equal(violation.maxChars, TEMPLATE_CAPACITY_CONTRACT.statistic.statisticValue.maxChars);
});

test("infographic keyPoints: the four real rejected key_points (69/83/80/94 chars) each fail the step_N_description capacity", () => {
  const realRejectedKeyPoints = [
    "Owning a CRM and using its full capability are two different things",
    "Circumstances like job changes, settlements or price sensitivity shift over time",
    "Database Reactivation reframes 'interested vs not' to 'ready vs not ready yet'",
    "Reopening a stalled conversation isn't a cold approach — it's continuing where things paused",
  ];
  const slides = [buildSlide({ slideRole: "takeaway", structuredContent: { statistic: null, quote: null, keyPoints: realRejectedKeyPoints } })];
  const result = validateSlideSequenceCapacity(slides);
  assert.equal(result.compliant, false);
  const itemViolations = result.violations.filter((v) => v.field.startsWith("structuredContent.keyPoints["));
  assert.equal(itemViolations.length, 4, "all four real rejected key points must each independently fail");
});

test("CTA ctaMapping: the real rejected full call-to-action sentence (~195 chars) fails the fixed-size button_label capacity", () => {
  const realRejectedCta =
    "Audit your CRM now for appraisal, buyer and landlord enquiries from the past two years with no follow-up in the last six months, and reopen those conversations before spending more on new leads.";
  const slides = [buildSlide({ slideRole: "cta", ctaMapping: realRejectedCta })];
  const result = validateSlideSequenceCapacity(slides);
  assert.equal(result.compliant, false);
  const violation = result.violations.find((v) => v.field === "ctaMapping");
  assert.ok(violation);
  assert.equal(violation.maxChars, 24);
});

test("cover body: a full two-sentence paragraph (the real rejected cover body) fails — a genuine risk this investigation found beyond the three explicitly reported failures", () => {
  const realRejectedCoverBody =
    "Why timing, not interest, killed most of your lost enquiries. Agencies are paying twice for the same opportunities — once to acquire enquiries, and again to replace them with new ones.";
  const slides = [buildSlide({ slideRole: "cover", bodyCopyMapping: realRejectedCoverBody })];
  const result = validateSlideSequenceCapacity(slides);
  assert.equal(result.compliant, false);
  assert.ok(result.violations.some((v) => v.field === "bodyCopyMapping"));
});

test("oversized headline fails deterministically (cover heading over its own real limit)", () => {
  const tooLong = "This headline is deliberately written to be far longer than the cover template can ever physically hold on screen";
  const slides = [buildSlide({ slideRole: "cover", headlineMapping: tooLong })];
  const result = validateSlideSequenceCapacity(slides);
  assert.equal(result.compliant, false);
  assert.ok(result.violations.some((v) => v.field === "headlineMapping"));
});

// --- Infographic item-COUNT overflow (not just per-item length) -------

test("infographic item-count overflow (more than 4 keyPoints) fails deterministically", () => {
  const slides = [buildSlide({ slideRole: "takeaway", structuredContent: { statistic: null, quote: null, keyPoints: ["1.", "2.", "3.", "4.", "5."] } })];
  const result = validateSlideSequenceCapacity(slides);
  assert.equal(result.compliant, false);
  const violation = result.violations.find((v) => v.field === "structuredContent.keyPoints");
  assert.ok(violation);
  assert.equal(violation.length, 5);
  assert.equal(violation.maxItems, 4);
});

// --- No silent truncation/rewriting occurs -----------------------------

test("validateSlideSequenceCapacity() never mutates its input — the offending slideSequence is returned/reported verbatim, never truncated or rewritten", () => {
  const original = "Audit your CRM now for appraisal, buyer and landlord enquiries from the past two years.";
  const slides = [buildSlide({ slideRole: "cta", ctaMapping: original })];
  const beforeJson = JSON.stringify(slides);
  validateSlideSequenceCapacity(slides);
  assert.equal(JSON.stringify(slides), beforeJson, "input slides must be byte-identical after validation");
  assert.equal(slides[0].ctaMapping, original, "the offending string itself must never be shortened by this function");
});

test("a violation never includes the actual over-length string content — only field name/length/limit, safe to log", () => {
  const secretLookingLongString = "a secret-looking sentence that must never leak into any error or diagnostic output anywhere";
  const slides = [buildSlide({ slideRole: "cover", bodyCopyMapping: secretLookingLongString })];
  const result = validateSlideSequenceCapacity(slides);
  assert.doesNotMatch(JSON.stringify(result), /secret-looking/);
});

// --- describeCapacityForPrompt() (I032 integration surface) -----------

test("describeCapacityForPrompt() renders every role's own real limits as text, generated from the contract itself — never a second, independently-typed copy of the numbers", () => {
  const text = describeCapacityForPrompt();
  assert.match(text, new RegExp(`heading max ${TEMPLATE_CAPACITY_CONTRACT.cover.heading.maxChars} characters`));
  assert.match(text, new RegExp(`statistic\\.value max ${TEMPLATE_CAPACITY_CONTRACT.statistic.statisticValue.maxChars} characters`));
  assert.match(text, new RegExp(`callToAction max ${TEMPLATE_CAPACITY_CONTRACT.cta.ctaMapping.maxChars} characters`));
  assert.match(text, /keyPoints: max 4 items/);
});

test("describeCapacityForPrompt() explicitly warns that a comparison-style statistic value does not fit", () => {
  assert.match(describeCapacityForPrompt(), /NEVER a comparison or multi-figure string/);
});

test("describeCapacityForPrompt() explicitly explains why callToAction has such a short limit — it is a button label, not a sentence", () => {
  assert.match(describeCapacityForPrompt(), /short button label only/);
  assert.match(describeCapacityForPrompt(), /rendered verbatim onto this slide's own small fixed-size button/);
});

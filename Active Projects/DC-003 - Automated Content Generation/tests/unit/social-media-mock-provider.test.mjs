import test from "node:test";
import assert from "node:assert/strict";
import { createSocialMediaMockProvider } from "../../src/social-media-mock-provider.mjs";
import { assertValidSocialMediaResult } from "../../src/social-media-provider.mjs";
import { TEMPLATE_CAPACITY_CONTRACT, checkFieldCapacity } from "../../src/template-capacity-contract.mjs";

function buildEditorialPackage(overrides = {}) {
  return {
    primary_headline: "Why Local Businesses Need a Digital Marketing Strategy",
    supporting_headline: "A practical look at digital marketing in 2026",
    core_message: "A coherent digital marketing strategy is no longer optional.",
    desired_outcome: "The reader adopts a structured, three-pillar approach.",
    primary_problem: "Marketing activity is scattered and inconsistent.",
    executive_summary: "Local businesses are discovering that a coherent strategy matters.",
    primary_audience: "Owners and marketing leads at small and mid-sized local businesses",
    call_to_action: "Learn more about building a digital marketing strategy",
    key_insights: ["Search visibility matters because most journeys begin with a search.", "Social proof compounds trust over time."],
    pull_quotes: ["A coherent digital marketing strategy is no longer optional."],
    suggested_hashtags: ["digitalmarketing", "localbusiness", "seo", "contentmarketing"],
    ...overrides,
  };
}

test("generateSocialMedia() returns a raw JSON string that passes assertValidSocialMediaResult()", async () => {
  const provider = createSocialMediaMockProvider();
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: buildEditorialPackage() });
  assert.equal(typeof raw, "string");
  const parsed = JSON.parse(raw);
  assert.doesNotThrow(() => assertValidSocialMediaResult(parsed));
});

test("is deterministic — the same Editorial Package always produces the exact same output", async () => {
  const provider = createSocialMediaMockProvider();
  const a = await provider.generateSocialMedia("prompt", { editorialPackage: buildEditorialPackage() });
  const b = await provider.generateSocialMedia("prompt", { editorialPackage: buildEditorialPackage() });
  assert.equal(a, b);
});

test("hook mirrors the Editorial Package's own primary_headline", async () => {
  const provider = createSocialMediaMockProvider();
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: buildEditorialPackage({ primary_headline: "A Distinct Headline" }) });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.hook, "A Distinct Headline");
});

test("X post text never exceeds the 280-character platform limit, even for a very long headline", async () => {
  const provider = createSocialMediaMockProvider();
  const longHeadline = "A ".repeat(200) + "Very Long Headline";
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: buildEditorialPackage({ primary_headline: longHeadline }) });
  const parsed = JSON.parse(raw);
  assert.ok(parsed.platforms.x.postText.length <= 280, `x.postText was ${parsed.platforms.x.postText.length} chars`);
});

test("carousel headings/slideCopy/imageGuidance each have exactly 6 entries drawn from real Editorial Package content", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage();
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.carousel.headings.length, 6);
  assert.equal(parsed.carousel.slideCopy.length, 6);
  assert.equal(parsed.carousel.imageGuidance.length, 6);
  const pool = [ep.primary_headline, ep.supporting_headline, ep.core_message, ep.desired_outcome, ep.primary_problem, ep.executive_summary, ep.call_to_action, ...ep.key_insights, ...ep.pull_quotes];
  for (const copy of parsed.carousel.slideCopy) {
    assert.ok(pool.includes(copy), `expected "${copy}" to be a real Editorial Package string, not fabricated`);
  }
});

test("hashtags reused as-is are real Editorial Package suggested_hashtags, never fabricated", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage();
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  for (const tag of parsed.platforms.linkedin.hashtags) {
    assert.ok(ep.suggested_hashtags.includes(tag), `expected "${tag}" to be a real suggested_hashtags entry`);
  }
});

test("still returns a fully valid result for an Editorial Package with only the minimum required fields", async () => {
  const provider = createSocialMediaMockProvider();
  const minimal = buildEditorialPackage({ key_insights: [], pull_quotes: [], suggested_hashtags: [] });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: minimal });
  const parsed = JSON.parse(raw);
  assert.doesNotThrow(() => assertValidSocialMediaResult(parsed));
});

test("throws a plain Error when context.editorialPackage is missing", async () => {
  const provider = createSocialMediaMockProvider();
  await assert.rejects(() => provider.generateSocialMedia("prompt", {}));
});

// --- DC-003-I032.1 — semantic six-role carousel ------------------------
// DC-003-I032.6 — position 4 is "evidence", never "quote" — see
// social-media-mock-provider.mjs's own header comment for why.

const EXPECTED_ROLE_ORDER = ["cover", "insight", "statistic", "evidence", "takeaway", "cta"];

test("carousel.slides has exactly 6 entries in the fixed positional role order", async () => {
  const provider = createSocialMediaMockProvider();
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: buildEditorialPackage() });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.carousel.slides.length, 6);
  parsed.carousel.slides.forEach((slide, index) => {
    assert.equal(slide.slideNumber, index + 1);
    assert.equal(slide.slideRole, EXPECTED_ROLE_ORDER[index]);
  });
});

test("carousel.slides[].heading/body/imageGuidance are byte-identical to the legacy headings/slideCopy/imageGuidance arrays at the same position", async () => {
  const provider = createSocialMediaMockProvider();
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: buildEditorialPackage() });
  const parsed = JSON.parse(raw);
  parsed.carousel.slides.forEach((slide, index) => {
    assert.equal(slide.heading, parsed.carousel.headings[index]);
    assert.equal(slide.body, parsed.carousel.slideCopy[index]);
    assert.equal(slide.imageGuidance, parsed.carousel.imageGuidance[index]);
  });
});

test("only the statistic slide ever carries a non-null statistic, and no slide ever carries a non-null quote (DC-003-I032.6 — the mock never produces the \"quote\" role)", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({ key_insights: ["Nearly 73% of local searches lead to a same-day visit.", "Social proof compounds trust over time."] });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  parsed.carousel.slides.forEach((slide) => {
    if (slide.slideRole !== "statistic") assert.equal(slide.statistic, null, `${slide.slideRole} slide must never carry a statistic`);
    assert.equal(slide.quote, null, `${slide.slideRole} slide must never carry a quote — no slide is ever the "quote" role`);
    if (slide.slideRole !== "takeaway") assert.deepEqual(slide.keyPoints, [], `${slide.slideRole} slide must never carry keyPoints`);
  });
});

test("statistic-with-evidence: a real percentage present in a key insight is detected verbatim, never re-derived or rounded", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({
    key_insights: ["Nearly 73% of local searches lead to a same-day store visit.", "Social proof compounds trust over time."],
  });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  const statisticSlide = parsed.carousel.slides.find((s) => s.slideRole === "statistic");
  assert.deepEqual(statisticSlide.statistic, {
    value: "73%",
    context: "Nearly 73% of local searches lead to a same-day store visit.",
  });
});

test("statistic-without-evidence: no percentage/currency/magnitude figure anywhere in the Editorial Package yields statistic: null, never a fabricated figure", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage(); // buildEditorialPackage()'s own default content has no detectable figure
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  const statisticSlide = parsed.carousel.slides.find((s) => s.slideRole === "statistic");
  assert.equal(statisticSlide.statistic, null);
  // Fallback heading/body still real Editorial Package content, not a placeholder string.
  assert.ok(statisticSlide.body.length > 0);
  const pool = [ep.primary_headline, ep.supporting_headline, ep.core_message, ep.desired_outcome, ep.primary_problem, ep.executive_summary, ...ep.key_insights, ...ep.pull_quotes];
  assert.ok(pool.includes(statisticSlide.body), "fallback statistic-slide body must be real Editorial Package content");
});

test("a bare year or list-style number is never misread as a statistic", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({ key_insights: ["This trend accelerated through 2026 and shows no sign of slowing.", "Social proof compounds trust over time."] });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  const statisticSlide = parsed.carousel.slides.find((s) => s.slideRole === "statistic");
  assert.equal(statisticSlide.statistic, null, "a bare year must not be treated as a real statistic");
});

// --- DC-003-I032.6 — position 4 is "evidence", never "quote" ----------
// This pipeline's own canonical contracts never carry genuine external-
// attribution data for any pull quote (pullQuotes are article/author
// excerpts, never third-party testimony), so a deterministic mock never
// claims "quote" at all. "evidence" reuses a second real, distinct key
// insight — never the same string position 2's "insight" slide already
// used — falling back to a real pull quote's own plain text (still
// never quotation-styled) and finally to core_message.

test('evidence slide (position 4) uses the SECOND real key insight, distinct from position 2\'s "insight" slide, when one exists', async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({ key_insights: ["First real insight.", "Second real insight, distinct from the first."] });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  const insightSlide = parsed.carousel.slides.find((s) => s.slideRole === "insight");
  const evidenceSlide = parsed.carousel.slides.find((s) => s.slideRole === "evidence");
  assert.equal(insightSlide.body, "First real insight.");
  assert.equal(evidenceSlide.body, "Second real insight, distinct from the first.");
  assert.notEqual(evidenceSlide.body, insightSlide.body);
});

test("evidence slide falls back to a real pull quote's own plain text when fewer than 2 key insights exist — reused as ordinary body copy, never quotation-styled", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({ key_insights: ["Only one real insight exists here."], pull_quotes: ["A coherent digital marketing strategy is no longer optional."] });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  const evidenceSlide = parsed.carousel.slides.find((s) => s.slideRole === "evidence");
  assert.equal(evidenceSlide.body, "A coherent digital marketing strategy is no longer optional.");
  assert.equal(evidenceSlide.quote, null, "the pull quote is reused as ordinary body copy, never wrapped in a quote object");
});

test("evidence slide falls back to core_message when neither a second key insight nor any pull quote exists", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({ key_insights: ["Only one real insight exists here."], pull_quotes: [] });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  const evidenceSlide = parsed.carousel.slides.find((s) => s.slideRole === "evidence");
  assert.equal(evidenceSlide.body, ep.core_message);
  assert.equal(evidenceSlide.quote, null);
});

test("evidence slide's quote field is always null, and no attribution field of any kind ever appears on it — never a fabricated speaker/attribution", async () => {
  const provider = createSocialMediaMockProvider();
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: buildEditorialPackage() });
  const parsed = JSON.parse(raw);
  const evidenceSlide = parsed.carousel.slides.find((s) => s.slideRole === "evidence");
  assert.equal(evidenceSlide.quote, null);
  assert.ok(!("attribution" in evidenceSlide), "evidence slide must never carry an attribution field");
  assert.ok(!("attributionName" in evidenceSlide));
  assert.ok(!("attributionRole" in evidenceSlide));
});

test('no slide anywhere in the carousel is ever the "quote" role — confirms the mock never fabricates external-attribution capability it does not have', async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({ pull_quotes: ["A coherent digital marketing strategy is no longer optional."] });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.carousel.slides.some((s) => s.slideRole === "quote"), false);
});

test("takeaway slide's keyPoints holds only real key_insights entries, never padded to 4 with invented content", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({ key_insights: ["Only one real insight exists here."] });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  const takeawaySlide = parsed.carousel.slides.find((s) => s.slideRole === "takeaway");
  assert.deepEqual(takeawaySlide.keyPoints, ["Only one real insight exists here."]);
});

test("takeaway slide's keyPoints caps at 4 even when more than 4 real key insights exist", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({ key_insights: ["Insight one.", "Insight two.", "Insight three.", "Insight four.", "Insight five."] });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  const takeawaySlide = parsed.carousel.slides.find((s) => s.slideRole === "takeaway");
  assert.equal(takeawaySlide.keyPoints.length, 4);
  assert.deepEqual(takeawaySlide.keyPoints, ["Insight one.", "Insight two.", "Insight three.", "Insight four."]);
});

// --- DC-003-I031.8 — industryContext: the mock always returns null,
// even for an Editorial Package whose primary_audience clearly names a
// specific industry (e.g. real estate) — a deterministic mock has no
// non-guessing way to judge that, so it never invents one. See
// social-media-mock-provider.mjs's own header comment for the full
// rationale. The real Anthropic provider is where a genuine value comes
// from — see social-media-anthropic-provider.test.mjs.

test("industryContext is always null from the mock provider, even for a strongly industry-specific primary_audience", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({ primary_audience: "Real estate agency principals, agents and property management leaders" });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.industryContext, null);
});

// --- DC-003-I033.1 — the mock provider generates capacity-compliant
// content BY CONSTRUCTION (mechanical truncation, never a fabricated
// substitute), exactly like the real Anthropic provider is now
// instructed to do from the start. Uses genuinely long, realistic
// source content (matching the real GS01 article's own scale) to prove
// this holds for real-world-length input, not only short test strings.

test("every rendered field the mock provider produces stays within its own real Template Capacity Contract limit, even for long real-world-length source content", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({
    primary_headline: "A very long primary headline that runs on well past what any cover slide could ever comfortably display on screen",
    core_message: "A long core message full of real editorial detail that would, if reused verbatim as body copy on several different carousel slides, run far past what those slides' own body_text containers can actually hold without visually overlapping other elements on the same slide.",
    desired_outcome: "A long desired outcome sentence that, like the core message above, would overflow the takeaway slide's own heading if it were ever used there without being shortened first.",
    call_to_action: "A long call to action sentence describing exactly what the reader should do next, written the way a real marketer would write full CTA copy rather than a short three-word button label.",
    key_insights: [
      "The first real key insight, written at a normal editorial sentence length rather than an artificially short test string.",
      "A second real key insight, also written at normal length, that will become the evidence slide's own body copy.",
      "A third, fourth, and effectively unlimited number of real key insights could exist here, each at full editorial length.",
      "A fourth real key insight, at the same normal length as all the others above it in this list.",
    ],
  });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  const parsed = JSON.parse(raw);

  const ctaCheck = checkFieldCapacity(parsed.callToAction, TEMPLATE_CAPACITY_CONTRACT.cta.ctaMapping);
  assert.equal(ctaCheck.compliant, true, `callToAction (${ctaCheck.length} chars) must fit the button_label limit (${ctaCheck.maxChars})`);

  parsed.carousel.slides.forEach((slide) => {
    const contract = TEMPLATE_CAPACITY_CONTRACT[slide.slideRole];
    const headingCheck = checkFieldCapacity(slide.heading, contract.heading);
    assert.equal(headingCheck.compliant, true, `${slide.slideRole} heading (${headingCheck.length} chars) must fit (max ${headingCheck.maxChars})`);
    const bodyCheck = checkFieldCapacity(slide.body, contract.body);
    assert.equal(bodyCheck.compliant, true, `${slide.slideRole} body (${bodyCheck.length} chars) must fit (max ${bodyCheck.maxChars})`);
    if (slide.slideRole === "takeaway") {
      for (const point of slide.keyPoints) {
        const itemCheck = checkFieldCapacity(point, { maxChars: contract.keyPoints.itemMaxChars });
        assert.equal(itemCheck.compliant, true, `keyPoints item (${itemCheck.length} chars) must fit (max ${itemCheck.maxChars})`);
      }
    }
  });
});

test("mock provider's own capacity-compliant output still passes assertValidSocialMediaResult() unchanged — truncation never breaks structural validity", async () => {
  const provider = createSocialMediaMockProvider();
  const ep = buildEditorialPackage({
    core_message: "A long core message that will be mechanically truncated to fit its destination template's own real capacity by the mock provider itself.",
  });
  const raw = await provider.generateSocialMedia("prompt", { editorialPackage: ep });
  assert.doesNotThrow(() => assertValidSocialMediaResult(JSON.parse(raw)));
});

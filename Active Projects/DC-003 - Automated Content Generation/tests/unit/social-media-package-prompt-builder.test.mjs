import test from "node:test";
import assert from "node:assert/strict";
import { buildSocialMediaPackagePrompt, PROMPT_VERSION } from "../../src/social-media-package-prompt-builder.mjs";
import { SocialMediaPromptBuilderError } from "../../src/social-media-analysis-errors.mjs";

function buildEditorialPackage(overrides = {}) {
  return {
    primary_headline: "Why Digital Marketing Matters",
    core_message: "A coherent strategy is no longer optional.",
    primary_audience: "Owners and marketing leads.",
    key_insights: ["Insight one.", "Insight two."],
    pull_quotes: ["Quote one."],
    call_to_action: "Learn more today.",
    suggested_hashtags: ["digitalmarketing", "seo"],
    ...overrides,
  };
}

test("builds a deterministic prompt containing the headline, core message, and call to action", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage());
  assert.match(prompt, /Why Digital Marketing Matters/);
  assert.match(prompt, /A coherent strategy is no longer optional\./);
  assert.match(prompt, /Learn more today\./);
  assert.match(prompt, /Return JSON only/);
});

test("is a pure function — the same Editorial Package always produces the exact same prompt", () => {
  const ep = buildEditorialPackage();
  assert.equal(buildSocialMediaPackagePrompt(ep), buildSocialMediaPackagePrompt(ep));
});

test("collapses internal whitespace/newlines in the headline and core message", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage({ primary_headline: "Title\nwith\nnewlines", core_message: "Message   with    extra   spaces." }));
  assert.match(prompt, /Title with newlines/);
  assert.match(prompt, /Message with extra spaces\./);
});

test("throws SocialMediaPromptBuilderError when primary_headline is blank", () => {
  assert.throws(() => buildSocialMediaPackagePrompt(buildEditorialPackage({ primary_headline: "" })), SocialMediaPromptBuilderError);
});

test("throws SocialMediaPromptBuilderError when core_message is blank", () => {
  assert.throws(() => buildSocialMediaPackagePrompt(buildEditorialPackage({ core_message: "   " })), SocialMediaPromptBuilderError);
});

test("throws SocialMediaPromptBuilderError when call_to_action is blank", () => {
  assert.throws(() => buildSocialMediaPackagePrompt(buildEditorialPackage({ call_to_action: "" })), SocialMediaPromptBuilderError);
});

test("never reads ingested content or raw article fields — only Editorial Package fields", () => {
  const ep = buildEditorialPackage();
  const prompt = buildSocialMediaPackagePrompt(ep);
  assert.doesNotMatch(prompt, /full_article_text/);
});

test("PROMPT_VERSION is exported and stable", () => {
  assert.equal(PROMPT_VERSION, "social-media-package.v3");
});

// --- DC-003-I032.1 — six semantic roles / evidence-only policy in the prompt

test("prompt enumerates the six fixed semantic slide roles in order", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage());
  assert.match(prompt, /1\. cover/);
  assert.match(prompt, /2\. insight/);
  assert.match(prompt, /3\. statistic/);
  assert.match(prompt, /4\. quote/);
  assert.match(prompt, /5\. takeaway/);
  assert.match(prompt, /6\. cta/);
});

test("prompt states the evidence-only policy for statistics and quotes explicitly", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage());
  assert.match(prompt, /statistic.*MUST be null unless a real number/s);
  assert.match(prompt, /quote.*MUST be null unless a real quote genuinely exists/s);
  assert.match(prompt, /never invent a speaker name or title/);
});

test("prompt describes the carousel.slides output shape with slideRole/statistic/quote/keyPoints", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage());
  assert.match(prompt, /"slideRole"/);
  assert.match(prompt, /"statistic"/);
  assert.match(prompt, /"quote"/);
  assert.match(prompt, /"keyPoints"/);
});

// --- DC-003-I031.8 — industry/audience context is received explicitly
// and the generation contract instructs the model to preserve it,
// generically (not hardcoded to any one industry), across every field —
// not only the audience/hook fields. -----------------------------------

test("prompt includes the Primary audience section verbatim — the boundary that already carries industry context intact", () => {
  const prompt = buildSocialMediaPackagePrompt(
    buildEditorialPackage({ primary_audience: "Real estate agency principals, agents and property management leaders" })
  );
  assert.match(prompt, /## Primary audience/);
  assert.match(prompt, /Real estate agency principals, agents and property management leaders/);
});

test("prompt instructs the model to read Primary audience for a specific industry/sector, not only a job title", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage());
  assert.match(prompt, /Industry\/audience specificity/i);
  assert.match(prompt, /specific industry, sector, or professional domain/i);
});

test("prompt instructs applying industry specificity across EVERY generated field, not only cover/CTA", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage());
  assert.match(prompt, /hook, platform posts, and EVERY carousel slide \(not only the cover\/CTA\)/);
});

test("prompt explicitly instructs setting industryContext to null when no specific domain is clearly supported — never inventing one", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage());
  assert.match(prompt, /set `industryContext` to null and write in general business terms/);
  assert.match(prompt, /Never invent or guess a domain the source doesn't support/);
});

test("prompt's illustrative real-estate example is clearly an example, not a hardcoded assumption — the instruction itself stays conditional on the source", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage());
  assert.match(prompt, /if the domain is real estate, prefer the source's own terms such as vendors, buyers, landlords, agencies, property enquiries/);
  // The example is scoped by "e.g." / "if the domain is X" phrasing, and the
  // very next sentence explicitly requires nulling out when unsupported —
  // never an unconditional real-estate assumption.
  assert.match(prompt, /If no specific domain is clearly supported/);
});

test("output format documents industryContext as string-or-null", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage());
  assert.match(prompt, /"industryContext": string or null/);
});

test("never hardcodes a specific industry into the REQUIRED instructions — real estate appears only as one of several illustrative examples", () => {
  const prompt = buildSocialMediaPackagePrompt(buildEditorialPackage({ primary_audience: "Marketing managers at mid-sized companies" }));
  const realEstateMentions = prompt.match(/real estate/gi) ?? [];
  // Exactly two mentions, both inside fixed instructional text (one in a
  // multi-industry example list alongside healthcare/hospitality/B2B
  // SaaS, one inside a conditional "if the domain is X" illustration) —
  // never derived from or multiplied by the actual Editorial Package
  // content, which here has nothing to do with real estate at all.
  assert.equal(realEstateMentions.length, 2);
  assert.match(prompt, /e\.g\. real estate, healthcare, hospitality, B2B SaaS/);
});

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
  assert.equal(PROMPT_VERSION, "social-media-package.v1");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createSocialMediaMockProvider } from "../../src/social-media-mock-provider.mjs";
import { assertValidSocialMediaResult } from "../../src/social-media-provider.mjs";

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
  const pool = [ep.primary_headline, ep.supporting_headline, ep.core_message, ep.desired_outcome, ep.primary_problem, ep.executive_summary, ...ep.key_insights, ...ep.pull_quotes];
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

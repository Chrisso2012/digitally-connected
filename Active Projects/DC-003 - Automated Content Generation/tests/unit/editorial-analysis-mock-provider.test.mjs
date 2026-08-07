import test from "node:test";
import assert from "node:assert/strict";
import { createEditorialAnalysisMockProvider } from "../../src/editorial-analysis-mock-provider.mjs";
import { assertValidEditorialAnalysisResult } from "../../src/editorial-analysis-provider.mjs";

const ARTICLE_BODY =
  "Search visibility matters because most buying journeys begin with a search engine query. Social proof compounds trust " +
  "over time in a way advertising alone cannot buy. Content consistency is rewarded by both algorithms and audiences. " +
  "A clear content calendar turns scattered activity into a repeatable system.";

function buildIngestedContent(overrides = {}) {
  return { title: "Why Digital Marketing Matters", full_article_text: ARTICLE_BODY, ...overrides };
}

test("analyzeContent() returns a raw JSON string that passes assertValidEditorialAnalysisResult()", async () => {
  const provider = createEditorialAnalysisMockProvider();
  const raw = await provider.analyzeContent("prompt", { ingestedContent: buildIngestedContent() });
  assert.equal(typeof raw, "string");
  const parsed = JSON.parse(raw);
  assert.doesNotThrow(() => assertValidEditorialAnalysisResult(parsed));
});

test("is deterministic — the same Ingested Content always produces the exact same output", async () => {
  const provider = createEditorialAnalysisMockProvider();
  const a = await provider.analyzeContent("prompt", { ingestedContent: buildIngestedContent() });
  const b = await provider.analyzeContent("prompt", { ingestedContent: buildIngestedContent() });
  assert.equal(a, b);
});

test("primaryHeadline mirrors the Ingested Content's own title", async () => {
  const provider = createEditorialAnalysisMockProvider();
  const raw = await provider.analyzeContent("prompt", { ingestedContent: buildIngestedContent({ title: "A Distinct Title" }) });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.primaryHeadline, "A Distinct Title");
});

test("pullQuotes and keyInsights are drawn verbatim from the article body, not fabricated", async () => {
  const provider = createEditorialAnalysisMockProvider();
  const raw = await provider.analyzeContent("prompt", { ingestedContent: buildIngestedContent() });
  const parsed = JSON.parse(raw);
  for (const quote of parsed.pullQuotes) {
    assert.ok(ARTICLE_BODY.includes(quote), `expected "${quote}" to be a real substring of the article body`);
  }
});

test("seoTitle and seoDescription respect their length constraints", async () => {
  const provider = createEditorialAnalysisMockProvider();
  const longTitle = "A Very Long Title That Definitely Exceeds Sixty Characters In Total Length For Testing";
  const raw = await provider.analyzeContent("prompt", { ingestedContent: buildIngestedContent({ title: longTitle }) });
  const parsed = JSON.parse(raw);
  assert.ok(parsed.seoTitle.length <= 60, `seoTitle was ${parsed.seoTitle.length} chars`);
  assert.ok(parsed.seoDescription.length <= 160, `seoDescription was ${parsed.seoDescription.length} chars`);
});

test("still returns a fully valid result for input with no sentence-ending punctuation (defensive fallback)", async () => {
  const provider = createEditorialAnalysisMockProvider();
  const raw = await provider.analyzeContent("prompt", { ingestedContent: buildIngestedContent({ full_article_text: "word ".repeat(210) }) });
  const parsed = JSON.parse(raw);
  assert.doesNotThrow(() => assertValidEditorialAnalysisResult(parsed));
});

test("throws a plain Error when context.ingestedContent is missing", async () => {
  const provider = createEditorialAnalysisMockProvider();
  await assert.rejects(() => provider.analyzeContent("prompt", {}));
});

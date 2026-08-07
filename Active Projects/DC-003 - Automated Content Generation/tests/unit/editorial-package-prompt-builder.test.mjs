import test from "node:test";
import assert from "node:assert/strict";
import { buildEditorialPackagePrompt, PROMPT_VERSION } from "../../src/editorial-package-prompt-builder.mjs";
import { EditorialPromptBuilderError } from "../../src/editorial-analysis-errors.mjs";

function buildIngestedContent(overrides = {}) {
  return { title: "Why Digital Marketing Matters", full_article_text: "A real article body with enough content to prompt from.", ...overrides };
}

test("builds a deterministic prompt containing the title and body", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  assert.match(prompt, /Why Digital Marketing Matters/);
  assert.match(prompt, /A real article body with enough content to prompt from\./);
  assert.match(prompt, /Return JSON only/);
});

test("is a pure function — the same Ingested Content always produces the exact same prompt", () => {
  const ic = buildIngestedContent();
  assert.equal(buildEditorialPackagePrompt(ic), buildEditorialPackagePrompt(ic));
});

test("collapses internal whitespace/newlines in title and body", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent({ title: "Title\nwith\nnewlines", full_article_text: "Body   with    extra   spaces." }));
  assert.match(prompt, /Title with newlines/);
  assert.match(prompt, /Body with extra spaces\./);
});

test("throws EditorialPromptBuilderError when title is blank", () => {
  assert.throws(() => buildEditorialPackagePrompt(buildIngestedContent({ title: "" })), EditorialPromptBuilderError);
});

test("throws EditorialPromptBuilderError when full_article_text is blank", () => {
  assert.throws(() => buildEditorialPackagePrompt(buildIngestedContent({ full_article_text: "   " })), EditorialPromptBuilderError);
});

test("PROMPT_VERSION is exported and stable", () => {
  assert.equal(PROMPT_VERSION, "editorial-package.v1");
});

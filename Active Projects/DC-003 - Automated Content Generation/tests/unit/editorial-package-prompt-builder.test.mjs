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
  assert.equal(PROMPT_VERSION, "editorial-package.v2");
});

// --- DC-003-I031.6 — the prompt must explicitly require native JSON
// arrays for all six canonical array<string> fields and explicitly
// forbid XML/tag/pseudo-list serialisation, reproducing the exact
// contract gap a genuine live response exposed (every one of these six
// fields came back as a single "<item>...</item>"-tagged string). ------

const CANONICAL_ARRAY_FIELDS = ["keyInsights", "pullQuotes", "keywords", "suggestedHashtags", "editorialThemes", "contentCategories"];

test("prompt explicitly requires a native JSON array (not a single string) for every canonical array field", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  for (const field of CANONICAL_ARRAY_FIELDS) {
    const fieldLine = prompt.split("\n").find((line) => line.includes(`"${field}"`));
    assert.ok(fieldLine, `expected an Output format line naming "${field}"`);
    assert.match(fieldLine, /native JSON array/i);
  }
});

test("prompt explicitly forbids XML tags and <item> wrappers for the canonical array fields", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  assert.match(prompt, /XML tags/i);
  assert.match(prompt, /<item>/);
  assert.match(prompt, /NOT.*XML-tagged|XML-tagged.*NOT/i);
});

test("prompt explicitly forbids newline-delimited and comma-delimited pseudo-lists inside a single string", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  assert.match(prompt, /newline-delimited/i);
  assert.match(prompt, /comma-delimited/i);
});

test("prompt does not itself use or exemplify <item> tag formatting anywhere outside the explicit prohibition", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  const itemTagOccurrences = (prompt.match(/<item>/g) || []).length;
  // The tag appears only as a literal example inside the prohibition
  // sentences themselves (Writing constraints + each Output format
  // line) — never as something the model is shown using approvingly,
  // and never repeated so often it could read as a pattern to imitate.
  assert.ok(itemTagOccurrences >= 1 && itemTagOccurrences <= 2, `expected 1-2 prohibition-only mentions of <item>, found ${itemTagOccurrences}`);
});

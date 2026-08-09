import test from "node:test";
import assert from "node:assert/strict";
import { buildEditorialPackagePrompt, PROMPT_VERSION, FIELD_RICHNESS_TARGETS } from "../../src/editorial-package-prompt-builder.mjs";
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
  assert.equal(PROMPT_VERSION, "editorial-package.v3");
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

// --- DC-003-I031.7 — bounded richness/cardinality guidance for the six
// canonical array fields, closing the "technically valid but only one
// item each" gap a genuine live response exposed. Every assertion here
// checks the PROMPT TEXT communicates the target, never that the model
// actually complies (that can only be observed live) — and separately
// confirms the targets are pure guidance, never a hard structural floor
// this milestone could use to force fabrication. -----------------------

test("FIELD_RICHNESS_TARGETS defines a sensible min/max for exactly the six canonical array fields", () => {
  assert.deepEqual(Object.keys(FIELD_RICHNESS_TARGETS).sort(), [...CANONICAL_ARRAY_FIELDS].sort());
  for (const [field, target] of Object.entries(FIELD_RICHNESS_TARGETS)) {
    assert.ok(Number.isInteger(target.min) && target.min >= 1, `${field}.min must be a positive integer`);
    assert.ok(Number.isInteger(target.max) && target.max >= target.min, `${field}.max must be >= min`);
    assert.equal(typeof target.purpose, "string", `${field} must document its own editorial purpose`);
  }
});

test("prompt states each canonical field's own target item-count range", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  for (const [field, target] of Object.entries(FIELD_RICHNESS_TARGETS)) {
    const outputFormatLine = prompt.split("\n").find((line) => line.trim().startsWith(`"${field}"`));
    assert.ok(outputFormatLine, `expected an Output format line for "${field}"`);
    assert.match(outputFormatLine, new RegExp(`target ${target.min}-${target.max} distinct items`), `${field}'s Output format line must state its own target range`);
  }
});

test("prompt explicitly forbids fabricating or padding items to reach the target", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  assert.match(prompt, /never fabricate/i);
  assert.match(prompt, /near-duplicate|trivially-reworded/i);
});

test("prompt explicitly permits returning fewer than the target when the article genuinely supports fewer", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  assert.match(prompt, /genuinely supports fewer|honestly supports fewer/i);
});

test("prompt warns against satisfying a field with a single overly-generic item when richer content exists", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  assert.match(prompt, /single overly-broad, generic item|single generic item/i);
});

test("prompt preserves pullQuotes' own stricter verbatim/near-verbatim rule alongside its richness target — never a manufactured quote", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  assert.match(prompt, /verbatim \(or near-verbatim\) sentences drawn from the article body, not paraphrases/);
  assert.match(prompt, /never manufacture a quotation/i);
});

test("richness targets are guidance only — the prompt frames them as targets/aims, not hard requirements", () => {
  const prompt = buildEditorialPackagePrompt(buildIngestedContent());
  assert.match(prompt, /targets, not hard requirements/i);
});

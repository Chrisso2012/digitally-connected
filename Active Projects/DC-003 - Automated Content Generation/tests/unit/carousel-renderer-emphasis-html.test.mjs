// DC-003-I035 — regression coverage for carousel-renderer-emphasis-html.mjs.
// Includes a direct regression test for the off-by-one bug found and fixed
// during this milestone's own development (a probed prefix ending exactly
// on a space had that space silently trimmed by normalizeForEmphasisMatching(),
// undercounting the match boundary by one character — confirmed via a real
// render showing "interested or not" losing its leading "i").

import test from "node:test";
import assert from "node:assert/strict";
import { findOriginalMatchRange, renderTextWithEmphasisHtml } from "../../src/carousel-renderer-emphasis-html.mjs";

test("renderTextWithEmphasisHtml escapes plain text when there are no emphasis instructions", () => {
  const html = renderTextWithEmphasisHtml('Tom & Jerry said "hi" <b>', []);
  assert.equal(html, "Tom &amp; Jerry said &quot;hi&quot; &lt;b&gt;");
});

test("renderTextWithEmphasisHtml wraps only the approved phrase in a highlight mark", () => {
  const html = renderTextWithEmphasisHtml("Speed wins new leads, not old ones.", [
    { phrase: "new leads", style: "highlight" },
  ]);
  assert.equal(html, 'Speed wins <mark class="emphasis-highlight">new leads</mark>, not old ones.');
});

test("renderTextWithEmphasisHtml wraps only the approved phrase in a strike element", () => {
  const html = renderTextWithEmphasisHtml("Speed wins new leads, not old ones.", [
    { phrase: "not old ones", style: "strike" },
  ]);
  assert.equal(html, 'Speed wins new leads, <s class="emphasis-strike">not old ones</s>.');
});

test("renderTextWithEmphasisHtml — regression: phrase immediately after a word boundary is not shifted (off-by-one fix)", () => {
  const text = "The old lens was interested or not. The better lens is ready or not ready yet.";
  const html = renderTextWithEmphasisHtml(text, [
    { phrase: "ready or not ready yet", style: "highlight" },
    { phrase: "interested or not", style: "strike" },
  ]);
  assert.equal(
    html,
    'The old lens was <s class="emphasis-strike">interested or not</s>. The better lens is <mark class="emphasis-highlight">ready or not ready yet</mark>.'
  );
  // Specifically guards against the confirmed bug: the strike must start
  // with "i" (not "nterested"), never dropping the phrase's first character.
  assert.match(html, /<s class="emphasis-strike">interested or not<\/s>/);
});

test("renderTextWithEmphasisHtml applies multiple non-overlapping instructions in a single pass", () => {
  const html = renderTextWithEmphasisHtml("alpha beta gamma delta", [
    { phrase: "beta", style: "highlight" },
    { phrase: "delta", style: "strike" },
  ]);
  assert.equal(html, 'alpha <mark class="emphasis-highlight">beta</mark> gamma <s class="emphasis-strike">delta</s>');
});

test("findOriginalMatchRange returns null when the phrase is genuinely absent", () => {
  assert.equal(findOriginalMatchRange("alpha beta gamma", "not present"), null);
});

test("renderTextWithEmphasisHtml throws a defensive error for an instruction whose phrase is absent", () => {
  assert.throws(
    () => renderTextWithEmphasisHtml("alpha beta gamma", [{ phrase: "not present", style: "highlight" }]),
    /not found/
  );
});

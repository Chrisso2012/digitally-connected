import test from "node:test";
import assert from "node:assert/strict";
import { buildCarouselPrompt, PROMPT_VERSION } from "../../src/carousel-prompt-builder.mjs";
import { PromptBuilderError } from "../../src/carousel-generator-errors.mjs";

function baseTopic(overrides = {}) {
  return {
    topic_id: "topic_TEST0001",
    working_title: "Your database is your cheapest lead source",
    audience: "Owner-operators running 10-50 staff service businesses",
    primary_goal: "Book a database audit call",
    core_message: "Unconverted enquiries are still recoverable revenue.",
    supporting_points: ["Point one", "Point two", "Point three"],
    cta: "Book your audit",
    brand_voice: "confident-direct",
    ...overrides,
  };
}

test("PROMPT_VERSION is a non-empty string", () => {
  assert.equal(typeof PROMPT_VERSION, "string");
  assert.notEqual(PROMPT_VERSION.trim(), "");
});

test("building the prompt twice from the same Topic Package produces an identical string", () => {
  const topic = baseTopic();
  const promptA = buildCarouselPrompt(topic);
  const promptB = buildCarouselPrompt(structuredClone(topic));
  assert.equal(promptA, promptB);
});

test("the prompt includes every required section", () => {
  const topic = baseTopic();
  const prompt = buildCarouselPrompt(topic);

  assert.match(prompt, /## Topic/);
  assert.match(prompt, /## Audience/);
  assert.match(prompt, /## Objective/);
  assert.match(prompt, /## Key message/);
  assert.match(prompt, /## Supporting points/);
  assert.match(prompt, /## Call to action/);
  assert.match(prompt, /## Desired tone/);
  assert.match(prompt, /## Writing constraints/);
  assert.match(prompt, /## Slide sequence/);
  assert.match(prompt, /## Brand rules/);
  assert.match(prompt, /## Output format/);
});

test("the prompt embeds the actual Topic Package field values", () => {
  const topic = baseTopic();
  const prompt = buildCarouselPrompt(topic);

  assert.match(prompt, new RegExp(topic.working_title));
  assert.match(prompt, new RegExp(topic.audience));
  assert.match(prompt, new RegExp(topic.primary_goal));
  assert.match(prompt, new RegExp(topic.core_message));
  assert.match(prompt, new RegExp(topic.cta));
  for (const point of topic.supporting_points) {
    assert.match(prompt, new RegExp(point));
  }
});

test("the prompt names all six slide types in order and requires JSON-only output", () => {
  const prompt = buildCarouselPrompt(baseTopic());
  const order = ["cover", "content", "statistic", "quote", "infographic", "cta"];
  let lastIndex = -1;
  for (const slideType of order) {
    const index = prompt.indexOf(`"slide_type": "${slideType}"`);
    assert.notEqual(index, -1, `expected slide_type "${slideType}" to appear in the prompt`);
    assert.ok(index > lastIndex, `expected "${slideType}" to appear after the previous slide type`);
    lastIndex = index;
  }
  assert.match(prompt, /Return JSON only/i);
});

test("newlines and tabs inside a field are collapsed so they cannot break the prompt's section structure", () => {
  const topic = baseTopic({
    working_title: "Line one\nLine two\tLine three",
  });
  const prompt = buildCarouselPrompt(topic);
  // Collapsed onto one line, appearing intact as a single contiguous line
  // directly under its "## Topic" heading.
  assert.match(prompt, /## Topic\nLine one Line two Line three\n/);
  // The raw, un-collapsed original (with its embedded newline/tab) must
  // never appear verbatim — proving the sanitizer actually ran.
  assert.doesNotMatch(prompt, /Line one\nLine two\tLine three/);
});

test("special characters (quotes, unicode) inside a field pass through unescaped as plain text", () => {
  const topic = baseTopic({
    core_message: 'They said "no new leads" — but the database says otherwise. 100% recoverable.',
  });
  const prompt = buildCarouselPrompt(topic);
  assert.match(prompt, /They said "no new leads"/);
  assert.match(prompt, /100% recoverable/);
});

test("throws PromptBuilderError when a required field is blank or whitespace-only", () => {
  const topic = baseTopic({ working_title: "   " });
  assert.throws(() => buildCarouselPrompt(topic), (error) => {
    assert.ok(error instanceof PromptBuilderError);
    assert.ok(error.details.includes("working_title"));
    return true;
  });
});

test("throws PromptBuilderError when supporting_points has no non-blank entries", () => {
  const topic = baseTopic({ supporting_points: ["   ", ""] });
  assert.throws(() => buildCarouselPrompt(topic), (error) => {
    assert.ok(error instanceof PromptBuilderError);
    assert.ok(error.details.includes("supporting_points"));
    return true;
  });
});

test("reports every blank required field at once, not just the first", () => {
  const topic = baseTopic({ working_title: "", audience: "   ", cta: null });
  try {
    buildCarouselPrompt(topic);
    assert.fail("expected buildCarouselPrompt to throw");
  } catch (error) {
    assert.ok(error instanceof PromptBuilderError);
    assert.ok(error.details.includes("working_title"));
    assert.ok(error.details.includes("audience"));
    assert.ok(error.details.includes("cta"));
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseContentRequestCommand } from "../../src/content-request-parser.mjs";
import { AmbiguousContentRequestError } from "../../src/content-request-errors.mjs";

test("parses the one supported command shape", () => {
  const parsed = parseContentRequestCommand("Create 6 designs based on article GS01");
  assert.deepEqual(parsed, {
    action: "create",
    designCount: 6,
    sourceType: "article",
    sourceReference: "GS01",
    rawCommand: "Create 6 designs based on article GS01",
  });
});

test("is case-insensitive on the command words but preserves the source reference's own casing", () => {
  const parsed = parseContentRequestCommand("create 6 DESIGNS Based On ARTICLE GS01");
  assert.equal(parsed.sourceType, "article");
  assert.equal(parsed.sourceReference, "GS01");
});

test("accepts singular 'design' as well as 'designs'", () => {
  const parsed = parseContentRequestCommand("Create 6 design based on article GS01");
  assert.equal(parsed.designCount, 6);
});

test("tolerates leading/trailing whitespace", () => {
  const parsed = parseContentRequestCommand("   Create 6 designs based on article GS01   ");
  assert.equal(parsed.sourceReference, "GS01");
});

test("captures any design count as a number, not just 6 — count validation is not this parser's job", () => {
  const parsed = parseContentRequestCommand("Create 12 designs based on article GS01");
  assert.equal(parsed.designCount, 12);
  assert.equal(typeof parsed.designCount, "number");
});

for (const badCommand of [
  "Please make me some designs",
  "Create designs based on article GS01",
  "Create 6 designs about article GS01",
  "Create 6 posters based on article GS01",
  "Create 6 designs based on video GS01",
  "Create 6 designs based on article",
  "6 designs based on article GS01",
  "Create -6 designs based on article GS01",
  "",
  "   ",
]) {
  test(`rejects unrecognized/malformed phrasing as ambiguous: ${JSON.stringify(badCommand)}`, () => {
    assert.throws(() => parseContentRequestCommand(badCommand), AmbiguousContentRequestError);
  });
}

for (const nonString of [null, undefined, 42, {}, ["Create 6 designs based on article GS01"]]) {
  test(`rejects a non-string command: ${JSON.stringify(nonString)}`, () => {
    assert.throws(() => parseContentRequestCommand(nonString), AmbiguousContentRequestError);
  });
}

test("never guesses — an almost-correct phrasing is rejected, not partially parsed", () => {
  assert.throws(() => parseContentRequestCommand("Create 6 designs from article GS01"), AmbiguousContentRequestError);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createEditorialPackage } from "../../src/editorial-package.mjs";
import { InvalidEditorialPackageInputError, EditorialPackageValidationError } from "../../src/editorial-package-errors.mjs";

function buildFields(overrides = {}) {
  return {
    ingestedContentId: "ic_a1b2c3d4e5f60708",
    primaryHeadline: "Primary Headline",
    supportingHeadline: "Supporting Headline",
    executiveSummary: "An executive summary.",
    coreMessage: "The core message.",
    primaryAudience: "The primary audience.",
    primaryProblem: "The primary problem.",
    desiredOutcome: "The desired outcome.",
    keyInsights: ["Insight one.", "Insight two."],
    pullQuotes: ["Quote one."],
    callToAction: "Do the thing.",
    keywords: ["keyword-one", "keyword-two"],
    seoTitle: "SEO Title",
    seoDescription: "SEO description.",
    suggestedHashtags: ["hashtag"],
    editorialThemes: ["theme"],
    contentCategories: ["category"],
    llmModel: "mock-editorial-analysis-provider-v1",
    promptVersion: "editorial-package.v1",
    schemaVersion: "1.0",
    ...overrides,
  };
}

test("createEditorialPackage() builds a valid, immutable record with a computed checksum", () => {
  const record = createEditorialPackage(buildFields(), { idGenerator: () => "ep_test00000000001", now: () => "2026-08-07T11:00:00.000Z" });
  assert.equal(record.editorial_package_id, "ep_test00000000001");
  assert.equal(record.ingested_content_id, "ic_a1b2c3d4e5f60708");
  assert.equal(record.status, "generated");
  assert.equal(record.primary_headline, "Primary Headline");
  assert.equal(record.generated_at, "2026-08-07T11:00:00.000Z");
  assert.match(record.checksum, /^[a-f0-9]{64}$/);
  assert.throws(() => {
    record.primary_headline = "changed";
  }, TypeError);
});

test("checksum reflects the record's own content", () => {
  const a = createEditorialPackage(buildFields({ primaryHeadline: "A" }), { idGenerator: () => "ep_aaaaaaaaaaaaaaaa" });
  const b = createEditorialPackage(buildFields({ primaryHeadline: "B" }), { idGenerator: () => "ep_bbbbbbbbbbbbbbbb" });
  assert.notEqual(a.checksum, b.checksum);
});

test("throws InvalidEditorialPackageInputError for a malformed ingestedContentId", () => {
  assert.throws(() => createEditorialPackage(buildFields({ ingestedContentId: "not-valid" })), InvalidEditorialPackageInputError);
});

for (const field of [
  "primaryHeadline", "supportingHeadline", "executiveSummary", "coreMessage", "primaryAudience", "primaryProblem",
  "desiredOutcome", "callToAction", "seoTitle", "seoDescription", "llmModel", "promptVersion", "schemaVersion",
]) {
  test(`throws InvalidEditorialPackageInputError for a missing ${field}`, () => {
    assert.throws(() => createEditorialPackage(buildFields({ [field]: "" })), InvalidEditorialPackageInputError);
  });
}

for (const field of ["keyInsights", "pullQuotes", "keywords", "suggestedHashtags", "editorialThemes", "contentCategories"]) {
  test(`throws InvalidEditorialPackageInputError for an empty ${field} array`, () => {
    assert.throws(() => createEditorialPackage(buildFields({ [field]: [] })), InvalidEditorialPackageInputError);
  });
  test(`throws InvalidEditorialPackageInputError when ${field} is not an array`, () => {
    assert.throws(() => createEditorialPackage(buildFields({ [field]: "not-an-array" })), InvalidEditorialPackageInputError);
  });
}

test("throws EditorialPackageValidationError when the assembled record still fails schema validation", () => {
  const fakeValidator = { validate: () => ({ valid: false, errors: [{ path: "(root)", message: "forced failure" }] }) };
  assert.throws(() => createEditorialPackage(buildFields(), { validator: fakeValidator }), EditorialPackageValidationError);
});

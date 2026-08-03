import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createValidator } from "../../src/validator.mjs";
import { UnknownSchemaError } from "../../src/errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");

const APPROVED_FIXTURES = {
  topicPackage: "topic-package.example.json",
  carouselContent: "carousel-content.example.json",
  templatedPayload: "templated-payload.example.json",
  finishedCarousel: "finished-carousel.example.json",
  executionLog: "execution-log.example.json",
  executionRecord: "execution-record.example.json",
  invocationRequest: "invocation-request.example.json",
  invocationResponse: "invocation-response.example.json",
  contentRequest: "content-request.example.json",
};

const validator = createValidator();

function readFixture(...segments) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, ...segments), "utf-8"));
}

for (const [schemaId, filename] of Object.entries(APPROVED_FIXTURES)) {
  test(`approved fixture ${filename} validates successfully against ${schemaId}`, () => {
    const data = readFixture(filename);
    const result = validator.validate(schemaId, data);
    assert.equal(result.valid, true, `expected valid, got errors: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.errors, []);
  });
}

test("intentionally invalid topic package fixture is rejected with structured errors", () => {
  const data = readFixture("invalid", "topic-package.invalid.json");
  const result = validator.validate("topicPackage", data);

  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0, "expected at least one structured error");

  for (const error of result.errors) {
    assert.equal(typeof error.path, "string");
    assert.equal(typeof error.keyword, "string");
    assert.equal(typeof error.message, "string");
    assert.notEqual(error.message.trim(), "", "error message must not be empty");
    assert.notEqual(error.message, "validation failed", "error message must be specific, not generic");
  }

  // The fixture is missing "audience" (required) and has an invalid
  // funnel_stage enum value — both should be reported.
  const keywords = result.errors.map((e) => e.keyword);
  assert.ok(keywords.includes("required"), "expected a 'required' error for missing fields");
  assert.ok(keywords.includes("enum"), "expected an 'enum' error for funnel_stage");
});

test("unknown schema identifier throws UnknownSchemaError, not a silent false", () => {
  assert.throws(() => validator.validate("notARealSchemaId", {}), UnknownSchemaError);
});

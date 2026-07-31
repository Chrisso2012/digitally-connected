// DC-003 — schema validation only. No business logic, no generation, no API calls.
//
// Minimal, dependency-free JSON Schema validator. Enforces: type, required,
// properties, items, enum, minItems/maxItems, additionalProperties:false.
// Does NOT enforce: format, pattern, minLength, minimum/maximum, const, if/then/else.
// Those keywords remain in the schema files as documentation for a future
// Ajv-based validator once the project needs full JSON Schema spec coverage —
// see README "Foundation-phase trade-offs".
//
// Usage: node tests/validation/validate.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SCHEMAS_DIR = path.join(ROOT, "schemas");
const FIXTURES_DIR = path.join(ROOT, "tests", "fixtures");

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "string" | "number" | "boolean" | "object"
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  const expectedTypes = Array.isArray(expected) ? expected : [expected];
  if (actual === "number" && expectedTypes.includes("integer")) {
    return Number.isInteger(value);
  }
  return expectedTypes.includes(actual);
}

function validate(value, schema, pathStr, errors) {
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${pathStr}: expected type ${JSON.stringify(schema.type)}, got ${typeOf(value)}`);
    return; // type mismatch makes deeper checks meaningless
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pathStr}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  if (typeOf(value) === "object" && schema.properties) {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push(`${pathStr}: missing required field "${key}"`);
        }
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) {
          errors.push(`${pathStr}: unexpected field "${key}"`);
        }
      }
    }
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        validate(value[key], subSchema, `${pathStr}.${key}`, errors);
      }
    }
  }

  if (typeOf(value) === "array") {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${pathStr}: expected at least ${schema.minItems} items, got ${value.length}`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${pathStr}: expected at most ${schema.maxItems} items, got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((item, i) => validate(item, schema.items, `${pathStr}[${i}]`, errors));
    }
  }
}

function validateFixture(schemaFile, fixtureFile) {
  const schema = loadJson(path.join(SCHEMAS_DIR, schemaFile));
  const fixture = loadJson(path.join(FIXTURES_DIR, fixtureFile));
  const errors = [];
  validate(fixture, schema, "$", errors);
  return errors;
}

const PAIRS = [
  ["topic-package.schema.json", "topic-package.example.json"],
  ["carousel-content.schema.json", "carousel-content.example.json"],
  ["templated-payload.schema.json", "templated-payload.example.json"],
  ["finished-carousel.schema.json", "finished-carousel.example.json"],
  ["execution-log.schema.json", "execution-log.example.json"],
];

let hadFailure = false;
for (const [schemaFile, fixtureFile] of PAIRS) {
  const errors = validateFixture(schemaFile, fixtureFile);
  if (errors.length === 0) {
    console.log(`PASS  ${fixtureFile}  against  ${schemaFile}`);
  } else {
    hadFailure = true;
    console.log(`FAIL  ${fixtureFile}  against  ${schemaFile}`);
    for (const err of errors) console.log(`  - ${err}`);
  }
}

process.exit(hadFailure ? 1 : 0);

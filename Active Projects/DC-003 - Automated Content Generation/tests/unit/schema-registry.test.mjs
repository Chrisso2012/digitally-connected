import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSchemaRegistry, SCHEMA_IDS } from "../../src/schema-registry.mjs";
import { ConfigFileNotFoundError, ConfigParseError } from "../../src/errors.mjs";

test("loadSchemaRegistry loads all five approved schemas", () => {
  const registry = loadSchemaRegistry();
  assert.deepEqual(Object.keys(registry).sort(), [...SCHEMA_IDS].sort());
  for (const id of SCHEMA_IDS) {
    assert.equal(registry[id].type, "object", `${id} schema should be a JSON Schema object`);
    assert.ok(registry[id].$schema, `${id} schema should declare $schema`);
  }
});

test("throws ConfigFileNotFoundError when a schema file is missing", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "dc003-schema-missing-"));
  try {
    mkdirSync(path.join(tmp, "schemas"));
    // deliberately write none of the five schema files
    assert.throws(() => loadSchemaRegistry({ rootDir: tmp }), ConfigFileNotFoundError);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("throws ConfigParseError on malformed schema JSON", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "dc003-schema-malformed-"));
  try {
    mkdirSync(path.join(tmp, "schemas"));
    writeFileSync(path.join(tmp, "schemas", "topic-package.schema.json"), "{ not valid json");
    assert.throws(() => loadSchemaRegistry({ rootDir: tmp }), ConfigParseError);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, loadTemplatesConfig, loadConstants, loadVersions } from "../../src/config-loader.mjs";
import { ConfigFileNotFoundError, ConfigParseError } from "../../src/errors.mjs";

test("loadConfig loads the real project config files successfully", () => {
  const config = loadConfig();
  assert.ok(config.templates.templates, "templates.json should have a templates object");
  assert.ok(Array.isArray(config.constants.slide_types), "constants.json should have slide_types");
  assert.ok(config.versions.schema_versions, "versions.json should have schema_versions");
});

test("loadTemplatesConfig, loadConstants, loadVersions each load their own file", () => {
  assert.ok(loadTemplatesConfig().templates.cover.template_id);
  assert.equal(loadConstants().slide_count, 6);
  assert.equal(typeof loadVersions().project_version, "string");
});

test("throws ConfigFileNotFoundError when a config file is missing", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "dc003-config-missing-"));
  try {
    mkdirSync(path.join(tmp, "config"));
    // deliberately do not write templates.json
    assert.throws(() => loadTemplatesConfig({ rootDir: tmp }), ConfigFileNotFoundError);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("throws ConfigParseError on malformed JSON", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "dc003-config-malformed-"));
  try {
    mkdirSync(path.join(tmp, "config"));
    writeFileSync(path.join(tmp, "config", "templates.json"), "{ this is not valid json ");
    assert.throws(() => loadTemplatesConfig({ rootDir: tmp }), ConfigParseError);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadConfig never reads config/env.example", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "dc003-config-no-env-"));
  try {
    mkdirSync(path.join(tmp, "config"));
    writeFileSync(path.join(tmp, "config", "templates.json"), JSON.stringify({ templates: {} }));
    writeFileSync(path.join(tmp, "config", "constants.json"), JSON.stringify({ slide_types: [] }));
    writeFileSync(path.join(tmp, "config", "versions.json"), JSON.stringify({}));
    // No env.example written at all — loadConfig must succeed without it,
    // proving env.example is never on its read path.
    const config = loadConfig({ rootDir: tmp });
    assert.deepEqual(config.templates, { templates: {} });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

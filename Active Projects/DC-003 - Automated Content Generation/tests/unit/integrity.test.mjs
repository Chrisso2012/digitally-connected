import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config-loader.mjs";
import { runIntegrityChecks } from "../../src/integrity-checks.mjs";

test("real project config passes every integrity check", () => {
  const config = loadConfig();
  const report = runIntegrityChecks(config);
  assert.equal(report.ok, true, `expected no issues, got: ${JSON.stringify(report.issues, null, 2)}`);
});

test("duplicate template_id is detected", () => {
  const config = loadConfig();
  const mutated = structuredClone(config);
  mutated.templates.templates.content.template_id = mutated.templates.templates.cover.template_id;

  const report = runIntegrityChecks(mutated);

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "unique-template-id"));
});

test("missing required version identifier is detected", () => {
  const config = loadConfig();
  const mutated = structuredClone(config);
  delete mutated.versions.schema_versions.execution_log;

  const report = runIntegrityChecks(mutated);

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "schema-version-value-non-empty"));
});

test("a credential-shaped value embedded in config is detected", () => {
  const config = loadConfig();
  const mutated = structuredClone(config);
  mutated.versions.templated_api_key = "sk-live-not-actually-a-secret-but-shaped-like-one";

  const report = runIntegrityChecks(mutated);

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "no-embedded-credentials"));
});

test("infographic step icon layers moved to variable are detected", () => {
  const config = loadConfig();
  const mutated = structuredClone(config);
  const infographic = mutated.templates.templates.infographic;
  // simulate someone accidentally promoting step_1_icon to an editable field
  infographic.layers.variable.push({ name: "step_1_icon", type: "image" });
  infographic.layers.fixed = infographic.layers.fixed.filter((l) => l.name !== "step_1_icon");

  const report = runIntegrityChecks(mutated);

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "infographic-icon-fixed"));
});

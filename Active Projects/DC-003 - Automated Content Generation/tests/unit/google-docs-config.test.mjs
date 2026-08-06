import test from "node:test";
import assert from "node:assert/strict";
import { loadGoogleDocsSourceConfig, describeGoogleDocsAuthenticationAvailability } from "../../src/google-docs-config.mjs";
import { ContentSourceConfigurationError } from "../../src/content-source-errors.mjs";

test("loadGoogleDocsSourceConfig() returns configured:false when GOOGLE_SERVICE_ACCOUNT_JSON is unset", () => {
  const config = loadGoogleDocsSourceConfig({});
  assert.equal(config.configured, false);
  assert.equal(config.clientEmail, null);
  assert.equal(config.privateKey, null);
});

test("loadGoogleDocsSourceConfig() parses a valid key JSON", () => {
  const raw = JSON.stringify({ client_email: "svc@example.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" });
  const config = loadGoogleDocsSourceConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: raw });
  assert.equal(config.configured, true);
  assert.equal(config.clientEmail, "svc@example.com");
  assert.match(config.privateKey, /BEGIN PRIVATE KEY/);
});

test("loadGoogleDocsSourceConfig() throws ContentSourceConfigurationError for invalid JSON", () => {
  assert.throws(() => loadGoogleDocsSourceConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: "{not json" }), ContentSourceConfigurationError);
});

test("loadGoogleDocsSourceConfig() throws ContentSourceConfigurationError for missing client_email or private_key", () => {
  assert.throws(() => loadGoogleDocsSourceConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ private_key: "x" }) }), ContentSourceConfigurationError);
  assert.throws(() => loadGoogleDocsSourceConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "x" }) }), ContentSourceConfigurationError);
});

test("describeGoogleDocsAuthenticationAvailability() reflects presence without exposing the value", () => {
  assert.deepEqual(describeGoogleDocsAuthenticationAvailability({}), {
    mechanism: "GOOGLE_SERVICE_ACCOUNT_JSON (not set) — the live Google Docs adapter is unusable until configured",
    available: false,
  });
  const result = describeGoogleDocsAuthenticationAvailability({ GOOGLE_SERVICE_ACCOUNT_JSON: '{"a":1}' });
  assert.equal(result.available, true);
  assert.equal(result.mechanism, "GOOGLE_SERVICE_ACCOUNT_JSON");
});

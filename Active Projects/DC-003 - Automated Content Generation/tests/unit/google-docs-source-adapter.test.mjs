import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createGoogleDocsSourceAdapter, extractGoogleDocId } from "../../src/google-docs-source-adapter.mjs";
import {
  ContentSourceConfigurationError,
  ContentSourceNotFoundError,
  ContentSourceAuthenticationError,
  ContentSourceRateLimitError,
} from "../../src/content-source-errors.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs1", format: "pem" });
const CONFIG = { configured: true, clientEmail: "svc@example.iam.gserviceaccount.com", privateKey: PRIVATE_KEY_PEM };

test("extractGoogleDocId() accepts a bare Document ID unchanged", () => {
  assert.equal(extractGoogleDocId("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"), "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms");
});

test("extractGoogleDocId() extracts the ID from a full share URL", () => {
  assert.equal(
    extractGoogleDocId("https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing"),
    "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
  );
});

test("extractGoogleDocId() throws ContentSourceConfigurationError for an unrecognisable reference", () => {
  assert.throws(() => extractGoogleDocId("not a doc reference"), ContentSourceConfigurationError);
  assert.throws(() => extractGoogleDocId("short"), ContentSourceConfigurationError);
});

test("createGoogleDocsSourceAdapter() throws ContentSourceConfigurationError when not configured", () => {
  assert.throws(() => createGoogleDocsSourceAdapter({ configured: false }), ContentSourceConfigurationError);
});

function buildFetchImpl({ metaOverrides = {}, exportBody = "The retrieved article body." } = {}) {
  return async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "fake-token", expires_in: 3600 }) };
    }
    if (String(url).includes("/export")) {
      return { ok: true, status: 200, text: async () => exportBody, headers: { get: () => null } };
    }
    // metadata call
    return {
      ok: true,
      status: 200,
      json: async () => ({
        name: "Retrieved Title",
        createdTime: "2026-07-01T09:00:00.000Z",
        modifiedTime: "2026-08-05T14:30:00.000Z",
        owners: [{ emailAddress: "author@example.com" }],
        headRevisionId: "REV123",
        webViewLink: "https://docs.google.com/document/d/abc/edit",
        ...metaOverrides,
      }),
      headers: { get: () => null },
    };
  };
}

test("fetch() retrieves title, body, and metadata via the Drive API", async () => {
  const adapter = createGoogleDocsSourceAdapter(CONFIG, { fetchImpl: buildFetchImpl(), now: () => Date.now() });
  const result = await adapter.fetch({ sourceReference: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" });

  assert.equal(result.title, "Retrieved Title");
  assert.equal(result.body, "The retrieved article body.");
  assert.equal(result.sourceIdentifier, "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms");
  assert.deepEqual(result.metadata, {
    author: "author@example.com",
    source_created_at: "2026-07-01T09:00:00.000Z",
    source_modified_at: "2026-08-05T14:30:00.000Z",
    source_revision_id: "REV123",
    source_url: "https://docs.google.com/document/d/abc/edit",
  });
});

test("fetch() normalises a full share URL to the bare Document ID before calling the API", async () => {
  let calledUrls = [];
  const fetchImpl = async (url, init) => {
    calledUrls.push(String(url));
    return buildFetchImpl()(url, init);
  };
  const adapter = createGoogleDocsSourceAdapter(CONFIG, { fetchImpl, now: () => Date.now() });
  const result = await adapter.fetch({ sourceReference: "https://docs.google.com/document/d/abc123def456ghi789/edit" });

  assert.equal(result.sourceIdentifier, "abc123def456ghi789");
  assert.ok(calledUrls.some((u) => u.includes("abc123def456ghi789") && !u.includes("/edit")));
});

test("fetch() throws ContentSourceNotFoundError on HTTP 404", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    }
    return { ok: false, status: 404, headers: { get: () => null } };
  };
  const adapter = createGoogleDocsSourceAdapter(CONFIG, { fetchImpl, now: () => Date.now() });
  await assert.rejects(() => adapter.fetch({ sourceReference: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" }), ContentSourceNotFoundError);
});

test("fetch() throws ContentSourceAuthenticationError on HTTP 403 (not shared with the service account)", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    }
    return { ok: false, status: 403, headers: { get: () => null } };
  };
  const adapter = createGoogleDocsSourceAdapter(CONFIG, { fetchImpl, now: () => Date.now() });
  await assert.rejects(() => adapter.fetch({ sourceReference: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" }), ContentSourceAuthenticationError);
});

test("fetch() throws ContentSourceRateLimitError on HTTP 429", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    }
    return { ok: false, status: 429, headers: { get: () => null } };
  };
  const adapter = createGoogleDocsSourceAdapter(CONFIG, { fetchImpl, now: () => Date.now() });
  await assert.rejects(() => adapter.fetch({ sourceReference: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" }), ContentSourceRateLimitError);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateEditorialPackage } from "../../src/editorial-package-generator.mjs";
import { createIngestedContentStore } from "../../src/ingested-content-store.mjs";
import { createLocalJsonIngestedContentStoreAdapter } from "../../src/local-json-ingested-content-store-adapter.mjs";
import { createIngestedContent } from "../../src/ingested-content.mjs";
import { createEditorialPackageStore } from "../../src/editorial-package-store.mjs";
import { createLocalJsonEditorialPackageStoreAdapter } from "../../src/local-json-editorial-package-store-adapter.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { DuplicateEditorialPackageError, EditorialPackageGenerationFailedError } from "../../src/editorial-package-errors.mjs";
import { IngestedContentNotFoundError } from "../../src/ingested-content-errors.mjs";

async function withTempDir(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-editorial-package-generator-"));
  try {
    return await fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function buildStores(base) {
  const ingestedContentStore = createIngestedContentStore({ adapter: createLocalJsonIngestedContentStoreAdapter({ storageDir: path.join(base, "ic") }) });
  const editorialPackageStore = createEditorialPackageStore({ adapter: createLocalJsonEditorialPackageStoreAdapter({ storageDir: path.join(base, "ep") }) });
  return { ingestedContentStore, editorialPackageStore };
}

const ARTICLE_BODY = Array(210).fill("word").join(" ") + ". A second sentence here for good measure.";

function seedIngestedContent(store, overrides = {}) {
  return store.save(
    createIngestedContent(
      {
        sourceType: "google_docs",
        sourceReference: "doc-1",
        sourceFingerprint: createHash("sha256").update(ARTICLE_BODY).digest("hex"),
        title: "Test Article",
        fullArticleText: ARTICLE_BODY,
        ...overrides,
      },
      { idGenerator: () => "ic_generatortest0001" }
    )
  );
}

const VALID_ANALYSIS = {
  primaryHeadline: "H",
  supportingHeadline: "SH",
  executiveSummary: "ES",
  coreMessage: "CM",
  primaryAudience: "PA",
  primaryProblem: "PP",
  desiredOutcome: "DO",
  keyInsights: ["a"],
  pullQuotes: ["b"],
  callToAction: "CTA",
  keywords: ["k"],
  seoTitle: "ST",
  seoDescription: "SD",
  suggestedHashtags: ["h"],
  editorialThemes: ["t"],
  contentCategories: ["c"],
};

function fakeProvider(name, analyzeContentImpl) {
  return { name, analyzeContent: analyzeContentImpl };
}

test("generateEditorialPackage() generates and persists a valid record using the default (mock) provider", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);

    const record = await generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, idGenerator: () => "ep_generatortest0001" });

    assert.equal(record.editorial_package_id, "ep_generatortest0001");
    assert.equal(record.ingested_content_id, ic.ingested_content_id);
    assert.equal(record.llm_model, "mock-editorial-analysis-provider-v1");
    assert.equal(editorialPackageStore.get("ep_generatortest0001").editorial_package_id, "ep_generatortest0001");
  }));

test("generateEditorialPackage() with an injected provider uses its output verbatim", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    const provider = fakeProvider("fake-provider", async () => JSON.stringify(VALID_ANALYSIS));

    const record = await generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, idGenerator: () => "ep_faketest00000001" });

    assert.equal(record.primary_headline, "H");
    assert.equal(record.llm_model, "fake-provider");
  }));

test("generateEditorialPackage() throws IngestedContentNotFoundError for an unknown ingestedContentId", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    await assert.rejects(
      () => generateEditorialPackage("ic_doesnotexist00001", { ingestedContentStore, editorialPackageStore }),
      IngestedContentNotFoundError
    );
  }));

test("generateEditorialPackage() throws DuplicateEditorialPackageError when one already exists for this Ingested Content", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    await generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore });
    await assert.rejects(
      () => generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore }),
      DuplicateEditorialPackageError
    );
  }));

test("generateEditorialPackage() retries on a malformed JSON response and succeeds on a later attempt", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    let calls = 0;
    const provider = fakeProvider("flaky-provider", async () => {
      calls += 1;
      return calls < 2 ? "not valid json" : JSON.stringify(VALID_ANALYSIS);
    });

    const record = await generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 3 });
    assert.equal(record.primary_headline, "H");
    assert.equal(calls, 2);
  }));

test("generateEditorialPackage() throws EditorialPackageGenerationFailedError after exhausting retries on malformed output", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    const provider = fakeProvider("always-broken", async () => "not valid json");

    await assert.rejects(
      () => generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 2 }),
      EditorialPackageGenerationFailedError
    );
  }));

test("generateEditorialPackage() throws EditorialPackageGenerationFailedError when the provider's result fails shape validation", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    const provider = fakeProvider("shape-broken", async () => JSON.stringify({ ...VALID_ANALYSIS, primaryHeadline: "" }));

    await assert.rejects(
      () => generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 1 }),
      EditorialPackageGenerationFailedError
    );
  }));

// --- DC-003-I031.3 — safe, content-free keyInsightsDiagnostics attached
// to a "result-shape" failed attempt, reproducing the two real live
// failure hypotheses (whitespace-only entry; non-array shape) ---------

test("a whitespace-only keyInsights entry surfaces keyInsightsDiagnostics.anyBlankAfterTrim=true, anyZeroLength=false", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    const provider = fakeProvider("whitespace-insight", async () => JSON.stringify({ ...VALID_ANALYSIS, keyInsights: ["   "] }));

    try {
      await generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 1 });
      assert.fail("expected EditorialPackageGenerationFailedError");
    } catch (error) {
      assert.ok(error instanceof EditorialPackageGenerationFailedError);
      const diagnostics = error.attempts[0].keyInsightsDiagnostics;
      assert.deepEqual(diagnostics, {
        exists: true,
        isUndefined: false,
        isNull: false,
        type: "object",
        isArray: true,
        length: 1,
        itemTypes: ["string"],
        itemLengths: [3],
        anyZeroLength: false,
        anyBlankAfterTrim: true,
      });
      // The whitespace value itself must never appear anywhere on the error.
      assert.doesNotMatch(JSON.stringify(error.attempts), /"   "/);
    }
  }));

test("an empty-string keyInsights entry surfaces keyInsightsDiagnostics.anyZeroLength=true, anyBlankAfterTrim=true", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    const provider = fakeProvider("empty-insight", async () => JSON.stringify({ ...VALID_ANALYSIS, keyInsights: ["a real one", ""] }));

    try {
      await generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 1 });
      assert.fail("expected EditorialPackageGenerationFailedError");
    } catch (error) {
      const diagnostics = error.attempts[0].keyInsightsDiagnostics;
      assert.equal(diagnostics.length, 2);
      assert.equal(diagnostics.anyZeroLength, true);
      assert.equal(diagnostics.anyBlankAfterTrim, true);
      assert.deepEqual(diagnostics.itemLengths, [10, 0]);
    }
  }));

test("a non-string, non-array keyInsights surfaces keyInsightsDiagnostics.isArray=false with its real JS type", () =>
  // DC-003-I031.4 note: a lone STRING is no longer a failing case here —
  // normalizeEditorialAnalysisKeyInsights() now converts it to a valid
  // one-item array before validation (see the dedicated I031.4 tests
  // above/below). A number is used here instead, specifically because
  // it's a shape the I031.4 normalisation deliberately never touches.
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    const provider = fakeProvider("wrong-shape-insight", async () => JSON.stringify({ ...VALID_ANALYSIS, keyInsights: 42 }));

    try {
      await generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 1 });
      assert.fail("expected EditorialPackageGenerationFailedError");
    } catch (error) {
      const diagnostics = error.attempts[0].keyInsightsDiagnostics;
      assert.equal(diagnostics.isArray, false);
      assert.equal(diagnostics.type, "number");
      assert.equal(diagnostics.length, null);
    }
  }));

test("keyInsightsDiagnostics is absent from a successful attempt", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    const provider = fakeProvider("fake-provider", async () => JSON.stringify(VALID_ANALYSIS));

    await generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 1 });
    // No assertion needed beyond "did not throw" — success attempts never
    // reach the result-shape catch block that attaches diagnostics.
  }));

// --- DC-003-I031.4 — end-to-end effect of the keyInsights provider
// normalisation, exercised through the real generator, not just the
// pure helper directly ------------------------------------------------

test("generateEditorialPackage() succeeds when the provider returns keyInsights as a single string, normalising it to a one-item array", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    const original = "Timing was the primary issue.";
    const provider = fakeProvider("string-keyinsights", async () => JSON.stringify({ ...VALID_ANALYSIS, keyInsights: original }));

    const record = await generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 1 });

    assert.deepEqual(record.key_insights, [original]);
  }));

test("generateEditorialPackage() still fails when the provider returns keyInsights as a whitespace-only string — normalisation does not paper over it", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    const provider = fakeProvider("blank-keyinsights", async () => JSON.stringify({ ...VALID_ANALYSIS, keyInsights: "   " }));

    try {
      await generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 1 });
      assert.fail("expected EditorialPackageGenerationFailedError");
    } catch (error) {
      assert.ok(error instanceof EditorialPackageGenerationFailedError);
      assert.equal(error.attempts[0].keyInsightsDiagnostics.type, "string");
      assert.equal(error.attempts[0].keyInsightsDiagnostics.isArray, false);
    }
  }));

test("generateEditorialPackage() still fails when the provider returns keyInsights as null — normalisation is a no-op for non-string shapes", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    const provider = fakeProvider("null-keyinsights", async () => JSON.stringify({ ...VALID_ANALYSIS, keyInsights: null }));

    await assert.rejects(
      () => generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 1 }),
      EditorialPackageGenerationFailedError
    );
  }));

test("generateEditorialPackage() propagates a non-retryable provider error immediately, bypassing retry", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore, editorialPackageStore } = buildStores(base);
    const ic = seedIngestedContent(ingestedContentStore);
    let calls = 0;
    const nonRetryable = new Error("auth failed");
    nonRetryable.retryable = false;
    const provider = fakeProvider("auth-broken", async () => {
      calls += 1;
      throw nonRetryable;
    });

    await assert.rejects(
      () => generateEditorialPackage(ic.ingested_content_id, { ingestedContentStore, editorialPackageStore, provider, maxAttempts: 3 }),
      /auth failed/
    );
    assert.equal(calls, 1);
  }));

test("generateEditorialPackage() throws PipelineConfigurationError for missing dependencies.ingestedContentStore", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore } = buildStores(base);
    await assert.rejects(() => generateEditorialPackage("ic_x", { editorialPackageStore }), PipelineConfigurationError);
  }));

test("generateEditorialPackage() throws PipelineConfigurationError for missing dependencies.editorialPackageStore", () =>
  withTempDir(async (base) => {
    const { ingestedContentStore } = buildStores(base);
    await assert.rejects(() => generateEditorialPackage("ic_x", { ingestedContentStore }), PipelineConfigurationError);
  }));

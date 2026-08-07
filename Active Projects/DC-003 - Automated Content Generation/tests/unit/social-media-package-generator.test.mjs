import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateSocialMediaPackage } from "../../src/social-media-package-generator.mjs";
import { createEditorialPackageStore } from "../../src/editorial-package-store.mjs";
import { createLocalJsonEditorialPackageStoreAdapter } from "../../src/local-json-editorial-package-store-adapter.mjs";
import { createEditorialPackage } from "../../src/editorial-package.mjs";
import { createSocialMediaPackageStore } from "../../src/social-media-package-store.mjs";
import { createLocalJsonSocialMediaPackageStoreAdapter } from "../../src/local-json-social-media-package-store-adapter.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { DuplicateSocialMediaPackageError, SocialMediaPackageGenerationFailedError } from "../../src/social-media-package-errors.mjs";
import { EditorialPackageNotFoundError } from "../../src/editorial-package-errors.mjs";

async function withTempDir(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-social-media-package-generator-"));
  try {
    return await fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function buildStores(base) {
  const editorialPackageStore = createEditorialPackageStore({ adapter: createLocalJsonEditorialPackageStoreAdapter({ storageDir: path.join(base, "ep") }) });
  const socialMediaPackageStore = createSocialMediaPackageStore({ adapter: createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: path.join(base, "sm") }) });
  return { editorialPackageStore, socialMediaPackageStore };
}

function seedEditorialPackage(store, overrides = {}) {
  return store.save(
    createEditorialPackage(
      {
        ingestedContentId: "ic_a1b2c3d4e5f60708",
        primaryHeadline: "Headline",
        supportingHeadline: "Supporting",
        executiveSummary: "Summary.",
        coreMessage: "Message.",
        primaryAudience: "Audience.",
        primaryProblem: "Problem.",
        desiredOutcome: "Outcome.",
        keyInsights: ["Insight."],
        pullQuotes: ["Quote."],
        callToAction: "Act.",
        keywords: ["kw"],
        seoTitle: "SEO",
        seoDescription: "SEO desc.",
        suggestedHashtags: ["tag"],
        editorialThemes: ["theme"],
        contentCategories: ["category"],
        llmModel: "mock-editorial-analysis-provider-v1",
        promptVersion: "editorial-package.v1",
        schemaVersion: "1.0",
        ...overrides,
      },
      { idGenerator: () => "ep_generatortest0001" }
    )
  );
}

const VALID_ANALYSIS = {
  hook: "H",
  callToAction: "CTA",
  tone: "T",
  audience: "A",
  platforms: {
    linkedin: { postText: "L", hashtags: ["a"] },
    facebook: { postText: "F", hashtags: ["b"] },
    x: { postText: "X", hashtags: [] },
    instagram: { caption: "I", hashtags: ["c"] },
  },
  carousel: {
    headings: ["1", "2", "3", "4", "5", "6"],
    slideCopy: ["1", "2", "3", "4", "5", "6"],
    imageGuidance: ["1", "2", "3", "4", "5", "6"],
  },
};

function fakeProvider(name, generateSocialMediaImpl) {
  return { name, generateSocialMedia: generateSocialMediaImpl };
}

test("generateSocialMediaPackage() generates and persists a valid record using the default (mock) provider", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);

    const record = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, idGenerator: () => "sm_generatortest0001" });

    assert.equal(record.social_media_package_id, "sm_generatortest0001");
    assert.equal(record.editorial_package_id, ep.editorial_package_id);
    assert.equal(record.llm_model, "mock-social-media-provider-v1");
    assert.equal(socialMediaPackageStore.get("sm_generatortest0001").social_media_package_id, "sm_generatortest0001");
  }));

test("generateSocialMediaPackage() with an injected provider uses its output verbatim", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const provider = fakeProvider("fake-provider", async () => JSON.stringify(VALID_ANALYSIS));

    const record = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, provider, idGenerator: () => "sm_faketest00000001" });

    assert.equal(record.hook, "H");
    assert.equal(record.llm_model, "fake-provider");
  }));

test("generateSocialMediaPackage() throws EditorialPackageNotFoundError for an unknown editorialPackageId", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    await assert.rejects(
      () => generateSocialMediaPackage("ep_doesnotexist00001", { editorialPackageStore, socialMediaPackageStore }),
      EditorialPackageNotFoundError
    );
  }));

test("generateSocialMediaPackage() throws DuplicateSocialMediaPackageError when one already exists for this Editorial Package", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore });
    await assert.rejects(
      () => generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore }),
      DuplicateSocialMediaPackageError
    );
  }));

test("generateSocialMediaPackage() retries on a malformed JSON response and succeeds on a later attempt", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    let calls = 0;
    const provider = fakeProvider("flaky-provider", async () => {
      calls += 1;
      return calls < 2 ? "not valid json" : JSON.stringify(VALID_ANALYSIS);
    });

    const record = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, provider, maxAttempts: 3 });
    assert.equal(record.hook, "H");
    assert.equal(calls, 2);
  }));

test("generateSocialMediaPackage() throws SocialMediaPackageGenerationFailedError after exhausting retries on malformed output", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const provider = fakeProvider("always-broken", async () => "not valid json");

    await assert.rejects(
      () => generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, provider, maxAttempts: 2 }),
      SocialMediaPackageGenerationFailedError
    );
  }));

test("generateSocialMediaPackage() throws SocialMediaPackageGenerationFailedError when the provider's result fails shape validation", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const provider = fakeProvider("shape-broken", async () => JSON.stringify({ ...VALID_ANALYSIS, hook: "" }));

    await assert.rejects(
      () => generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, provider, maxAttempts: 1 }),
      SocialMediaPackageGenerationFailedError
    );
  }));

test("generateSocialMediaPackage() propagates a non-retryable provider error immediately, bypassing retry", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    let calls = 0;
    const nonRetryable = new Error("auth failed");
    nonRetryable.retryable = false;
    const provider = fakeProvider("auth-broken", async () => {
      calls += 1;
      throw nonRetryable;
    });

    await assert.rejects(
      () => generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, provider, maxAttempts: 3 }),
      /auth failed/
    );
    assert.equal(calls, 1);
  }));

test("generateSocialMediaPackage() throws PipelineConfigurationError for missing dependencies.editorialPackageStore", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore } = buildStores(base);
    await assert.rejects(() => generateSocialMediaPackage("ep_x", { socialMediaPackageStore }), PipelineConfigurationError);
  }));

test("generateSocialMediaPackage() throws PipelineConfigurationError for missing dependencies.socialMediaPackageStore", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore } = buildStores(base);
    await assert.rejects(() => generateSocialMediaPackage("ep_x", { editorialPackageStore }), PipelineConfigurationError);
  }));

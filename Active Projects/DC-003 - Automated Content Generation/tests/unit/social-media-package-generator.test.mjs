import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateSocialMediaPackage, reviseSocialMediaPackage } from "../../src/social-media-package-generator.mjs";
import { createEditorialPackageStore } from "../../src/editorial-package-store.mjs";
import { createLocalJsonEditorialPackageStoreAdapter } from "../../src/local-json-editorial-package-store-adapter.mjs";
import { createEditorialPackage } from "../../src/editorial-package.mjs";
import { createSocialMediaPackageStore } from "../../src/social-media-package-store.mjs";
import { createLocalJsonSocialMediaPackageStoreAdapter } from "../../src/local-json-social-media-package-store-adapter.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import {
  DuplicateSocialMediaPackageError,
  SocialMediaPackageGenerationFailedError,
  SocialMediaPackageNotFoundError,
  CrossEditorialPackageSupersessionError,
  NotLatestRevisionError,
} from "../../src/social-media-package-errors.mjs";
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

function seedEditorialPackage(store, overrides = {}, options = {}) {
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
      { idGenerator: options.idGenerator ?? (() => "ep_generatortest0001") }
    )
  );
}

const VALID_ANALYSIS = {
  hook: "H",
  callToAction: "CTA",
  tone: "T",
  audience: "A",
  industryContext: null,
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
    slides: ["cover", "insight", "statistic", "quote", "takeaway", "cta"].map((slideRole, index) => ({
      slideNumber: index + 1,
      slideRole,
      heading: String(index + 1),
      body: String(index + 1),
      imageGuidance: String(index + 1),
      statistic: slideRole === "statistic" ? { value: "50%", context: "3" } : null,
      quote: slideRole === "quote" ? { quoteText: "4" } : null,
      keyPoints: slideRole === "takeaway" ? ["5"] : [],
    })),
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

// --- DC-003-I031.8 — industryContext survives the generator's own
// analysis.industryContext -> fields.industryContext pass-through,
// exactly like every other provider-supplied field (hook/tone/audience).

test("generateSocialMediaPackage() persists a genuine, non-real-estate industryContext returned by the provider", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const provider = fakeProvider("industry-aware-provider", async () =>
      JSON.stringify({ ...VALID_ANALYSIS, industryContext: "Independent veterinary clinics managing appointment no-shows" })
    );

    const record = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, provider, idGenerator: () => "sm_industrytest0001" });

    assert.equal(record.industry_context, "Independent veterinary clinics managing appointment no-shows");
  }));

test("generateSocialMediaPackage() persists industryContext: null when the provider genuinely found no supported industry", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const provider = fakeProvider("generic-provider", async () => JSON.stringify({ ...VALID_ANALYSIS, industryContext: null }));

    const record = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, provider, idGenerator: () => "sm_industrytest0002" });

    assert.equal(record.industry_context, null);
  }));

// --- DC-003-I032.3 — fieldDiagnostics wiring ---------------------------
// Reproduces the exact structural shape of the real live failure this
// milestone exists to diagnose — a result-shape failure where the whole
// `carousel` key is missing — using only synthetic, fake-provider test
// data (never real generated content). Confirms
// SocialMediaPackageGenerationFailedError.attempts[].fieldDiagnostics now
// carries enough safe, content-free structural evidence to tell "carousel
// was never present at all" apart from "carousel had the wrong type",
// mirroring editorial-package-generator.mjs's own I031.3 precedent.

test('generateSocialMediaPackage() attaches fieldDiagnostics naming "carousel" when the provider omits it entirely', () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const { carousel, ...withoutCarousel } = VALID_ANALYSIS;
    const provider = fakeProvider("truncated-provider", async () => JSON.stringify(withoutCarousel));

    try {
      await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, provider, maxAttempts: 1 });
      assert.fail("expected SocialMediaPackageGenerationFailedError");
    } catch (error) {
      assert.ok(error instanceof SocialMediaPackageGenerationFailedError);
      const [attempt] = error.attempts;
      assert.equal(attempt.stage, "result-shape");
      assert.equal(attempt.fieldDiagnostics.field, "carousel");
      assert.equal(attempt.fieldDiagnostics.shape.exists, false);
      assert.ok(!attempt.fieldDiagnostics.topLevelKeys.includes("carousel"));
      assert.deepEqual(attempt.fieldDiagnostics.topLevelKeys, ["hook", "callToAction", "tone", "audience", "industryContext", "platforms"]);
    }
  }));

test("generateSocialMediaPackage() attaches fieldDiagnostics distinguishing a wrong-typed carousel from a missing one", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const provider = fakeProvider("wrong-typed-provider", async () => JSON.stringify({ ...VALID_ANALYSIS, carousel: "not an object" }));

    try {
      await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, provider, maxAttempts: 1 });
      assert.fail("expected SocialMediaPackageGenerationFailedError");
    } catch (error) {
      const [attempt] = error.attempts;
      assert.equal(attempt.fieldDiagnostics.field, "carousel");
      assert.equal(attempt.fieldDiagnostics.shape.exists, true);
      assert.equal(attempt.fieldDiagnostics.shape.type, "string");
      assert.ok(attempt.fieldDiagnostics.topLevelKeys.includes("carousel"));
    }
  }));

test("generateSocialMediaPackage() never leaks a sibling field's generated content inside fieldDiagnostics", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    // heading carries a "secret-looking" real value and is perfectly
    // valid; body on the SAME slide is deliberately left blank so the
    // failure is scoped to a sibling field — proves the diagnostic never
    // leaks a valid neighbouring field's content via shape or key names.
    const slides = VALID_ANALYSIS.carousel.slides.map((s, i) =>
      i === 0 ? { ...s, heading: "a secret-looking headline that must never leak", body: "" } : s
    );
    const provider = fakeProvider("leaky-check-provider", async () =>
      JSON.stringify({ ...VALID_ANALYSIS, carousel: { ...VALID_ANALYSIS.carousel, slides } })
    );

    try {
      await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, provider, maxAttempts: 1 });
      assert.fail("expected SocialMediaPackageGenerationFailedError");
    } catch (error) {
      const [attempt] = error.attempts;
      assert.equal(attempt.fieldDiagnostics.field, "carousel.slides[0].body");
      assert.doesNotMatch(JSON.stringify(attempt.fieldDiagnostics), /secret-looking/);
    }
  }));

// --- DC-003-I032.8 — Revision/Supersession Lineage ---------------------
// Direct regression coverage for the required test list in the I032.8
// brief: first creation is V1, ordinary duplicate still fails, an
// explicit revision creates V2 pointing to V1, revising V2 creates V3
// pointing to V2, revising a non-latest revision fails (never forks),
// and cross-Editorial-Package supersession fails. Historical pre-lineage
// V1 compatibility and "latest revision" lineage-lookup determinism are
// covered directly in social-media-package-store.test.mjs and
// social-media-package-lineage.test.mjs — not duplicated here.
// Downstream I033 consumption of a revision is covered in
// production-package-generator.test.mjs, against the real I033 entry
// point, not re-asserted here.

test("generateSocialMediaPackage() produces revision: 1, supersedes: null for the first-ever Social Media Package", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);

    const v1 = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, idGenerator: () => "sm_lineagev1000001" });

    assert.equal(v1.revision, 1);
    assert.equal(v1.supersedes, null);
  }));

test("ordinary generateSocialMediaPackage() still fails with DuplicateSocialMediaPackageError once any revision exists — revision lineage never weakens this", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const v1 = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, idGenerator: () => "sm_dupv1000000001" });
    await reviseSocialMediaPackage(ep.editorial_package_id, v1.social_media_package_id, {
      editorialPackageStore,
      socialMediaPackageStore,
      idGenerator: () => "sm_dupv2000000001",
    });

    await assert.rejects(
      () => generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore }),
      DuplicateSocialMediaPackageError
    );
  }));

test("reviseSocialMediaPackage() creates V2 — revision 2, supersedes V1's id, V1 itself untouched", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const v1 = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, idGenerator: () => "sm_revv1000000001" });

    const v2 = await reviseSocialMediaPackage(ep.editorial_package_id, v1.social_media_package_id, {
      editorialPackageStore,
      socialMediaPackageStore,
      idGenerator: () => "sm_revv2000000001",
    });

    assert.equal(v2.revision, 2);
    assert.equal(v2.supersedes, v1.social_media_package_id);
    assert.equal(v2.editorial_package_id, ep.editorial_package_id);
    assert.equal(socialMediaPackageStore.get(v1.social_media_package_id).revision, 1);
    assert.equal(socialMediaPackageStore.get(v1.social_media_package_id).supersedes, null);
  }));

test("reviseSocialMediaPackage() of V2 creates V3 — revision 3, supersedes V2's id", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const v1 = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, idGenerator: () => "sm_v3chainv1000001" });
    const v2 = await reviseSocialMediaPackage(ep.editorial_package_id, v1.social_media_package_id, {
      editorialPackageStore,
      socialMediaPackageStore,
      idGenerator: () => "sm_v3chainv2000001",
    });

    const v3 = await reviseSocialMediaPackage(ep.editorial_package_id, v2.social_media_package_id, {
      editorialPackageStore,
      socialMediaPackageStore,
      idGenerator: () => "sm_v3chainv3000001",
    });

    assert.equal(v3.revision, 3);
    assert.equal(v3.supersedes, v2.social_media_package_id);
  }));

test("reviseSocialMediaPackage() of V1 fails with NotLatestRevisionError once V2 already exists — never forks the chain", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const v1 = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, idGenerator: () => "sm_forkguardv1001" });
    await reviseSocialMediaPackage(ep.editorial_package_id, v1.social_media_package_id, {
      editorialPackageStore,
      socialMediaPackageStore,
      idGenerator: () => "sm_forkguardv2001",
    });

    await assert.rejects(
      () =>
        reviseSocialMediaPackage(ep.editorial_package_id, v1.social_media_package_id, {
          editorialPackageStore,
          socialMediaPackageStore,
          idGenerator: () => "sm_forkguardv2b001",
        }),
      NotLatestRevisionError
    );
    assert.equal(socialMediaPackageStore.exists("sm_forkguardv2b001"), false, "the rejected fork attempt must persist nothing");
  }));

test("reviseSocialMediaPackage() fails with CrossEditorialPackageSupersessionError when the superseded record belongs to a different Editorial Package", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const epA = seedEditorialPackage(editorialPackageStore, {}, { idGenerator: () => "ep_crosstesta0000001" });
    const epB = seedEditorialPackage(editorialPackageStore, { ingestedContentId: "ic_bbbbbbbbbbbbbbbb" }, { idGenerator: () => "ep_crosstestb0000001" });
    const smA = await generateSocialMediaPackage(epA.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, idGenerator: () => "sm_crosstesta000001" });

    await assert.rejects(
      () =>
        reviseSocialMediaPackage(epB.editorial_package_id, smA.social_media_package_id, {
          editorialPackageStore,
          socialMediaPackageStore,
          idGenerator: () => "sm_crosstestb000001",
        }),
      CrossEditorialPackageSupersessionError
    );
    assert.equal(socialMediaPackageStore.exists("sm_crosstestb000001"), false);
  }));

test("reviseSocialMediaPackage() throws SocialMediaPackageNotFoundError when the superseded id does not exist", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);

    await assert.rejects(
      () => reviseSocialMediaPackage(ep.editorial_package_id, "sm_doesnotexist00001", { editorialPackageStore, socialMediaPackageStore }),
      SocialMediaPackageNotFoundError
    );
  }));

test("reviseSocialMediaPackage() never throws DuplicateSocialMediaPackageError — that check belongs only to ordinary create", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const v1 = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, idGenerator: () => "sm_noduperrv1001" });

    const v2 = await reviseSocialMediaPackage(ep.editorial_package_id, v1.social_media_package_id, {
      editorialPackageStore,
      socialMediaPackageStore,
      idGenerator: () => "sm_noduperrv2001",
    });
    assert.equal(v2.revision, 2);
  }));

test("reviseSocialMediaPackage() throws PipelineConfigurationError for missing dependencies.editorialPackageStore", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore } = buildStores(base);
    await assert.rejects(() => reviseSocialMediaPackage("ep_x", "sm_x", { socialMediaPackageStore }), PipelineConfigurationError);
  }));

test("reviseSocialMediaPackage() throws PipelineConfigurationError for missing dependencies.socialMediaPackageStore", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore } = buildStores(base);
    await assert.rejects(() => reviseSocialMediaPackage("ep_x", "sm_x", { editorialPackageStore }), PipelineConfigurationError);
  }));

test("reviseSocialMediaPackage() throws PipelineConfigurationError when supersededSocialMediaPackageId is missing", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    await assert.rejects(() => reviseSocialMediaPackage("ep_x", undefined, { editorialPackageStore, socialMediaPackageStore }), PipelineConfigurationError);
  }));

test("reviseSocialMediaPackage() throws EditorialPackageNotFoundError for an unknown editorialPackageId", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const v1 = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, idGenerator: () => "sm_epmissingv1001" });

    await assert.rejects(
      () => reviseSocialMediaPackage("ep_doesnotexist00001", v1.social_media_package_id, { editorialPackageStore, socialMediaPackageStore }),
      EditorialPackageNotFoundError
    );
  }));

test("reviseSocialMediaPackage() with an injected provider uses its output verbatim, same as generateSocialMediaPackage()", () =>
  withTempDir(async (base) => {
    const { editorialPackageStore, socialMediaPackageStore } = buildStores(base);
    const ep = seedEditorialPackage(editorialPackageStore);
    const v1 = await generateSocialMediaPackage(ep.editorial_package_id, { editorialPackageStore, socialMediaPackageStore, idGenerator: () => "sm_injectedv1001" });
    const provider = fakeProvider("fake-revision-provider", async () => JSON.stringify({ ...VALID_ANALYSIS, hook: "Revised hook" }));

    const v2 = await reviseSocialMediaPackage(ep.editorial_package_id, v1.social_media_package_id, {
      editorialPackageStore,
      socialMediaPackageStore,
      provider,
      idGenerator: () => "sm_injectedv2001",
    });

    assert.equal(v2.hook, "Revised hook");
    assert.equal(v2.llm_model, "fake-revision-provider");
  }));

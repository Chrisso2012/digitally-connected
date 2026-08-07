import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateProductionPackage } from "../../src/production-package-generator.mjs";
import { createSocialMediaPackageStore } from "../../src/social-media-package-store.mjs";
import { createLocalJsonSocialMediaPackageStoreAdapter } from "../../src/local-json-social-media-package-store-adapter.mjs";
import { createSocialMediaPackage } from "../../src/social-media-package.mjs";
import { createProductionPackageStore } from "../../src/production-package-store.mjs";
import { createLocalJsonProductionPackageStoreAdapter } from "../../src/local-json-production-package-store-adapter.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { DuplicateProductionPackageError, RequiredRendererMappingMissingError, InvalidTemplateMappingError } from "../../src/production-package-errors.mjs";
import { SocialMediaPackageNotFoundError } from "../../src/social-media-package-errors.mjs";

async function withTempDir(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-production-package-generator-"));
  try {
    return await fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function buildStores(base) {
  const socialMediaPackageStore = createSocialMediaPackageStore({ adapter: createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: path.join(base, "sm") }) });
  const productionPackageStore = createProductionPackageStore({ adapter: createLocalJsonProductionPackageStoreAdapter({ storageDir: path.join(base, "pp") }) });
  return { socialMediaPackageStore, productionPackageStore };
}

function seedSocialMediaPackage(store, overrides = {}) {
  return store.save(
    createSocialMediaPackage(
      {
        editorialPackageId: "ep_a1b2c3d4e5f60708",
        hook: "The hook.",
        callToAction: "Act now.",
        tone: "professional and confident",
        audience: "The audience.",
        platforms: {
          linkedin: { postText: "LinkedIn post text.", hashtags: ["one"] },
          facebook: { postText: "Facebook post text.", hashtags: ["two"] },
          x: { postText: "X post text.", hashtags: [] },
          instagram: { caption: "Instagram caption.", hashtags: ["three"] },
        },
        carousel: {
          headings: ["H1", "H2", "H3", "H4", "H5", "H6"],
          slideCopy: ["S1", "S2", "S3", "S4", "S5", "S6"],
          imageGuidance: ["G1", "G2", "G3", "G4", "G5", "G6"],
        },
        llmModel: "mock-social-media-provider-v1",
        promptVersion: "social-media-package.v1",
        schemaVersion: "1.0",
        ...overrides,
      },
      { idGenerator: () => "sm_generatortest0001" }
    )
  );
}

function fakeRendererAdapter({ buildSlideSequenceImpl, mapToRendererPayloadImpl } = {}) {
  return {
    name: "fake-renderer-adapter",
    // Deliberately reuses the "templated" renderer name — production-package.schema.json's
    // own `renderer` enum is narrow (only lists renderers with a real, implemented
    // adapter), so a genuinely made-up renderer name would fail schema validation
    // regardless of this fake adapter's own behavior; that's not what these tests
    // are checking.
    renderer: "templated",
    buildSlideSequence:
      buildSlideSequenceImpl ??
      (() => ({
        slideSequence: [1, 2, 3, 4, 5, 6].map((n) => ({
          slideNumber: n,
          headlineMapping: `H${n}`,
          bodyCopyMapping: `B${n}`,
          ctaMapping: n === 6 ? "CTA" : null,
          imageGuidanceMapping: `G${n}`,
          placeholderTagMapping: { headline: `H${n}`, body: `B${n}`, cta: n === 6 ? "CTA" : null, image_guidance: `G${n}` },
        })),
        templateId: "fake-template-family-v1",
        renderingMetadata: { mappingStrategy: "fake-strategy", slideCount: 6, generator: "fake-renderer-adapter" },
      })),
    mapToRendererPayload: mapToRendererPayloadImpl ?? (() => []),
  };
}

test("generateProductionPackage() generates and persists a valid record using the default (Templated) adapter", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore, productionPackageStore } = buildStores(base);
    const smp = seedSocialMediaPackage(socialMediaPackageStore);

    const record = await generateProductionPackage(smp.social_media_package_id, { socialMediaPackageStore, productionPackageStore, idGenerator: () => "pp_generatortest0001" });

    assert.equal(record.production_package_id, "pp_generatortest0001");
    assert.equal(record.social_media_package_id, smp.social_media_package_id);
    assert.equal(record.renderer, "templated");
    assert.equal(record.slide_sequence.length, 6);
    assert.equal(productionPackageStore.get("pp_generatortest0001").production_package_id, "pp_generatortest0001");
  }));

test("generateProductionPackage() with an injected rendererAdapter uses its slideSequence verbatim", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore, productionPackageStore } = buildStores(base);
    const smp = seedSocialMediaPackage(socialMediaPackageStore);
    const rendererAdapter = fakeRendererAdapter();

    const record = await generateProductionPackage(smp.social_media_package_id, { socialMediaPackageStore, productionPackageStore, rendererAdapter, idGenerator: () => "pp_faketest00000001" });

    assert.equal(record.renderer, "templated");
    assert.equal(record.template_id, "fake-template-family-v1");
    assert.equal(record.slide_sequence[0].headline_mapping, "H1");
    assert.equal(record.slide_sequence[5].cta_mapping, "CTA");
  }));

test("generateProductionPackage() records the source Social Media Package's own real checksum in validation_metadata", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore, productionPackageStore } = buildStores(base);
    const smp = seedSocialMediaPackage(socialMediaPackageStore);

    const record = await generateProductionPackage(smp.social_media_package_id, { socialMediaPackageStore, productionPackageStore });
    assert.equal(record.validation_metadata.social_media_package_checksum, smp.checksum);
    assert.equal(record.validation_metadata.renderer_mapping_validated, true);
  }));

test("generateProductionPackage() accepts an explicit platform override; defaults to null otherwise", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore, productionPackageStore } = buildStores(base);
    const smp = seedSocialMediaPackage(socialMediaPackageStore);

    const withPlatform = await generateProductionPackage(smp.social_media_package_id, { socialMediaPackageStore, productionPackageStore, platform: "instagram" });
    assert.equal(withPlatform.platform, "instagram");
  }));

test("generateProductionPackage() throws SocialMediaPackageNotFoundError for an unknown socialMediaPackageId", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore, productionPackageStore } = buildStores(base);
    await assert.rejects(
      () => generateProductionPackage("sm_doesnotexist00001", { socialMediaPackageStore, productionPackageStore }),
      SocialMediaPackageNotFoundError
    );
  }));

test("generateProductionPackage() throws DuplicateProductionPackageError when one already exists for this Social Media Package", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore, productionPackageStore } = buildStores(base);
    const smp = seedSocialMediaPackage(socialMediaPackageStore);
    await generateProductionPackage(smp.social_media_package_id, { socialMediaPackageStore, productionPackageStore });
    await assert.rejects(
      () => generateProductionPackage(smp.social_media_package_id, { socialMediaPackageStore, productionPackageStore }),
      DuplicateProductionPackageError
    );
  }));

test("generateProductionPackage() propagates RequiredRendererMappingMissingError from buildSlideSequence() and persists nothing", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore, productionPackageStore } = buildStores(base);
    const smp = seedSocialMediaPackage(socialMediaPackageStore);
    const rendererAdapter = fakeRendererAdapter({
      buildSlideSequenceImpl: () => {
        throw new RequiredRendererMappingMissingError("fake-renderer", 1, "headline_text");
      },
    });

    await assert.rejects(
      () => generateProductionPackage(smp.social_media_package_id, { socialMediaPackageStore, productionPackageStore, rendererAdapter }),
      RequiredRendererMappingMissingError
    );
    assert.equal(productionPackageStore.list().length, 0);
  }));

test("generateProductionPackage() propagates InvalidTemplateMappingError from the validation-time mapToRendererPayload() call and persists nothing", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore, productionPackageStore } = buildStores(base);
    const smp = seedSocialMediaPackage(socialMediaPackageStore);
    const rendererAdapter = fakeRendererAdapter({
      mapToRendererPayloadImpl: () => {
        throw new InvalidTemplateMappingError("fake-renderer", "unknown-template-key");
      },
    });

    await assert.rejects(
      () => generateProductionPackage(smp.social_media_package_id, { socialMediaPackageStore, productionPackageStore, rendererAdapter }),
      InvalidTemplateMappingError
    );
    assert.equal(productionPackageStore.list().length, 0);
  }));

test("generateProductionPackage() throws PipelineConfigurationError for missing dependencies.socialMediaPackageStore", () =>
  withTempDir(async (base) => {
    const { productionPackageStore } = buildStores(base);
    await assert.rejects(() => generateProductionPackage("sm_x", { productionPackageStore }), PipelineConfigurationError);
  }));

test("generateProductionPackage() throws PipelineConfigurationError for missing dependencies.productionPackageStore", () =>
  withTempDir(async (base) => {
    const { socialMediaPackageStore } = buildStores(base);
    await assert.rejects(() => generateProductionPackage("sm_x", { socialMediaPackageStore }), PipelineConfigurationError);
  }));

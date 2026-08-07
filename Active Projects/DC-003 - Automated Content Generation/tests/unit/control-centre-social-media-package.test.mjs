// DC-003-I032 — focused tests for the Control Centre's new, optional,
// read-only Social Media Package section (computeSocialMediaPackage() /
// overview.social_media_package). A separate, new test file rather than
// adding to the large existing control-centre-service.test.mjs — mirrors
// control-centre-editorial-package.test.mjs's own precedent from I031.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createControlCentreService } from "../../src/control-centre-service.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createProductionMetricsStore } from "../../src/production-metrics-store.mjs";
import { createLocalJsonProductionMetricsStoreAdapter } from "../../src/local-json-production-metrics-store-adapter.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createSocialMediaPackageStore } from "../../src/social-media-package-store.mjs";
import { createLocalJsonSocialMediaPackageStoreAdapter } from "../../src/local-json-social-media-package-store-adapter.mjs";
import { createSocialMediaPackage } from "../../src/social-media-package.mjs";
import { InvalidControlCentreDependenciesError } from "../../src/control-centre-errors.mjs";

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-cc-social-media-package-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildBaseFields(base) {
  return {
    finishedCarouselStore: createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: path.join(base, "carousels") }) }),
    productionMetricsStore: createProductionMetricsStore({ adapter: createLocalJsonProductionMetricsStoreAdapter({ storageDir: path.join(base, "metrics") }) }),
    publisherResultStore: createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: path.join(base, "publisher-results") }) }),
  };
}

function buildSocialMediaPackageStore(dir) {
  return createSocialMediaPackageStore({ adapter: createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: dir }) });
}

function buildRecord(overrides = {}, options = {}) {
  return createSocialMediaPackage(
    {
      editorialPackageId: "ep_a1b2c3d4e5f60708",
      hook: "The hook.",
      callToAction: "Do the thing.",
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
        slides: ["cover", "insight", "statistic", "quote", "takeaway", "cta"].map((slideRole, index) => ({
          slideNumber: index + 1,
          slideRole,
          heading: `H${index + 1}`,
          body: `S${index + 1}`,
          imageGuidance: `G${index + 1}`,
          statistic: slideRole === "statistic" ? { value: "50%", context: "S3" } : null,
          quote: slideRole === "quote" ? { quoteText: "S4" } : null,
          keyPoints: slideRole === "takeaway" ? ["S5"] : [],
        })),
      },
      llmModel: "mock-social-media-provider-v1",
      promptVersion: "social-media-package.v1",
      schemaVersion: "1.0",
      ...overrides,
    },
    options
  );
}

test("social_media_package is null when no Social Media Package Store is supplied", () =>
  withTempDir((base) => {
    const service = createControlCentreService(buildBaseFields(base));
    assert.equal(service.getOverview().social_media_package, null);
  }));

test("social_media_package reflects an empty store as zero counts, not null", () =>
  withTempDir((base) => {
    const socialMediaPackageStore = buildSocialMediaPackageStore(path.join(base, "sm"));
    const service = createControlCentreService({ ...buildBaseFields(base), socialMediaPackageStore });
    assert.deepEqual(service.getOverview().social_media_package, { total_social_media_packages: 0, latest_package: null, latest_status: null });
  }));

test("social_media_package reports total, latest_package summary, and latest_status — never the full platforms/carousel content", () =>
  withTempDir((base) => {
    const socialMediaPackageStore = buildSocialMediaPackageStore(path.join(base, "sm"));
    socialMediaPackageStore.save(
      buildRecord({ hook: "First" }, { idGenerator: () => "sm_first00000000001", now: () => "2026-08-07T10:00:00.000Z" })
    );
    socialMediaPackageStore.save(
      buildRecord(
        { editorialPackageId: "ep_bbbbbbbbbbbbbbbb", hook: "Second" },
        { idGenerator: () => "sm_second0000000001", now: () => "2026-08-07T11:00:00.000Z" }
      )
    );

    const service = createControlCentreService({ ...buildBaseFields(base), socialMediaPackageStore });
    const socialMediaPackage = service.getOverview().social_media_package;

    assert.equal(socialMediaPackage.total_social_media_packages, 2);
    assert.equal(socialMediaPackage.latest_package.social_media_package_id, "sm_second0000000001");
    assert.equal(socialMediaPackage.latest_package.hook, "Second");
    assert.equal(socialMediaPackage.latest_status, "generated");
    assert.equal("platforms" in socialMediaPackage.latest_package, false);
    assert.equal("carousel" in socialMediaPackage.latest_package, false);
  }));

test("createControlCentreService() throws InvalidControlCentreDependenciesError for a malformed socialMediaPackageStore", () =>
  withTempDir((base) => {
    assert.throws(
      () => createControlCentreService({ ...buildBaseFields(base), socialMediaPackageStore: { name: "x" } }),
      InvalidControlCentreDependenciesError
    );
  }));

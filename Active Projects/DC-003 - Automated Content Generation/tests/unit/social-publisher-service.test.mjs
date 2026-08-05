// Unit tests for social-publisher-service.mjs (DC-003-I027). No network
// anywhere — every adapter used here is a mock (createMockInstagramPublisherAdapter/
// createMockLinkedInPublisherAdapter), matching this service's own
// "mock is the default" discipline. Real Finished Carousel Store (I015)
// and Publisher Result Store (I025) instances are used throughout, backed
// by in-memory adapters — this exercises the genuine cross-module
// integration this service composes, not a stubbed version of either.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import { approveCarousel, rejectCarousel } from "../../src/carousel-approval.mjs";
import { createSocialPublishingManifest } from "../../src/social-publishing-manifest.mjs";
import { createMockInstagramPublisherAdapter } from "../../src/instagram-mock-publisher-adapter.mjs";
import { createMockLinkedInPublisherAdapter } from "../../src/linkedin-mock-publisher-adapter.mjs";
import { executeSocialPublish } from "../../src/social-publisher-service.mjs";
import {
  InvalidSocialPublishingManifestForPublishError,
  CarouselNotEligibleForSocialPublishError,
  SocialManifestIdentityMismatchError,
  InvalidAssetPackageForSocialPublishError,
} from "../../src/social-publisher-service-errors.mjs";
import { CarouselNotFoundError } from "../../src/finished-carousel-store-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

function loadFreshCarousel(overrides = {}) {
  return { ...JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")), ...overrides };
}

function createInMemoryAdapter(name) {
  const files = new Map();
  return {
    name,
    write: (id, content) => files.set(id, content),
    read: (id) => {
      if (!files.has(id)) {
        const err = new Error(`ENOENT: ${id}`);
        err.code = "ENOENT";
        throw err;
      }
      return files.get(id);
    },
    list: () => [...files.keys()],
    exists: (id) => files.has(id),
  };
}

async function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-social-service-"));
  try {
    return await fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function seedAssetPackage(base, carouselId, assetPackageId) {
  const dir = path.join(base, "package-" + carouselId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ carousel_id: carouselId, asset_package_id: assetPackageId }));
  return dir;
}

function buildStores() {
  return {
    finishedCarouselStore: createFinishedCarouselStore({ adapter: createInMemoryAdapter("carousels") }),
    publisherResultStore: createPublisherResultStore({ adapter: createInMemoryAdapter("publisher-results") }),
  };
}

function saveApproved(store, carouselId, overrides = {}) {
  store.save(loadFreshCarousel({ carousel_id: carouselId, ...overrides }));
  const approved = approveCarousel({ finishedCarousel: store.get(carouselId), approvedBy: "tester" });
  store.replace({ identifier: carouselId, finishedCarousel: approved });
  return approved;
}

function bothEnabledManifest(carouselId, assetPackageId, overrides = {}) {
  return createSocialPublishingManifest({
    carouselId,
    assetPackageId,
    approvedBy: "tester",
    instagram: { enabled: true, caption: "IG caption", altText: "alt" },
    linkedin: { enabled: true, commentary: "LI commentary" },
    ...overrides,
  });
}

// --- before-publication failures: zero requests, no Publisher Result -----

test("an invalid manifest fails before any store lookup, adapter is never constructed/called", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    const instagram = createMockInstagramPublisherAdapter();
    await assert.rejects(
      () =>
        executeSocialPublish(
          { manifest: { not: "a valid manifest" }, assetPackagePath: base },
          { finishedCarouselStore, publisherResultStore, adapters: { instagram } }
        ),
      InvalidSocialPublishingManifestForPublishError
    );
    assert.equal(instagram.callCount(), 0);
  }));

test("propagates CarouselNotFoundError for a manifest referencing an unknown carousel", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    const manifest = bothEnabledManifest("car_doesnotexist0000", "pkg_doesnotexist0001");
    await assert.rejects(
      () => executeSocialPublish({ manifest, assetPackagePath: base }, { finishedCarouselStore, publisherResultStore, adapters: {} }),
      CarouselNotFoundError
    );
  }));

test("rejects an unapproved carousel — zero requests made", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    finishedCarouselStore.save(loadFreshCarousel({ carousel_id: "car_unapproved0001" }));
    const packagePath = seedAssetPackage(base, "car_unapproved0001", "pkg_unapproved0001");
    const manifest = bothEnabledManifest("car_unapproved0001", "pkg_unapproved0001");
    const instagram = createMockInstagramPublisherAdapter();

    await assert.rejects(
      () => executeSocialPublish({ manifest, assetPackagePath: packagePath }, { finishedCarouselStore, publisherResultStore, adapters: { instagram } }),
      CarouselNotEligibleForSocialPublishError
    );
    assert.equal(instagram.callCount(), 0);
    assert.deepEqual(publisherResultStore.list(), []);
  }));

test("rejects a rejected carousel", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    const rejected = rejectCarousel({ finishedCarousel: loadFreshCarousel({ carousel_id: "car_rejected0000001" }), reason: "not good" });
    finishedCarouselStore.save(rejected);
    const packagePath = seedAssetPackage(base, "car_rejected0000001", "pkg_rejected0000001");
    const manifest = bothEnabledManifest("car_rejected0000001", "pkg_rejected0000001");

    await assert.rejects(
      () => executeSocialPublish({ manifest, assetPackagePath: packagePath }, { finishedCarouselStore, publisherResultStore, adapters: {} }),
      CarouselNotEligibleForSocialPublishError
    );
  }));

test("rejects an incomplete carousel (overall_status !== completed, or fewer than six completed slides)", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    const approved = approveCarousel({
      finishedCarousel: loadFreshCarousel({ carousel_id: "car_incomplete0001", overall_status: "partial" }),
      approvedBy: "tester",
    });
    finishedCarouselStore.save(approved);
    const packagePath = seedAssetPackage(base, "car_incomplete0001", "pkg_incomplete0001");
    const manifest = bothEnabledManifest("car_incomplete0001", "pkg_incomplete0001");

    await assert.rejects(
      () => executeSocialPublish({ manifest, assetPackagePath: packagePath }, { finishedCarouselStore, publisherResultStore, adapters: {} }),
      CarouselNotEligibleForSocialPublishError
    );
  }));

test("rejects a carousel with fewer than six completed slides even if overall_status claims completed", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    const fresh = loadFreshCarousel({ carousel_id: "car_fiveslides00001" });
    fresh.slides[0] = { ...fresh.slides[0], status: "failed" };
    const approved = approveCarousel({ finishedCarousel: fresh, approvedBy: "tester" });
    finishedCarouselStore.save(approved);
    const packagePath = seedAssetPackage(base, "car_fiveslides00001", "pkg_fiveslides00001");
    const manifest = bothEnabledManifest("car_fiveslides00001", "pkg_fiveslides00001");

    await assert.rejects(
      () => executeSocialPublish({ manifest, assetPackagePath: packagePath }, { finishedCarouselStore, publisherResultStore, adapters: {} }),
      CarouselNotEligibleForSocialPublishError
    );
  }));

test("rejects a mismatched asset_package_id between the manifest and the actual package metadata", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    saveApproved(finishedCarouselStore, "car_mismatch0000001");
    const packagePath = seedAssetPackage(base, "car_mismatch0000001", "pkg_actual0000001");
    const manifest = bothEnabledManifest("car_mismatch0000001", "pkg_different000001"); // does not match

    await assert.rejects(
      () => executeSocialPublish({ manifest, assetPackagePath: packagePath }, { finishedCarouselStore, publisherResultStore, adapters: {} }),
      SocialManifestIdentityMismatchError
    );
  }));

test("rejects a missing or incomplete asset package", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    saveApproved(finishedCarouselStore, "car_nopackage0000001");
    const manifest = bothEnabledManifest("car_nopackage0000001", "pkg_nopackage0000001");

    await assert.rejects(
      () =>
        executeSocialPublish(
          { manifest, assetPackagePath: path.join(base, "does-not-exist") },
          { finishedCarouselStore, publisherResultStore, adapters: {} }
        ),
      InvalidAssetPackageForSocialPublishError
    );
  }));

// --- successful, full publish ---------------------------------------------

test("publishes both enabled destinations and saves one Publisher Result each", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    saveApproved(finishedCarouselStore, "car_bothsucceed00001");
    const packagePath = seedAssetPackage(base, "car_bothsucceed00001", "pkg_bothsucceed00001");
    const manifest = bothEnabledManifest("car_bothsucceed00001", "pkg_bothsucceed00001");

    const result = await executeSocialPublish(
      { manifest, assetPackagePath: packagePath },
      { finishedCarouselStore, publisherResultStore, adapters: { instagram: createMockInstagramPublisherAdapter(), linkedin: createMockLinkedInPublisherAdapter() } }
    );

    assert.equal(result.status, "completed");
    assert.equal(result.destinations.instagram.status, "completed");
    assert.equal(result.destinations.linkedin.status, "completed");
    assert.ok(result.destinations.instagram.publisherResultId);
    assert.ok(result.destinations.linkedin.publisherResultId);

    const stored = publisherResultStore.list();
    assert.equal(stored.length, 2);
    assert.deepEqual(stored.map((s) => s.provider).sort(), ["instagram", "linkedin"]);
  }));

test("a disabled destination makes zero requests and reports status 'disabled'", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    saveApproved(finishedCarouselStore, "car_onlyinstagram001");
    const packagePath = seedAssetPackage(base, "car_onlyinstagram001", "pkg_onlyinstagram001");
    const manifest = bothEnabledManifest("car_onlyinstagram001", "pkg_onlyinstagram001", { linkedin: { enabled: false } });

    const linkedin = createMockLinkedInPublisherAdapter();
    const result = await executeSocialPublish(
      { manifest, assetPackagePath: packagePath },
      { finishedCarouselStore, publisherResultStore, adapters: { instagram: createMockInstagramPublisherAdapter(), linkedin } }
    );

    assert.equal(result.destinations.linkedin.status, "disabled");
    assert.equal(linkedin.callCount(), 0);
    assert.equal(result.status, "completed"); // the only ENABLED destination succeeded
  }));

// --- partial success, per the brief's own worked example -----------------

test("Instagram succeeds, LinkedIn fails: overall partial_failure, Instagram stays truthfully recorded, LinkedIn is not", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    saveApproved(finishedCarouselStore, "car_partialfail00001");
    const packagePath = seedAssetPackage(base, "car_partialfail00001", "pkg_partialfail00001");
    const manifest = bothEnabledManifest("car_partialfail00001", "pkg_partialfail00001");

    const result = await executeSocialPublish(
      { manifest, assetPackagePath: packagePath },
      {
        finishedCarouselStore,
        publisherResultStore,
        adapters: { instagram: createMockInstagramPublisherAdapter(), linkedin: createMockLinkedInPublisherAdapter({ mode: "failure" }) },
      }
    );

    assert.equal(result.status, "partial_failure");
    assert.equal(result.destinations.instagram.status, "completed");
    assert.equal(result.destinations.linkedin.status, "failed");
    assert.ok(result.destinations.linkedin.error, "a safe error summary is reported for the failed destination");
    assert.equal(result.destinations.linkedin.publisherResultId, null);

    const stored = publisherResultStore.list();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].provider, "instagram");
  }));

test("the reverse order also holds: LinkedIn succeeds, Instagram fails — LinkedIn stays recorded", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    saveApproved(finishedCarouselStore, "car_partialfail00002");
    const packagePath = seedAssetPackage(base, "car_partialfail00002", "pkg_partialfail00002");
    const manifest = bothEnabledManifest("car_partialfail00002", "pkg_partialfail00002");

    const result = await executeSocialPublish(
      { manifest, assetPackagePath: packagePath },
      {
        finishedCarouselStore,
        publisherResultStore,
        adapters: { instagram: createMockInstagramPublisherAdapter({ mode: "failure" }), linkedin: createMockLinkedInPublisherAdapter() },
      }
    );

    assert.equal(result.status, "partial_failure");
    assert.equal(result.destinations.instagram.status, "failed");
    assert.equal(result.destinations.linkedin.status, "completed");

    const stored = publisherResultStore.list();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].provider, "linkedin");
  }));

test("both destinations failing reports overall status 'failed', with no rollback attempted anywhere", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    saveApproved(finishedCarouselStore, "car_bothfail0000001");
    const packagePath = seedAssetPackage(base, "car_bothfail0000001", "pkg_bothfail0000001");
    const manifest = bothEnabledManifest("car_bothfail0000001", "pkg_bothfail0000001");

    const result = await executeSocialPublish(
      { manifest, assetPackagePath: packagePath },
      {
        finishedCarouselStore,
        publisherResultStore,
        adapters: { instagram: createMockInstagramPublisherAdapter({ mode: "failure" }), linkedin: createMockLinkedInPublisherAdapter({ mode: "failure" }) },
      }
    );

    assert.equal(result.status, "failed");
    assert.deepEqual(publisherResultStore.list(), []);
  }));

// --- duplicate-publishing protection ---------------------------------------

test("a second publish attempt for the same carousel+provider+destination is blocked before any request, reported as 'duplicate'", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    saveApproved(finishedCarouselStore, "car_duplicate0000001");
    const packagePath = seedAssetPackage(base, "car_duplicate0000001", "pkg_duplicate0000001");
    const manifest = bothEnabledManifest("car_duplicate0000001", "pkg_duplicate0000001");

    await executeSocialPublish(
      { manifest, assetPackagePath: packagePath },
      { finishedCarouselStore, publisherResultStore, adapters: { instagram: createMockInstagramPublisherAdapter(), linkedin: createMockLinkedInPublisherAdapter() } }
    );

    const secondInstagram = createMockInstagramPublisherAdapter();
    const secondLinkedin = createMockLinkedInPublisherAdapter();
    const secondResult = await executeSocialPublish(
      { manifest, assetPackagePath: packagePath },
      { finishedCarouselStore, publisherResultStore, adapters: { instagram: secondInstagram, linkedin: secondLinkedin } }
    );

    assert.equal(secondResult.destinations.instagram.status, "duplicate");
    assert.equal(secondResult.destinations.linkedin.status, "duplicate");
    assert.equal(secondInstagram.callCount(), 0, "no platform request is made for an already-published destination");
    assert.equal(secondLinkedin.callCount(), 0);
    assert.equal(publisherResultStore.list().length, 2, "no duplicate Publisher Result was created");
  }));

test("a different destination (account) for the same carousel+provider is NOT treated as a duplicate", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    saveApproved(finishedCarouselStore, "car_diffaccount00001");
    const packagePath = seedAssetPackage(base, "car_diffaccount00001", "pkg_diffaccount00001");
    const manifest = bothEnabledManifest("car_diffaccount00001", "pkg_diffaccount00001", { linkedin: { enabled: false } });

    await executeSocialPublish(
      { manifest, assetPackagePath: packagePath },
      { finishedCarouselStore, publisherResultStore, adapters: { instagram: createMockInstagramPublisherAdapter({ destination: "instagram:account-a" }) } }
    );

    const secondInstagram = createMockInstagramPublisherAdapter({ destination: "instagram:account-b" });
    const secondResult = await executeSocialPublish(
      { manifest, assetPackagePath: packagePath },
      { finishedCarouselStore, publisherResultStore, adapters: { instagram: secondInstagram } }
    );

    assert.equal(secondResult.destinations.instagram.status, "completed");
    assert.equal(secondInstagram.callCount(), 1);
  }));

// --- result shape / safety --------------------------------------------------

test("the summary never includes a caption, commentary, or raw platform response", () =>
  withTempDirs(async (base) => {
    const { finishedCarouselStore, publisherResultStore } = buildStores();
    saveApproved(finishedCarouselStore, "car_safesummary0001");
    const packagePath = seedAssetPackage(base, "car_safesummary0001", "pkg_safesummary0001");
    const manifest = bothEnabledManifest("car_safesummary0001", "pkg_safesummary0001", {
      instagram: { enabled: true, caption: "SECRET_CAPTION_TEXT", altText: "alt" },
      linkedin: { enabled: true, commentary: "SECRET_COMMENTARY_TEXT" },
    });

    const result = await executeSocialPublish(
      { manifest, assetPackagePath: packagePath },
      { finishedCarouselStore, publisherResultStore, adapters: { instagram: createMockInstagramPublisherAdapter(), linkedin: createMockLinkedInPublisherAdapter() } }
    );

    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /SECRET_CAPTION_TEXT/);
    assert.doesNotMatch(serialized, /SECRET_COMMENTARY_TEXT/);
  }));

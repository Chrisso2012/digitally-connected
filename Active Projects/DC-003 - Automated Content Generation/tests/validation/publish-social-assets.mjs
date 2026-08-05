// DC-003-I027 — CLI for the Social Publisher Service: publishes an
// approved, six-slide Finished Carousel to Instagram and/or LinkedIn per
// an already-approved Social Publishing Manifest. Mock by default (no
// network, no credentials needed) — pass --live to publish for real.
//
// Usage:
//   node tests/validation/publish-social-assets.mjs <manifestPath> <finishedCarouselStoreDirectory> <publisherResultStoreDirectory> <assetPackageRoot> [--live]
//   or: npm run publish:social -- <manifestPath> <finishedCarouselStoreDirectory> <publisherResultStoreDirectory> <assetPackageRoot> [--live]
//
// `manifestPath` is a JSON file containing an already-approved Social
// Publishing Manifest (see social-publishing-manifest.mjs /
// schemas/social-publishing-manifest.schema.json) — read verbatim, never
// regenerated or re-approved by this CLI. `assetPackageRoot` is the root
// directory containing `<assetPackageRoot>/<carousel_id>/` — either the
// Docker archive root or the Windows delivery root (DC-003-I026) both
// work, since they are byte-identical.
//
// --live requires the credentials for every ENABLED destination to be
// present before any request is made for ANY destination, and prints the
// exact proposed request budget before execution — no live request is
// authorised without a separate, destination-specific approval. Disabled
// destinations never make a request in either mode.
//
// Captions/commentary are never printed in normal output — only
// identifiers and status.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import {
  InvalidCarouselStoreAdapterError,
  InvalidCarouselIdentifierError,
  CarouselNotFoundError,
  CorruptedCarouselError,
  CarouselPersistenceError,
} from "../../src/finished-carousel-store-errors.mjs";
import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import {
  InvalidPublisherResultStoreAdapterError,
  CorruptedPublisherResultError,
  PublisherResultPersistenceError,
} from "../../src/publisher-result-errors.mjs";
import { executeSocialPublish } from "../../src/social-publisher-service.mjs";
import {
  InvalidSocialPublisherAdapterError,
  InvalidSocialPublishingManifestForPublishError,
  CarouselNotEligibleForSocialPublishError,
  SocialManifestIdentityMismatchError,
  InvalidAssetPackageForSocialPublishError,
} from "../../src/social-publisher-service-errors.mjs";
import { createInstagramCarouselPublisherAdapter } from "../../src/instagram-carousel-publisher-adapter.mjs";
import { createMockInstagramPublisherAdapter } from "../../src/instagram-mock-publisher-adapter.mjs";
import { loadInstagramPublisherConfig } from "../../src/instagram-publisher-config.mjs";
import { InstagramConfigurationError } from "../../src/instagram-publisher-errors.mjs";
import { createLinkedInMultiImagePublisherAdapter } from "../../src/linkedin-multi-image-publisher-adapter.mjs";
import { createMockLinkedInPublisherAdapter } from "../../src/linkedin-mock-publisher-adapter.mjs";
import { loadLinkedInPublisherConfig } from "../../src/linkedin-publisher-config.mjs";
import { LinkedInConfigurationError } from "../../src/linkedin-publisher-errors.mjs";

const KNOWN_ERRORS = [
  InvalidCarouselStoreAdapterError,
  InvalidCarouselIdentifierError,
  CarouselNotFoundError,
  CorruptedCarouselError,
  CarouselPersistenceError,
  InvalidPublisherResultStoreAdapterError,
  CorruptedPublisherResultError,
  PublisherResultPersistenceError,
  InvalidSocialPublisherAdapterError,
  InvalidSocialPublishingManifestForPublishError,
  CarouselNotEligibleForSocialPublishError,
  SocialManifestIdentityMismatchError,
  InvalidAssetPackageForSocialPublishError,
  InstagramConfigurationError,
  LinkedInConfigurationError,
];

const REQUEST_BUDGET = { instagram: 8, linkedin: 13 };

function usageAndExit() {
  console.error(
    "Usage: node tests/validation/publish-social-assets.mjs <manifestPath> <finishedCarouselStoreDirectory> <publisherResultStoreDirectory> <assetPackageRoot> [--live]"
  );
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const isLive = rawArgs.includes("--live");
const [manifestPath, carouselStoreDirectory, publisherResultStoreDirectory, assetPackageRoot] = rawArgs.filter((arg) => !arg.startsWith("--"));

if (!manifestPath || !carouselStoreDirectory || !publisherResultStoreDirectory || !assetPackageRoot) usageAndExit();

try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const enabledProviders = ["instagram", "linkedin"].filter((provider) => manifest?.destinations?.[provider]?.enabled === true);

  console.log(`Manifest ID:          ${manifest.manifest_id}`);
  console.log(`Carousel ID:          ${manifest.carousel_id}`);
  console.log(`Enabled destinations: ${enabledProviders.length > 0 ? enabledProviders.join(", ") : "(none)"}`);

  const finishedCarouselStore = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselStoreDirectory }) });
  const publisherResultStore = createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: publisherResultStoreDirectory }) });
  const assetPackagePath = path.join(assetPackageRoot, manifest.carousel_id);

  const adapters = {};

  if (isLive) {
    const proposedBudget = enabledProviders.reduce((sum, provider) => sum + REQUEST_BUDGET[provider], 0);
    console.log(`LIVE mode — proposed request budget: ${enabledProviders.map((p) => `${p}=${REQUEST_BUDGET[p]}`).join(", ")} (total ${proposedBudget} request(s))`);
    console.log("This performs real, irreversible platform requests. No retries.");

    if (enabledProviders.includes("instagram")) {
      const config = loadInstagramPublisherConfig();
      const missing = [];
      if (!config.accessToken) missing.push("INSTAGRAM_ACCESS_TOKEN");
      if (!config.userId) missing.push("INSTAGRAM_USER_ID");
      if (missing.length > 0) {
        console.error(`FAIL  --live requires ${missing.join(", ")} to be set in the environment (Instagram is an enabled destination)`);
        process.exit(1);
      }
      adapters.instagram = createInstagramCarouselPublisherAdapter(config);
    }
    if (enabledProviders.includes("linkedin")) {
      const config = loadLinkedInPublisherConfig();
      const missing = [];
      if (!config.accessToken) missing.push("LINKEDIN_ACCESS_TOKEN");
      if (!config.authorUrn) missing.push("LINKEDIN_AUTHOR_URN");
      if (!config.apiVersion) missing.push("LINKEDIN_API_VERSION");
      if (missing.length > 0) {
        console.error(`FAIL  --live requires ${missing.join(", ")} to be set in the environment (LinkedIn is an enabled destination)`);
        process.exit(1);
      }
      adapters.linkedin = createLinkedInMultiImagePublisherAdapter(config);
    }
  } else {
    if (enabledProviders.includes("instagram")) adapters.instagram = createMockInstagramPublisherAdapter();
    if (enabledProviders.includes("linkedin")) adapters.linkedin = createMockLinkedInPublisherAdapter();
  }

  const result = await executeSocialPublish({ manifest, assetPackagePath }, { finishedCarouselStore, publisherResultStore, adapters });

  console.log();
  for (const provider of ["instagram", "linkedin"]) {
    const outcome = result.destinations[provider];
    console.log(`  ${provider.padEnd(10)} status=${outcome.status.padEnd(10)} postId=${outcome.postId ?? "n/a"} publisherResultId=${outcome.publisherResultId ?? "n/a"}`);
    if (outcome.error) console.log(`  ${" ".repeat(10)} error: ${outcome.error.name} — ${outcome.error.message}`);
  }
  console.log();
  console.log(`Overall status: ${result.status}`);

  process.exit(result.status === "failed" ? 1 : 0);
} catch (error) {
  if (KNOWN_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else if (error.code === "ENOENT") {
    console.error(`FAIL  File not found: ${manifestPath}`);
  } else if (error instanceof SyntaxError) {
    console.error(`FAIL  Malformed JSON manifest: ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

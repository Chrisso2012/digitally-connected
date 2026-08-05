// DC-003-I027 — Social Publisher Service: the only module that executes
// an approved Social Publishing Manifest. Composition only — no image
// downloading, no metadata construction, no caption/commentary
// authorship. Architectural principle, from the brief: "The Social
// Publisher executes approved instructions. It does not create content.
// It does not decide what to publish. It does not alter captions. It
// does not infer missing fields."
//
// Two independent approval gates, both required (per the brief's own
// "Approval Rules" — carousel approval is never treated as approval of
// captions or platform copy):
//   1. The referenced Finished Carousel: completed, approved, not
//      rejected, exactly six completed slides — reused eligibility
//      logic, matching the exact vocabulary DC-003-I021/I026's own
//      CarouselNotEligibleForExportError already established for this
//      class of gate.
//   2. The Social Publishing Manifest itself: schema-valid, which
//      already encodes "approval.approved is fixed true" and "an enabled
//      destination has non-empty copy" (see the schema's own header
//      comment) — re-validated here, never trusted from an upstream
//      caller.
//
// Destinations are published SEQUENTIALLY, in a fixed order (Instagram,
// then LinkedIn) — never in parallel, matching the brief's own explicit
// instruction. A Publisher Result is saved IMMEDIATELY after each
// individual platform success — never batched, never delayed waiting for
// a later destination, so a genuine Instagram success is never lost or
// left unrecorded just because a later LinkedIn attempt fails. Execution
// policy, explicitly documented and tested (per the brief's own
// instruction that any continue-past-failure behaviour must be): a
// failure on one destination does NOT prevent the next enabled
// destination from being attempted — this is what makes the brief's own
// worked example possible ("Instagram succeeds ... LinkedIn fails ...
// overall result is partial_failure ... Instagram must remain truthfully
// recorded as published").
//
// Duplicate-publishing protection: before EVERY destination's own
// request, the Publisher Result Store (I025, unmodified) is checked via
// findByCarousel() for an existing successful publication to the exact
// same provider + destination (the adapter's own `destination` property,
// available synchronously before any request — see
// social-publisher-adapter.mjs's own header comment for why). No
// `--replace` exists for this check, by design — social posts cannot be
// safely replaced or deleted like a local file or a Drive upload.

import { createPublisherResult } from "./publisher-result.mjs";
import { createValidator } from "./validator.mjs";
import { assertValidSocialPublisherAdapter } from "./social-publisher-adapter.mjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  InvalidSocialPublishingManifestForPublishError,
  CarouselNotEligibleForSocialPublishError,
  SocialManifestIdentityMismatchError,
  InvalidAssetPackageForSocialPublishError,
  DuplicateSocialPublicationError,
  SocialPlatformPublishError,
} from "./social-publisher-service-errors.mjs";

const METADATA_FILENAME = "metadata.json";
const DESTINATION_ORDER = ["instagram", "linkedin"];

function checkCarouselEligibility(finishedCarousel) {
  const carouselId = finishedCarousel.carousel_id;
  if (finishedCarousel.overall_status !== "completed") {
    throw new CarouselNotEligibleForSocialPublishError(carouselId, `overall_status is "${finishedCarousel.overall_status}", not "completed"`);
  }
  if (finishedCarousel.approval?.rejected === true) {
    throw new CarouselNotEligibleForSocialPublishError(carouselId, "the carousel has been rejected");
  }
  if (finishedCarousel.approval?.approved !== true) {
    throw new CarouselNotEligibleForSocialPublishError(carouselId, "the carousel has not been approved");
  }
  const completedSlideCount = finishedCarousel.slides.filter((slide) => slide.status === "completed").length;
  if (completedSlideCount !== 6) {
    throw new CarouselNotEligibleForSocialPublishError(carouselId, `has ${completedSlideCount} completed slide(s), not the required six`);
  }
}

function loadAssetPackageMetadata(assetPackagePath, carouselId) {
  if (typeof assetPackagePath !== "string" || assetPackagePath.trim() === "" || !existsSync(assetPackagePath)) {
    throw new InvalidAssetPackageForSocialPublishError(carouselId, "the asset package directory does not exist");
  }
  const metadataPath = path.join(assetPackagePath, METADATA_FILENAME);
  if (!existsSync(metadataPath)) {
    throw new InvalidAssetPackageForSocialPublishError(carouselId, "metadata.json is missing — this is not a completed I021 export");
  }
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
  } catch {
    throw new InvalidAssetPackageForSocialPublishError(carouselId, "metadata.json is not valid JSON");
  }
  if (metadata.carousel_id !== carouselId) {
    throw new InvalidAssetPackageForSocialPublishError(carouselId, "metadata.json's own carousel_id does not match");
  }
  return metadata;
}

function isEnabled(manifest, provider) {
  return manifest.destinations[provider]?.enabled === true;
}

function findExistingPublication(publisherResultStore, carouselId, provider, destination) {
  const existing = publisherResultStore.findByCarousel(carouselId);
  return existing.find((result) => result.provider === provider && result.destination === destination) ?? null;
}

/**
 * Publishes an approved Social Publishing Manifest's enabled destinations
 * for one approved carousel.
 *
 * fields.manifest — required, an already-built Social Publishing
 *   Manifest (see social-publishing-manifest.mjs) — re-validated against
 *   its own schema here, never trusted as-is.
 * fields.assetPackagePath — required, a local directory path to the
 *   completed I021 Production Asset Package for this carousel (the
 *   Docker archive or the Windows delivery copy — both are byte-identical
 *   per DC-003-I026, so either is acceptable).
 *
 * dependencies.finishedCarouselStore — required, an I015 Finished
 *   Carousel Store instance.
 * dependencies.publisherResultStore — required, an I025 Publisher Result
 *   Store instance.
 * dependencies.adapters — required, `{ instagram?: SocialPublisherAdapter,
 *   linkedin?: SocialPublisherAdapter }` — an adapter is only required for
 *   a destination the manifest actually enables; validated via
 *   assertValidSocialPublisherAdapter() before any request is made for
 *   that destination.
 * dependencies.now / idGenerator / validator / rootDir — forwarded to
 *   createPublisherResult() unchanged, for deterministic tests.
 *
 * Throws InvalidSocialPublishingManifestForPublishError,
 * CarouselNotEligibleForSocialPublishError,
 * InvalidAssetPackageForSocialPublishError, or
 * SocialManifestIdentityMismatchError before ANY platform request is made
 * — matching the brief's own "before publication: make zero platform
 * requests, create no Publisher Result" failure rule. Propagates whatever
 * error finishedCarouselStore.get() itself throws.
 *
 * Never throws for a per-destination platform failure or duplicate — each
 * destination's own outcome is captured in the returned summary instead,
 * so one destination's failure never hides another destination's success.
 *
 * Returns { status: "completed" | "partial_failure" | "failed",
 * manifestId, carouselId, destinations: { instagram: DestinationOutcome,
 * linkedin: DestinationOutcome } } where DestinationOutcome is
 * { status: "completed" | "failed" | "duplicate" | "disabled",
 * publisherResultId, postId, postUrl, error }.
 */
export async function executeSocialPublish(fields = {}, dependencies = {}) {
  const { manifest, assetPackagePath } = fields;
  const { finishedCarouselStore, publisherResultStore, adapters = {} } = dependencies;
  const validator = dependencies.validator ?? createValidator(dependencies);

  const manifestValidation = validator.validate("socialPublishingManifest", manifest);
  if (!manifestValidation.valid) {
    throw new InvalidSocialPublishingManifestForPublishError(manifestValidation.errors);
  }

  const finishedCarousel = finishedCarouselStore.get(manifest.carousel_id);
  checkCarouselEligibility(finishedCarousel);

  const packageMetadata = loadAssetPackageMetadata(assetPackagePath, finishedCarousel.carousel_id);
  if (packageMetadata.asset_package_id !== manifest.asset_package_id) {
    throw new SocialManifestIdentityMismatchError("asset_package_id", manifest.asset_package_id, packageMetadata.asset_package_id);
  }

  // Fail fast, before any request: every ENABLED destination must have a
  // well-shaped adapter supplied. A missing/malformed adapter for an
  // enabled destination is a caller/wiring bug, not a platform failure.
  for (const provider of DESTINATION_ORDER) {
    if (isEnabled(manifest, provider) && adapters[provider]) {
      assertValidSocialPublisherAdapter(adapters[provider]);
    }
  }

  const destinations = {};

  for (const provider of DESTINATION_ORDER) {
    if (!isEnabled(manifest, provider)) {
      destinations[provider] = { status: "disabled", publisherResultId: null, postId: null, postUrl: null, error: null };
      continue;
    }

    const adapter = adapters[provider];
    assertValidSocialPublisherAdapter(adapter);

    const existingPublication = findExistingPublication(publisherResultStore, finishedCarousel.carousel_id, provider, adapter.destination);
    if (existingPublication) {
      destinations[provider] = {
        status: "duplicate",
        publisherResultId: existingPublication.publisher_result_id,
        postId: existingPublication.provider_reference,
        postUrl: null,
        error: null,
      };
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop -- destinations are
      // published sequentially, by design (see this file's own header
      // comment) — never in parallel.
      const adapterResult = await adapter.publish({ manifest, finishedCarousel, assetPackagePath });

      const publisherResult = createPublisherResult(
        {
          carouselId: finishedCarousel.carousel_id,
          assetPackageId: manifest.asset_package_id,
          executionId: finishedCarousel.execution_metadata.execution_id,
          provider,
          destination: adapter.destination,
          providerReference: adapterResult.postId,
          metadata: { post_url: adapterResult.postUrl, item_count: adapterResult.itemCount },
        },
        { now: dependencies.now, idGenerator: dependencies.idGenerator, validator, rootDir: dependencies.rootDir }
      );
      publisherResultStore.save(publisherResult);

      destinations[provider] = {
        status: "completed",
        publisherResultId: publisherResult.publisher_result_id,
        postId: adapterResult.postId,
        postUrl: adapterResult.postUrl,
        error: null,
      };
    } catch (cause) {
      const safeError = new SocialPlatformPublishError(provider, finishedCarousel.carousel_id, cause.message ?? "publish failed", cause);
      destinations[provider] = {
        status: "failed",
        publisherResultId: null,
        postId: null,
        postUrl: null,
        error: { name: safeError.name, message: safeError.message },
      };
    }
  }

  const attempted = DESTINATION_ORDER.filter((provider) => destinations[provider].status !== "disabled");
  const succeeded = attempted.filter((provider) => destinations[provider].status === "completed");

  let status;
  if (attempted.length === 0) {
    status = "failed"; // schema already guarantees at least one destination is enabled, but never assumed here
  } else if (succeeded.length === attempted.length) {
    status = "completed";
  } else if (succeeded.length === 0) {
    status = "failed";
  } else {
    status = "partial_failure";
  }

  return {
    status,
    manifestId: manifest.manifest_id,
    carouselId: finishedCarousel.carousel_id,
    destinations,
  };
}

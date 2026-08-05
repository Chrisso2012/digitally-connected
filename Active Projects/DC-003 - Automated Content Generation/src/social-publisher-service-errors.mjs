// DC-003-I027 — structured errors for the Social Publisher Service and
// the Social Publisher Adapter contract. Mirrors this codebase's
// established discipline throughout: every message here is written on
// the assumption it may be shown to an external caller — none of them
// ever interpolate a raw filesystem path, a raw Node error message, a
// stack trace, an access token, an approved caption/commentary value, or
// a raw platform API response body. Only already-public identifiers
// (carousel_id, manifest_id, a provider name) are ever named.

/**
 * A caller handed the service something that doesn't implement the
 * Social Publisher Adapter shape: { name: string, provider: string,
 * publish({ manifest, finishedCarousel, assetPackagePath }) }.
 */
export class InvalidSocialPublisherAdapterError extends Error {
  constructor() {
    super("A Social Publisher Adapter must be shaped { name: string, provider: string, publish({ manifest, finishedCarousel, assetPackagePath }) }");
    this.name = "InvalidSocialPublisherAdapterError";
  }
}

/**
 * The supplied Social Publishing Manifest fails schema validation — this
 * service re-validates it (defense in depth), never trusting an upstream
 * caller already did.
 */
export class InvalidSocialPublishingManifestForPublishError extends Error {
  constructor(errors) {
    super(`The Social Publishing Manifest failed schema validation (${errors.length} error(s)) — see production logs for detail, never echoed here`);
    this.name = "InvalidSocialPublishingManifestForPublishError";
  }
}

/**
 * The referenced Finished Carousel is not eligible for social publishing:
 * not `overall_status: "completed"`, not `approval.approved: true`, is
 * `approval.rejected: true`, or does not have exactly six completed
 * slides. Mirrors DC-003-I021/I026's own CarouselNotEligibleForExportError
 * naming convention for the same class of gate.
 */
export class CarouselNotEligibleForSocialPublishError extends Error {
  constructor(carouselId, reason) {
    super(`Carousel "${carouselId}" is not eligible for social publishing — ${reason}`);
    this.name = "CarouselNotEligibleForSocialPublishError";
    this.carouselId = carouselId;
  }
}

/**
 * The manifest's own carousel_id/asset_package_id does not match the
 * Finished Carousel or Production Asset Package actually supplied to the
 * service — never silently publishes against a mismatched identity.
 */
export class SocialManifestIdentityMismatchError extends Error {
  constructor(field, manifestValue, actualValue) {
    super(`Social Publishing Manifest's ${field} ("${manifestValue}") does not match the supplied ${field} ("${actualValue}")`);
    this.name = "SocialManifestIdentityMismatchError";
  }
}

/**
 * `assetPackagePath` does not point at a completed I021 export package —
 * mirrors DC-003-I022's own InvalidAssetPackageError identification rule
 * (metadata.json present, parseable, matching carousel_id).
 */
export class InvalidAssetPackageForSocialPublishError extends Error {
  constructor(carouselId, reason) {
    super(`The asset package for carousel "${carouselId}" is not usable for social publishing — ${reason}`);
    this.name = "InvalidAssetPackageForSocialPublishError";
    this.carouselId = carouselId;
  }
}

/**
 * The Publisher Result Store already proves a successful publication
 * exists for this exact carousel_id + provider + destination — fails
 * BEFORE any platform request is made. No `--replace` exists for this
 * check by design (see README "Duplicate-Publishing Protection") — social
 * posts cannot be safely replaced like a local file or a Drive upload.
 */
export class DuplicateSocialPublicationError extends Error {
  constructor(carouselId, provider) {
    super(`Carousel "${carouselId}" has already been successfully published to "${provider}" — publishing the same carousel to the same destination again is not permitted; a deliberate re-publication requires a new, separately-approved manifest, not a force flag`);
    this.name = "DuplicateSocialPublicationError";
    this.carouselId = carouselId;
    this.provider = provider;
  }
}

/**
 * A specific platform adapter's own publish() call failed. The
 * underlying cause (which may contain a raw API response, headers, or
 * credential) is attached as `.cause` for local debugging only, never
 * included in `.message`. The service still records every OTHER
 * destination's own independent success or failure — this error
 * represents exactly one destination's own outcome, never the whole
 * multi-platform operation.
 */
export class SocialPlatformPublishError extends Error {
  constructor(provider, carouselId, reason, cause) {
    super(`Publishing carousel "${carouselId}" to "${provider}" failed — ${reason}`, { cause });
    this.name = "SocialPlatformPublishError";
    this.provider = provider;
    this.carouselId = carouselId;
  }
}

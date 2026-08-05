// DC-003-I027 — Social Publishing Manifest domain object factory. Mirrors
// the "assemble, then validate, then deep-freeze" discipline every other
// domain-object factory in this codebase already applies to itself
// (publisher-result.mjs, production-metrics.mjs, finished-carousel-builder.mjs)
// — composition only, no filesystem APIs, no HTTP, no platform SDKs.
//
// This factory never writes, rewrites, or normalises approved copy beyond
// the safe structural checks the schema itself already encodes (non-empty
// when a destination is enabled) — per the I027 architectural principle,
// "The Social Publisher executes approved instructions. It does not
// create content. It does not alter captions." Whatever caption/
// commentary string the caller supplies is stored verbatim.
//
// This schema represents ONLY an already-approved manifest — there is no
// draft/review lifecycle, unlike the Carousel Approval workflow's own
// approve/reject state machine. `createSocialPublishingManifest()`
// therefore always requires `approvedBy` and always produces
// `approval.approved: true` — there is no "create a draft, approve it
// later" two-step here, by design (see schema's own header comment).

import { randomUUID } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidSocialPublishingManifestInputError, SocialPublishingManifestValidationError } from "./social-publishing-manifest-errors.mjs";

function generateManifestId() {
  return "spm_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Builds an immutable, already-approved Social Publishing Manifest —
 * composition only, never invents a field or rewrites supplied copy.
 *
 * fields.carouselId — required, `^car_[A-Za-z0-9]+$`.
 * fields.assetPackageId — required, `^pkg_[A-Za-z0-9]+$`.
 * fields.approvedBy — required, non-empty string identifying who approved
 *   this manifest's publishing copy (a separate approval from I014's own
 *   carousel approval — see this file's own header comment).
 * fields.instagram — optional, `{ enabled, caption, altText }`. Omitted
 *   or `enabled: false` means Instagram publishing is not requested by
 *   this manifest.
 * fields.linkedin — optional, `{ enabled, commentary }`. Omitted or
 *   `enabled: false` means LinkedIn publishing is not requested.
 *
 * options.now — override the clock (used by tests); defaults to
 *   () => new Date().toISOString().
 * options.idGenerator — override manifest_id generation (used by tests).
 * options.validator — inject a pre-built validator.
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidSocialPublishingManifestInputError immediately for a
 * structurally malformed input (a caller bug). Throws
 * SocialPublishingManifestValidationError if the assembled object still
 * fails schema validation despite passing every composition check above
 * — e.g. neither destination enabled, or an enabled destination with no
 * non-empty copy.
 */
export function createSocialPublishingManifest(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateManifestId;
  const validator = options.validator ?? createValidator(options);

  if (!isNonEmptyString(fields.carouselId)) {
    throw new InvalidSocialPublishingManifestInputError("fields.carouselId is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.assetPackageId)) {
    throw new InvalidSocialPublishingManifestInputError("fields.assetPackageId is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.approvedBy)) {
    throw new InvalidSocialPublishingManifestInputError("fields.approvedBy is required and must be a non-empty string");
  }
  if (fields.instagram !== undefined && (fields.instagram === null || typeof fields.instagram !== "object")) {
    throw new InvalidSocialPublishingManifestInputError("fields.instagram, when supplied, must be a plain object");
  }
  if (fields.linkedin !== undefined && (fields.linkedin === null || typeof fields.linkedin !== "object")) {
    throw new InvalidSocialPublishingManifestInputError("fields.linkedin, when supplied, must be a plain object");
  }

  const approvedAt = now();

  const manifest = {
    manifest_id: idGenerator(),
    carousel_id: fields.carouselId,
    asset_package_id: fields.assetPackageId,
    created_at: approvedAt,
    approval: {
      approved: true,
      approved_by: fields.approvedBy,
      approved_at: approvedAt,
    },
    destinations: {
      instagram: {
        enabled: fields.instagram?.enabled === true,
        caption: fields.instagram?.caption ?? null,
        alt_text: fields.instagram?.altText ?? null,
      },
      linkedin: {
        enabled: fields.linkedin?.enabled === true,
        commentary: fields.linkedin?.commentary ?? null,
      },
    },
  };

  const validation = validator.validate("socialPublishingManifest", manifest);
  if (!validation.valid) {
    throw new SocialPublishingManifestValidationError(validation.errors);
  }

  return deepFreezeClone(manifest);
}

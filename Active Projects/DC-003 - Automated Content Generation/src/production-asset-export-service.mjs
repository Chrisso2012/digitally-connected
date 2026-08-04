// DC-003-I021 — Production Asset Export Service: validates inputs, then
// delegates the actual work to an injected Export Adapter — the same
// "domain layer validates, adapter only moves bytes" division this
// codebase already uses for the Finished Carousel Store (I015) and the
// Renderer (I006). This module implements no filesystem or network logic
// of its own; see local-production-asset-export-adapter.mjs for that.
//
// Validation performed here, before any adapter call:
//   1. The adapter shape (assertValidExportAdapter, provider-independent —
//      this service has no idea whether it's local, S3, or anything else).
//   2. The Finished Carousel: re-validated against
//      finished-carousel.schema.json (defense in depth — never trusts an
//      upstream caller already validated it, matching every other module
//      in this codebase that re-checks what it specifically depends on),
//      plus two eligibility checks this schema alone can't express:
//      `overall_status === "completed"` (a partial/failed carousel has at
//      least one slide with no image_url to download) and
//      `approval.approved === true` (per the I021 objective: this service
//      exports an APPROVED Finished Carousel).
//   3. `destination`: a non-empty string.
//
// Never invents metadata: everything in the returned Production Run
// result and in the exported metadata.json (built entirely inside the
// adapter — see its own header comment) comes from a field already
// present on the Finished Carousel Object, or from this export operation's
// own identity (asset_package_id, export_timestamp, export_version) —
// exactly the same "compose, don't invent" discipline every other service
// in this codebase already follows.

import { createValidator } from "./validator.mjs";
import { assertValidExportAdapter } from "./production-asset-export-adapter.mjs";
import { InvalidFinishedCarouselForExportError, CarouselNotEligibleForExportError, InvalidExportDestinationError } from "./production-asset-export-errors.mjs";

/**
 * Exports one Finished Carousel through the given Export Adapter.
 *
 * finishedCarousel — required, a Finished Carousel Object (I007) —
 *   re-validated against finished-carousel.schema.json here.
 * destination — required, a non-empty string — interpreted by the adapter
 *   (a local directory path for the one adapter this milestone ships;
 *   opaque to this service).
 *
 * dependencies.adapter — required, the return value of
 *   createLocalProductionAssetExportAdapter() (or any future Export
 *   Adapter implementing the same shape) — checked immediately via
 *   assertValidExportAdapter().
 * dependencies.now / idGenerator — forwarded to the adapter's own
 *   exportPackage() call, for deterministic tests.
 * dependencies.validator — inject a pre-built validator (used by tests).
 * dependencies.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidExportAdapterError immediately for a malformed adapter.
 * Throws InvalidFinishedCarouselForExportError if `finishedCarousel` fails
 * schema validation. Throws CarouselNotEligibleForExportError if it's
 * schema-valid but not `overall_status: "completed"` or not
 * `approval.approved: true`. Throws InvalidExportDestinationError for a
 * missing/malformed `destination`.
 *
 * Returns { status: "completed", assetPackageId, exportPath, slideCount,
 * filesExported, alreadyExported } — `status` is always "completed" on a
 * successful return (this function never returns a partial/failed result;
 * a failure is always a thrown error instead, matching
 * production-asset-export-adapter.mjs's own contract that exportPackage()
 * only ever resolves on success).
 */
export async function executeProductionAssetExport(finishedCarousel, destination, dependencies = {}) {
  assertValidExportAdapter(dependencies.adapter);

  const validator = dependencies.validator ?? createValidator(dependencies);
  const validation = validator.validate("finishedCarousel", finishedCarousel);
  if (!validation.valid) {
    throw new InvalidFinishedCarouselForExportError(validation.errors);
  }

  if (finishedCarousel.overall_status !== "completed") {
    throw new CarouselNotEligibleForExportError(
      finishedCarousel.carousel_id,
      `overall_status is "${finishedCarousel.overall_status}", not "completed"`
    );
  }
  if (finishedCarousel.approval?.approved !== true) {
    throw new CarouselNotEligibleForExportError(finishedCarousel.carousel_id, "the carousel has not been approved");
  }

  if (typeof destination !== "string" || destination.trim() === "") {
    throw new InvalidExportDestinationError(destination);
  }

  const result = await dependencies.adapter.exportPackage(finishedCarousel, destination, {
    now: dependencies.now,
    idGenerator: dependencies.idGenerator,
  });

  return {
    status: "completed",
    assetPackageId: result.assetPackageId,
    exportPath: result.exportPath,
    slideCount: result.slideCount,
    filesExported: result.filesExported,
    alreadyExported: result.alreadyExported,
  };
}

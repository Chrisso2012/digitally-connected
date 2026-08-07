// DC-003-I034 — errors specific to the Carousel Rendering Engine's own
// orchestration (production-package-not-found / composition / render
// failures are all reused, unmodified, from I032/I007/I006's own error
// classes — see carousel-rendering-engine.mjs's own imports). Only the
// duplicate-protection policy is genuinely new to this milestone.

/**
 * Thrown when a Finished Carousel with overall_status "completed" already
 * exists for this Production Package. Mirrors DC-003-I029's own
 * DuplicateDeliveryError precedent exactly: only a genuinely SUCCESSFUL
 * prior render blocks a retry — a prior "failed" or "partial" attempt is
 * designed to be retried after correction, never silently blocked.
 */
export class DuplicateRenderError extends Error {
  constructor(productionPackageId, existingCarouselId) {
    super(
      `Production Package "${productionPackageId}" already has a successfully completed Finished Carousel (see "${existingCarouselId}") — not rendered again`
    );
    this.name = "DuplicateRenderError";
    this.productionPackageId = productionPackageId;
    this.existingCarouselId = existingCarouselId;
  }
}

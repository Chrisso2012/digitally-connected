// DC-003-I021 — structured errors for the Production Asset Export
// Adapter/Service. Mirrors finished-carousel-store-errors.mjs's own
// discipline exactly: every message here is written on the assumption it
// may be shown to an external caller (a CLI user) — none of them ever
// interpolate a raw filesystem path, a raw Node error message (which can
// itself contain a path), a stack trace, or a raw HTTP response body.
// Only already-public identifiers (carousel_id, slide_type) are ever
// named.

/**
 * A caller handed executeProductionAssetExport() something that doesn't
 * implement the Export Adapter shape: { name: string,
 * exportPackage(finishedCarousel, destination) }. Mirrors DC-003-I008's
 * InvalidLedgerStoreError / DC-003-I015's InvalidCarouselStoreAdapterError
 * exactly.
 */
export class InvalidExportAdapterError extends Error {
  constructor() {
    super("A Production Asset Export adapter must be shaped { name: string, exportPackage(finishedCarousel, destination) }");
    this.name = "InvalidExportAdapterError";
  }
}

/**
 * The Finished Carousel handed to the export service failed schema
 * validation against finished-carousel.schema.json.
 */
export class InvalidFinishedCarouselForExportError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Finished Carousel failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "InvalidFinishedCarouselForExportError";
    this.errors = errors;
  }
}

/**
 * The Finished Carousel is schema-valid but not eligible for export: either
 * `overall_status` isn't "completed" (a partial/failed carousel has at
 * least one slide with no image_url to download) or `approval.approved`
 * isn't true (per the I021 objective: this service exports an APPROVED
 * Finished Carousel — see README "Production Asset Export" for why this
 * gate exists even though it isn't literally spelled out as a schema
 * field check).
 */
export class CarouselNotEligibleForExportError extends Error {
  constructor(carouselId, reason) {
    super(`Finished Carousel "${carouselId}" is not eligible for export — ${reason}`);
    this.name = "CarouselNotEligibleForExportError";
    this.carouselId = carouselId;
  }
}

/**
 * `destination` is missing, not a string, or empty.
 */
export class InvalidExportDestinationError extends Error {
  constructor(destination) {
    super(`${JSON.stringify(destination)} is not a valid export destination — expected a non-empty string path`);
    this.name = "InvalidExportDestinationError";
  }
}

/**
 * A slide's image_url could not be downloaded — a network-level failure,
 * a non-2xx HTTP status, or an empty response body. Never includes the
 * raw response body or the full URL (the URL itself isn't secret, but
 * isn't surfaced either, since it's not needed to diagnose "slide N
 * failed" and keeps this error's shape consistent regardless of cause).
 */
export class SlideDownloadError extends Error {
  constructor(slideType, reason, cause) {
    super(`Failed to download the "${slideType}" slide image — ${reason}`, { cause });
    this.name = "SlideDownloadError";
    this.slideType = slideType;
  }
}

/**
 * A filesystem operation (create directory, atomic write, verification
 * read-back) failed while exporting. The underlying cause (which may
 * contain a raw host path) is attached as `.cause` for local debugging
 * only, never included in `.message`.
 */
export class ExportPersistenceError extends Error {
  constructor(operation, cause) {
    super(`Export ${operation} failed`, { cause });
    this.name = "ExportPersistenceError";
    this.operation = operation;
  }
}

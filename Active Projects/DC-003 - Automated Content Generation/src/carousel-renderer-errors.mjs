// DC-003-I035 — structured errors for the HTML Carousel Renderer. Mirrors
// this codebase's established error-file convention (one file per
// module family, combining domain/service errors). Every message here
// is written on the assumption it may be shown to an external caller —
// never a raw filesystem path beyond what's explicitly documented as
// safe (asset paths are project-relative, never absolute host paths).

export class InvalidCarouselRendererInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidCarouselRendererInputError";
  }
}

// DC-003-I035 — a required "provided" image asset could not be resolved
// to a real, readable file. Never substitutes another image, never
// searches beyond the one configured asset root. The only recovery path
// is supplying a genuinely readable file at the approved asset_reference.
export class CarouselAssetResolutionError extends Error {
  constructor(slideNumber, assetReference, reason) {
    super(`Slide ${slideNumber}: could not resolve approved image asset ${JSON.stringify(assetReference)} — ${reason}`);
    this.name = "CarouselAssetResolutionError";
    this.slideNumber = slideNumber;
    this.assetReference = assetReference;
    this.reason = reason;
  }
}

// DC-003-I035 — the single most important failure mode this milestone
// implements: approved copy does not physically fit its designated
// container in the real rendered DOM (real font, real font-size, real
// line-height, real container, real browser). Never truncated,
// shortened, or resized to make it fit — this error IS the "no
// automatic fix" contract, made visible and actionable.
export class CarouselCapacityValidationError extends Error {
  constructor(violations) {
    const summary = violations
      .map((v) => `  - slide ${v.slideNumber} (${v.template}) field "${v.field}": ${v.failureType} (scrollHeight=${v.scrollHeight ?? "n/a"} clientHeight=${v.clientHeight ?? "n/a"} scrollWidth=${v.scrollWidth ?? "n/a"} clientWidth=${v.clientWidth ?? "n/a"})`)
      .join("\n");
    super(`Carousel capacity validation failed for ${violations.length} field(s) — approved copy does not fit its designated container. Content is never truncated/resized automatically:\n${summary}`);
    this.name = "CarouselCapacityValidationError";
    this.violations = violations;
  }
}

// DC-003-I035 — thrown when a render run cannot produce a complete,
// valid 7-slide output set (a slide failed to render, or a rendered PNG
// has the wrong dimensions). The atomic staging directory is never
// promoted to the final output location when this is thrown.
export class CarouselRenderIncompleteError extends Error {
  constructor(reason) {
    super(`Carousel render did not complete — ${reason}. No output was promoted.`);
    this.name = "CarouselRenderIncompleteError";
    this.reason = reason;
  }
}

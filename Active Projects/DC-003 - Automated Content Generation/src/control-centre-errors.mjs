// DC-003-I024 — structured errors for the Control Centre Service. Mirrors
// production-metrics-errors.mjs's own discipline: every message is written
// on the assumption it may be shown to an external caller — no raw
// filesystem path, raw Node error message, stack trace, or credential is
// ever interpolated; only already-public identifiers are named.

/**
 * A caller handed createControlCentreService() something that doesn't
 * implement the Finished Carousel Store / Production Metrics Store shape
 * this service depends on.
 */
export class InvalidControlCentreDependenciesError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidControlCentreDependenciesError";
  }
}

/**
 * The assembled Control Centre read model failed its own schema validation
 * against control-centre.schema.json — this is always a bug in
 * control-centre-service.mjs's own assembly logic, never a caller/data
 * problem (every value it assembles is either read straight from an
 * already-validated store record or computed by this module itself).
 */
export class ControlCentreAssemblyError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Control Centre read model failed its own schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "ControlCentreAssemblyError";
    this.errors = errors;
  }
}

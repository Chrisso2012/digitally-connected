// DC-003-I027 — structured errors for the Social Publishing Manifest
// domain object. Mirrors this codebase's established discipline: every
// message here is written on the assumption it may be shown to an
// external caller — none of them ever interpolate a raw caption/
// commentary value (approved copy is not a secret, but this factory
// still never echoes it back inside an error message, since a
// composition error is about structure, not content), a filesystem path,
// or a stack trace.

/**
 * A field passed to createSocialPublishingManifest() is structurally
 * invalid (a missing/blank required string, an unrecognised destination
 * shape) — a caller bug, not a real publishing-copy problem.
 */
export class InvalidSocialPublishingManifestInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidSocialPublishingManifestInputError";
  }
}

/**
 * The assembled manifest failed schema validation against
 * social-publishing-manifest.schema.json despite passing every
 * composition check createSocialPublishingManifest() applies itself —
 * e.g. an enabled destination with no non-empty copy.
 */
export class SocialPublishingManifestValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Social Publishing Manifest failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "SocialPublishingManifestValidationError";
    this.errors = errors;
  }
}

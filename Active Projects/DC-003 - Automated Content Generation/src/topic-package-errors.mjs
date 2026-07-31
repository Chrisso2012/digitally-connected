// DC-003-I003 — structured errors for the Topic Package loader.
//
// Kept separate from src/errors.mjs: those errors describe the generic
// config/schema-registry/validator layer, these describe a distinct domain
// concern (loading and readying one Topic Package). Every failure mode is
// its own class so callers can `instanceof`-check rather than parse
// message strings, and none of them expose credentials, environment
// details, or raw Ajv internals — only plain, already-sanitized data.

export class TopicPackageNotFoundError extends Error {
  constructor(filePath) {
    super(`Topic Package file not found: ${filePath}`);
    this.name = "TopicPackageNotFoundError";
    this.filePath = filePath;
  }
}

export class TopicPackageUnreadableError extends Error {
  constructor(filePath, cause) {
    super(`Topic Package file could not be read: ${filePath} (${cause.message})`);
    this.name = "TopicPackageUnreadableError";
    this.filePath = filePath;
    this.cause = cause;
  }
}

export class TopicPackageParseError extends Error {
  constructor(filePath, cause) {
    super(`Failed to parse Topic Package JSON in ${filePath}: ${cause.message}`);
    this.name = "TopicPackageParseError";
    this.filePath = filePath;
    this.cause = cause;
  }
}

/**
 * Schema validation failure. `errors` is the same structured array
 * src/validator.mjs returns — [{ path, keyword, message, params }] — never
 * a raw Ajv error object.
 */
export class TopicPackageValidationError extends Error {
  constructor(errors, filePath = null) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(
      `Topic Package failed schema validation with ${errors.length} error(s)` +
        `${filePath ? ` (${filePath})` : ""}:\n${summary}`
    );
    this.name = "TopicPackageValidationError";
    this.filePath = filePath;
    this.errors = errors;
  }
}

/**
 * Schema-valid but not operationally ready. `issues` is
 * [{ check, message }], one entry per failed readiness rule — see
 * src/topic-package-readiness.mjs for the full rule set.
 */
export class TopicPackageReadinessError extends Error {
  constructor(issues, filePath = null) {
    const summary = issues.map((i) => `  - [${i.check}] ${i.message}`).join("\n");
    super(
      `Topic Package is not operationally ready — ${issues.length} issue(s)` +
        `${filePath ? ` (${filePath})` : ""}:\n${summary}`
    );
    this.name = "TopicPackageReadinessError";
    this.filePath = filePath;
    this.issues = issues;
  }
}

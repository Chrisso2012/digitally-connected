// DC-003 — shared error classes for the configuration/validation runtime.
// Every failure mode this layer can produce has its own class so callers
// can `instanceof`-check instead of parsing message strings.

export class ConfigFileNotFoundError extends Error {
  constructor(filePath) {
    super(`Configuration file not found: ${filePath}`);
    this.name = "ConfigFileNotFoundError";
    this.filePath = filePath;
  }
}

export class ConfigParseError extends Error {
  constructor(filePath, cause) {
    super(`Failed to parse JSON in ${filePath}: ${cause.message}`);
    this.name = "ConfigParseError";
    this.filePath = filePath;
    this.cause = cause;
  }
}

export class UnknownSchemaError extends Error {
  constructor(schemaId, knownIds) {
    super(`Unknown schema identifier "${schemaId}". Registered identifiers: ${knownIds.join(", ")}`);
    this.name = "UnknownSchemaError";
    this.schemaId = schemaId;
    this.knownIds = knownIds;
  }
}

export class ConfigIntegrityError extends Error {
  constructor(issues) {
    super(
      `Configuration integrity check failed with ${issues.length} issue(s):\n` +
        issues.map((i) => `  - [${i.check}] ${i.message}`).join("\n")
    );
    this.name = "ConfigIntegrityError";
    this.issues = issues;
  }
}

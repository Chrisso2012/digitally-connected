// DC-003 — public entry point for the configuration/validation runtime.
// Later components (topic loading, LLM generation, payload mapping,
// rendering, execution logging) should import from here rather than
// reaching into individual src/ files directly.

export { loadConfig, loadTemplatesConfig, loadConstants, loadVersions } from "./config-loader.mjs";
export { loadSchemaRegistry, SCHEMA_IDS } from "./schema-registry.mjs";
export { createValidator } from "./validator.mjs";
export { runIntegrityChecks } from "./integrity-checks.mjs";
export {
  ConfigFileNotFoundError,
  ConfigParseError,
  UnknownSchemaError,
  ConfigIntegrityError,
} from "./errors.mjs";

// DC-003-I003 — Topic Package Loader
export { loadTopicPackage, prepareTopicPackage } from "./topic-package-loader.mjs";
export { checkTopicPackageReadiness } from "./topic-package-readiness.mjs";
export {
  TopicPackageNotFoundError,
  TopicPackageUnreadableError,
  TopicPackageParseError,
  TopicPackageValidationError,
  TopicPackageReadinessError,
} from "./topic-package-errors.mjs";

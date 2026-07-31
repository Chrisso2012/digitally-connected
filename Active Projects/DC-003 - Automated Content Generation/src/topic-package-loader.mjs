// DC-003-I003 — Topic Package Loader.
//
// prepareTopicPackage() is the central implementation: schema validation via
// the I002 validator runtime (src/validator.mjs — never re-implemented
// here), then operational readiness checks (topic-package-readiness.mjs),
// then a deep-cloned, deep-frozen return object. loadTopicPackage() is a
// thin file-reading adapter around it, so file-specific error handling
// never leaks into the object-processing path.
//
// Synchronous, matching config-loader.mjs and schema-registry.mjs — safe to
// `await` from a caller that prefers async style, since awaiting a
// non-Promise value simply resolves immediately.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createValidator } from "./validator.mjs";
import { loadVersions } from "./config-loader.mjs";
import { checkTopicPackageReadiness } from "./topic-package-readiness.mjs";
import {
  TopicPackageNotFoundError,
  TopicPackageUnreadableError,
  TopicPackageParseError,
  TopicPackageValidationError,
  TopicPackageReadinessError,
} from "./topic-package-errors.mjs";

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

/**
 * Validate and apply readiness checks to an already-parsed Topic Package
 * object. This is the central implementation — object-in, object-out, no
 * file I/O — so file loading (below) and any future non-file source
 * (n8n, an API, a database row) share the exact same validation and
 * readiness logic.
 *
 * Returns a deep-cloned, deep-frozen Topic Package: the input `rawObject`
 * is read but never mutated, and the returned object is a separate copy
 * that cannot be mutated by the caller (attempts throw in strict-mode/ESM
 * code, silently no-op otherwise — see README "Immutability").
 *
 * Throws TopicPackageValidationError if `rawObject` fails schema
 * validation, or TopicPackageReadinessError if it's schema-valid but not
 * operationally ready.
 *
 * options.validator — inject a pre-built validator (from createValidator())
 *   instead of constructing a new one.
 * options.expectedSchemaVersion — override the topic_package schema
 *   version read from config/versions.json (used by tests).
 * options.rootDir — passed through to loadVersions() when
 *   expectedSchemaVersion isn't given (used by tests with isolated config).
 * options.sourceFilePath — attached to thrown errors for traceability;
 *   set automatically by loadTopicPackage(), left null for raw objects.
 */
export function prepareTopicPackage(rawObject, options = {}) {
  const validator = options.validator ?? createValidator();
  const sourceFilePath = options.sourceFilePath ?? null;

  const validation = validator.validate("topicPackage", rawObject);
  if (!validation.valid) {
    throw new TopicPackageValidationError(validation.errors, sourceFilePath);
  }

  const expectedSchemaVersion =
    options.expectedSchemaVersion ?? loadVersions(options).schema_versions?.topic_package;

  const readiness = checkTopicPackageReadiness(rawObject, { expectedSchemaVersion });
  if (!readiness.ok) {
    throw new TopicPackageReadinessError(readiness.issues, sourceFilePath);
  }

  return deepFreeze(structuredClone(rawObject));
}

/**
 * Load a Topic Package from a JSON file on disk, then run it through
 * prepareTopicPackage(). Relative paths resolve against the current working
 * directory (node:path.resolve's normal behavior) — pass an absolute path
 * when the caller must not depend on cwd.
 *
 * Throws TopicPackageNotFoundError, TopicPackageUnreadableError, or
 * TopicPackageParseError for file-level failures, before validation or
 * readiness checks ever run.
 */
export function loadTopicPackage(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);

  let stat;
  try {
    stat = statSync(resolvedPath);
  } catch (cause) {
    if (cause.code === "ENOENT") {
      throw new TopicPackageNotFoundError(resolvedPath);
    }
    throw new TopicPackageUnreadableError(resolvedPath, cause);
  }

  if (!stat.isFile()) {
    throw new TopicPackageUnreadableError(resolvedPath, new Error("path exists but is not a file"));
  }

  let raw;
  try {
    raw = readFileSync(resolvedPath, "utf-8");
  } catch (cause) {
    throw new TopicPackageUnreadableError(resolvedPath, cause);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new TopicPackageParseError(resolvedPath, cause);
  }

  return prepareTopicPackage(parsed, { ...options, sourceFilePath: resolvedPath });
}

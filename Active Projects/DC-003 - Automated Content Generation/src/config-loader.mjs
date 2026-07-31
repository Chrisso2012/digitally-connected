// DC-003 — configuration loader.
//
// Loads config/templates.json, config/constants.json, and config/versions.json.
// Deliberately never reads config/env.example: that file documents which
// environment variables a deployment needs, it is not a source of runtime
// values, and it must never be treated as one (see README "Configuration
// vs. credentials"). This module has no knowledge of credentials at all.
//
// Every loader accepts an optional { rootDir } so tests can point it at an
// isolated temporary directory instead of the real project config.

import { readJsonFileSync } from "./read-json-file.mjs";
import { resolveFromRoot } from "./paths.mjs";

export function loadTemplatesConfig(options = {}) {
  return readJsonFileSync(resolveFromRoot(options.rootDir, "config", "templates.json"));
}

export function loadConstants(options = {}) {
  return readJsonFileSync(resolveFromRoot(options.rootDir, "config", "constants.json"));
}

export function loadVersions(options = {}) {
  return readJsonFileSync(resolveFromRoot(options.rootDir, "config", "versions.json"));
}

/**
 * Loads all three config files and returns them as one structured object.
 * Fails fast (throws) on the first missing or malformed file — a partially
 * loaded config is never returned.
 */
export function loadConfig(options = {}) {
  return {
    templates: loadTemplatesConfig(options),
    constants: loadConstants(options),
    versions: loadVersions(options),
  };
}

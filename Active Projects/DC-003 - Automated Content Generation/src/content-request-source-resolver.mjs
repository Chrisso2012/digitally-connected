// DC-003-I016 — Content Request Source Resolver.
//
// Resolves a requested { sourceType, sourceReference } (e.g. "article",
// "GS01") to an existing, approved Topic Package — the platform's only
// existing representation of a content source. Composes
// loadTopicPackage() (DC-003-I003, unchanged) exactly as it already
// exists; this module invents no second article registry, no second
// identifier format.
//
// Repository-evidence finding (checked before writing this module, per
// the I016 brief's own instruction): Topic Packages have no ID-based
// lookup or registry anywhere in this codebase — DC-003-I003's
// loadTopicPackage() only ever loads by an explicit file path. The
// schema's own `backlog_reference_id` field (topic-package.schema.json,
// present since DC-003-I001, always null in every fixture until now) is
// the one field designed for exactly this purpose: linking a Topic
// Package back to an external source. This resolver scans a directory of
// Topic Package files (an explicit, injectable `topicPackagesDir` — never
// hardcoded, matching DC-003-I015's storage-directory convention) and
// matches on that field.
//
// "GS01" itself does not exist anywhere in this repository as of
// DC-003-I016 — see README "Content Request Command — current
// limitations" for the operational-dependency note this finding produced.

import { readdirSync } from "node:fs";
import path from "node:path";
import { loadTopicPackage } from "./topic-package-loader.mjs";
import { UnknownSourceReferenceError, SourceResolutionError } from "./content-request-errors.mjs";

const SUPPORTED_SOURCE_TYPES = ["article"];

/**
 * Resolves one source reference to an approved Topic Package.
 *
 * fields.sourceType — must be "article" (the only type DC-003-I016
 *   supports).
 * fields.sourceReference — matched against each candidate Topic
 *   Package's own `backlog_reference_id`.
 *
 * options.topicPackagesDir — required, a directory containing candidate
 *   Topic Package JSON files. Every file is loaded via loadTopicPackage()
 *   (I003, unchanged) — schema validation and readiness checks apply
 *   exactly as they already do; a file that fails either is skipped as a
 *   non-match, not treated as a resolver error, since a source directory
 *   legitimately mixes ready and not-ready Topic Packages.
 * options.validator — passed through to loadTopicPackage() (used by
 *   tests).
 *
 * Returns the matching Topic Package (already immutable, per
 * loadTopicPackage()'s own contract).
 *
 * Throws SourceResolutionError for an unsupported sourceType, an
 * unreadable topicPackagesDir, or more than one approved Topic Package
 * sharing the same reference (ambiguous — refuses to guess). Throws
 * UnknownSourceReferenceError when resolution worked but nothing
 * matched.
 */
export function resolveSource({ sourceType, sourceReference }, options = {}) {
  const { topicPackagesDir } = options;

  if (!SUPPORTED_SOURCE_TYPES.includes(sourceType)) {
    throw new SourceResolutionError(
      sourceType,
      sourceReference,
      `unsupported sourceType — only ${SUPPORTED_SOURCE_TYPES.map((t) => `"${t}"`).join(", ")} is supported`
    );
  }
  if (!topicPackagesDir || typeof topicPackagesDir !== "string") {
    throw new SourceResolutionError(sourceType, sourceReference, "no topicPackagesDir was configured to resolve sources against");
  }

  let filenames;
  try {
    filenames = readdirSync(topicPackagesDir).filter((name) => name.endsWith(".json"));
  } catch {
    throw new SourceResolutionError(sourceType, sourceReference, "could not read the configured source directory");
  }

  const matches = [];
  for (const filename of filenames) {
    let topicPackage;
    try {
      topicPackage = loadTopicPackage(path.join(topicPackagesDir, filename), { validator: options.validator, rootDir: options.rootDir });
    } catch {
      // Not every file in a source directory is guaranteed to be a
      // valid, ready Topic Package — fixture directories legitimately
      // mix in deliberately-invalid or draft ones for other purposes.
      // Skip; don't fail the whole resolution over an unrelated file.
      continue;
    }
    if (topicPackage.backlog_reference_id === sourceReference) {
      matches.push(topicPackage);
    }
  }

  if (matches.length === 0) {
    throw new UnknownSourceReferenceError(sourceType, sourceReference);
  }
  if (matches.length > 1) {
    throw new SourceResolutionError(
      sourceType,
      sourceReference,
      `${matches.length} approved Topic Packages share this reference — ambiguous, refusing to guess`
    );
  }

  return matches[0];
}

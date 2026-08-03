// DC-003-I018 — Content Asset Repository: one authoritative,
// repository-owned, version-controlled location where Content Assets can
// be retrieved by ID. Replaces DC-003-I016's temporary fixture-directory
// resolver — GS01 (and every future asset) now resolves through here.
//
// Deliberately simple, per the approved brief's own "repository remains
// simple" review criterion — no adapter abstraction layered on top the
// way DC-003-I008's Ledger Store or DC-003-I015's Finished Carousel
// Store have. This module reads `node:fs` directly. That two-layer
// pattern exists in this codebase specifically for storage this platform
// *writes to* at runtime and might swap backends for later; a Content
// Asset Repository is read-only from this platform's own perspective —
// assets are curated by hand (or a future ingestion pipeline, per the
// I018 brief's own closing instruction), never written by
// content-request-service.mjs or anything downstream of it. Adding a
// swappable-adapter layer for a read-only lookup with no write path in
// scope would be complexity this milestone doesn't need.
//
// One file per asset, at `<assetsDir>/<asset_id>.json` — the asset_id
// IS the filename, not a separately-tracked mapping (no second registry,
// no second identifier format, per the I018 brief's repository-evidence
// rule). `assetsDir` is always an explicit constructor argument, never
// hardcoded — the same convention every storage-directory-taking module
// in this codebase already follows (DC-003-I015's Local JSON Storage
// Adapter, DC-003-I016's original resolver).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import {
  UnknownContentAssetError,
  DuplicateContentAssetIdError,
  ContentAssetSchemaError,
  ContentAssetReadFailureError,
  InvalidContentAssetError,
} from "./content-asset-errors.mjs";

const EXTENSION = ".json";
// The one check standing between a caller-supplied asset_id and a real
// filesystem path — no `/`, `\`, `.`, or whitespace can pass this, which
// is what actually blocks path traversal (`../../etc/passwd`), not a
// denylist of "bad" substrings. Matches content-asset.schema.json's own
// asset_id pattern exactly.
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function checkAssetId(assetId) {
  if (typeof assetId !== "string" || !ASSET_ID_PATTERN.test(assetId)) {
    throw new InvalidContentAssetError(
      JSON.stringify(assetId),
      "not a valid asset identifier — expected alphanumeric characters, underscores, or hyphens only"
    );
  }
}

// Loads and validates one asset file by its filename-derived ID
// (`fileAssetId`). `expectedAssetId`, when given, additionally enforces
// that the stored content's own `asset_id` field matches it — the
// identity check get()'s single-asset lookup relies on. list() omits
// this check (passes no `expectedAssetId`) and trusts each file's own
// `asset_id` field instead: two *different* filenames can validly
// declare the *same* internal `asset_id`, which is exactly the
// repository-integrity problem duplicate detection exists to catch — a
// check that filename-vs-content consistency would make unreachable for
// get()'s own single-file lookups (a file's name and its own content
// can never disagree with each other in isolation).
function loadAsset(assetsDir, fileAssetId, validator, expectedAssetId) {
  const filePath = path.join(assetsDir, `${fileAssetId}${EXTENSION}`);

  let raw;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (cause) {
    throw new ContentAssetReadFailureError(fileAssetId, "read", cause);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Node's JSON.parse SyntaxError embeds a snippet of the offending
    // text itself — passing it through could leak truncated/corrupted
    // file content. A fixed, content-free reason is used instead.
    throw new ContentAssetReadFailureError(fileAssetId, "parse");
  }

  const validation = validator.validate("contentAsset", parsed);
  if (!validation.valid) {
    throw new ContentAssetSchemaError(fileAssetId, validation.errors);
  }

  if (expectedAssetId !== undefined && parsed.asset_id !== expectedAssetId) {
    throw new InvalidContentAssetError(fileAssetId, `stored asset_id "${parsed.asset_id}" does not match its own filename`);
  }

  const topicPackageValidation = validator.validate("topicPackage", parsed.topic_package);
  if (!topicPackageValidation.valid) {
    throw new InvalidContentAssetError(
      parsed.asset_id ?? fileAssetId,
      `embedded topic_package fails schema validation (${topicPackageValidation.errors.length} error(s))`
    );
  }

  return deepFreezeClone(parsed);
}

/**
 * Builds a Content Asset Repository over `assetsDir`.
 *
 * options.validator — inject a pre-built validator (used by tests).
 * options.rootDir — passed through when no validator is injected.
 *
 * Returns { get, list, exists }.
 */
export function createContentAssetRepository({ assetsDir } = {}, options = {}) {
  const validator = options.validator ?? createValidator(options);

  /**
   * Retrieves one Content Asset by ID, fully validated (its own envelope
   * against content-asset.schema.json, its embedded topic_package
   * against topic-package.schema.json) and immutable.
   *
   * Throws InvalidContentAssetError for a malformed asset_id. Throws
   * UnknownContentAssetError if no file exists for it. Throws
   * ContentAssetReadFailureError / ContentAssetSchemaError /
   * InvalidContentAssetError for a stored file that can't be read,
   * doesn't parse, fails schema validation, or is otherwise inconsistent
   * — never silently accepted.
   */
  function get(assetId) {
    checkAssetId(assetId);
    const filePath = path.join(assetsDir, `${assetId}${EXTENSION}`);
    if (!existsSync(filePath)) {
      throw new UnknownContentAssetError(assetId);
    }
    return loadAsset(assetsDir, assetId, validator, assetId);
  }

  /**
   * True if a file exists for `assetId`, without reading or validating
   * it.
   *
   * Throws InvalidContentAssetError for a malformed asset_id.
   */
  function exists(assetId) {
    checkAssetId(assetId);
    return existsSync(path.join(assetsDir, `${assetId}${EXTENSION}`));
  }

  /**
   * Returns every stored asset, fully validated, ordered deterministically
   * by asset_id ascending (directory-listing order is not guaranteed
   * across platforms).
   *
   * Throws DuplicateContentAssetIdError if two stored files declare the
   * same asset_id — a repository integrity problem this function detects
   * but never silently resolves. Throws ContentAssetReadFailureError if
   * `assetsDir` itself can't be read (returns [] if it simply doesn't
   * exist yet — an empty repository, not an error).
   */
  function list() {
    let filenames;
    try {
      filenames = existsSync(assetsDir) ? readdirSync(assetsDir).filter((name) => name.endsWith(EXTENSION)) : [];
    } catch (cause) {
      throw new ContentAssetReadFailureError("(list)", "list", cause);
    }

    const seen = new Set();
    const assets = filenames.map((filename) => {
      const fileAssetId = filename.slice(0, -EXTENSION.length);
      const asset = loadAsset(assetsDir, fileAssetId, validator);
      if (seen.has(asset.asset_id)) {
        throw new DuplicateContentAssetIdError(asset.asset_id);
      }
      seen.add(asset.asset_id);
      return asset;
    });

    assets.sort((a, b) => (a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0));
    return deepFreezeClone(assets);
  }

  return { get, list, exists };
}

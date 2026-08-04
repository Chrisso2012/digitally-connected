// DC-003-I022 — Production Asset Publisher Service: validates inputs,
// then delegates the actual work to an injected Publisher Adapter — the
// same "domain layer validates, adapter only moves bytes" division this
// codebase already uses for the Finished Carousel Store (I015), the
// Renderer (I006), and the Production Asset Export Service (I021). This
// module implements no Google-specific, HTTP, or filesystem-write logic
// of its own; see google-drive-publisher-adapter.mjs for that.
//
// I022 does not generate assets and does not call I021 to produce one —
// it only ever publishes an already-completed export package a prior
// `npm run export:assets` run already wrote to disk. I021 itself
// (production-asset-export-service.mjs, local-production-asset-export-adapter.mjs)
// is not imported here and is not modified by this milestone.
//
// Validation performed here, before any adapter call:
//   1. The adapter shape (assertValidPublisherAdapter, provider-independent
//      — this service has no idea whether it's publishing to Google
//      Drive, Dropbox, or anything else).
//   2. The asset package itself: `assetPackagePath` must exist and its own
//      metadata.json must exist, parse as JSON, and contain a
//      `carousel_id` — exactly the same "a completed export is identified
//      by a present, parseable metadata.json" rule
//      local-production-asset-export-adapter.mjs (I021) already
//      established for writing one; this service reuses that same
//      identification rule for reading one back, rather than inventing a
//      second concept of "package completeness."

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { assertValidPublisherAdapter } from "./production-asset-publisher-adapter.mjs";
import { InvalidAssetPackageError } from "./production-asset-publisher-errors.mjs";

const METADATA_FILENAME = "metadata.json";

/**
 * Publishes one already-completed I021 export package through the given
 * Publisher Adapter.
 *
 * assetPackagePath — required, a local directory produced by
 *   `npm run export:assets` (I021) — containing metadata.json and the
 *   package's PNG files.
 *
 * dependencies.adapter — required, the return value of
 *   createGoogleDrivePublisherAdapter() (or any future Publisher Adapter
 *   implementing the same shape) — checked immediately via
 *   assertValidPublisherAdapter().
 * dependencies.replace — forwarded to the adapter's own publishPackage()
 *   call unchanged (see production-asset-publisher-adapter.mjs's own
 *   header comment for what it controls).
 * dependencies.maxAttempts — forwarded to the adapter's own
 *   publishPackage() call unchanged.
 *
 * Throws InvalidPublisherAdapterError immediately for a malformed
 * adapter. Throws InvalidAssetPackageError if `assetPackagePath` doesn't
 * exist, or its metadata.json is missing, unparseable, or has no
 * `carousel_id`.
 *
 * Returns { status: "completed", publisher, packageId, folderId,
 * folderUrl, filesUploaded } — exactly the adapter's own result, passed
 * through; this service adds no fields of its own (unlike I020/I021's
 * services, which observe extra fields their own adapters don't return —
 * the Publisher Adapter interface already returns everything I022's own
 * result needs).
 */
export async function executeProductionAssetPublish(assetPackagePath, dependencies = {}) {
  assertValidPublisherAdapter(dependencies.adapter);

  if (typeof assetPackagePath !== "string" || assetPackagePath.trim() === "" || !existsSync(assetPackagePath)) {
    throw new InvalidAssetPackageError(assetPackagePath, "the directory does not exist");
  }

  const metadataPath = path.join(assetPackagePath, METADATA_FILENAME);
  if (!existsSync(metadataPath)) {
    throw new InvalidAssetPackageError(assetPackagePath, "metadata.json is missing — this is not a completed I021 export");
  }

  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
  } catch {
    throw new InvalidAssetPackageError(assetPackagePath, "metadata.json is not valid JSON");
  }

  if (typeof metadata.carousel_id !== "string" || metadata.carousel_id.trim() === "") {
    throw new InvalidAssetPackageError(assetPackagePath, "metadata.json has no carousel_id");
  }

  const result = await dependencies.adapter.publishPackage(assetPackagePath, {
    replace: dependencies.replace === true,
    maxAttempts: dependencies.maxAttempts,
  });

  return {
    status: result.status,
    publisher: result.publisher,
    packageId: result.packageId,
    folderId: result.folderId,
    folderUrl: result.folderUrl,
    filesUploaded: result.filesUploaded,
  };
}

// DC-003-I022 — Production Asset Publisher Adapter abstraction.
//
// The domain layer (production-asset-publisher-service.mjs) must know
// nothing about Google Drive, OAuth2, or any other publishing mechanism —
// only this shape. A Publisher Adapter is any object shaped:
//
//   { name: string,
//     publishPackage(assetPackagePath, options): Promise<{
//       status: "completed",
//       publisher: string,
//       packageId: string,
//       folderId: string,
//       folderUrl: string,
//       filesUploaded: number,
//     }> }
//
// This mirrors the same "dumb, swappable implementation behind one
// documented shape, no implicit default, no base class" pattern this
// codebase has already established four times — the Finished Carousel
// Store's Storage Adapter (I015), the Renderer's Transport (I006), the LLM
// Provider's Transport (I019), and the Production Asset Export Adapter
// (I021). A future publishing target (Dropbox, OneDrive, S3 — explicitly
// out of scope for I022 itself) plugs in by implementing this same
// `publishPackage(assetPackagePath, options)` shape — no changes to
// production-asset-publisher-service.mjs.
//
// `assetPackagePath` is a local filesystem path to an already-completed
// I021 export directory (containing the six ordered PNGs and
// metadata.json) — never a Finished Carousel object, never a carousel_id.
// I022 does not generate assets and does not know how to find one; it only
// ever publishes what I021 already produced. `options.replace` (boolean)
// is the one caller-controlled behaviour this interface defines: whether
// an adapter should overwrite a pre-existing destination package or fail
// (see production-asset-publisher-errors.mjs's DuplicatePackageError).
//
// No Google-specific (or any provider-specific) logic belongs here — see
// google-drive-publisher-adapter.mjs for the one implementation this
// milestone ships.
//
// Validation of the asset package itself (does it exist, is metadata.json
// present and parseable) is deliberately NOT this adapter's concern —
// every real caller reaches an adapter through
// production-asset-publisher-service.mjs, which validates before ever
// calling publishPackage(), the same division of responsibility every
// other store/adapter and renderer/transport pair in this codebase
// already uses.

import { InvalidPublisherAdapterError } from "./production-asset-publisher-errors.mjs";

/**
 * Throws InvalidPublisherAdapterError if `adapter` doesn't implement the
 * Publisher Adapter shape. Used by production-asset-publisher-service.mjs
 * so a malformed adapter is caught immediately, not at the first publish
 * call.
 */
export function assertValidPublisherAdapter(adapter) {
  if (!adapter || typeof adapter.name !== "string" || typeof adapter.publishPackage !== "function") {
    throw new InvalidPublisherAdapterError();
  }
}

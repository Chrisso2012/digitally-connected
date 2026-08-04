// DC-003-I021 — Production Asset Export Adapter abstraction.
//
// The domain layer (production-asset-export-service.mjs) must know
// nothing about the filesystem, HTTP downloads, or any other delivery
// mechanism — only this shape. An Export Adapter is any object shaped:
//
//   { name: string,
//     exportPackage(finishedCarousel, destination): Promise<{
//       assetPackageId: string,
//       exportPath: string,
//       slideCount: number,
//       filesExported: number,
//       alreadyExported: boolean,
//       exportedAt: string,
//     }> }
//
// This mirrors the same "dumb, swappable implementation behind one
// documented shape, no implicit default, no base class" pattern this
// codebase has already established three times — the Finished Carousel
// Store's Storage Adapter (finished-carousel-store-adapter.mjs, I015), the
// Renderer's Transport (renderer-transport-mock.mjs/
// renderer-transport-http.mjs, I006), and the LLM Provider's Transport
// (llm-transport-mock.mjs/llm-transport-http.mjs, I019). A future delivery
// target (Google Drive, Dropbox, OneDrive, S3 — explicitly out of scope
// for I021 itself) plugs in by implementing this same
// `exportPackage(finishedCarousel, destination)` shape — no changes to
// production-asset-export-service.mjs.
//
// No filesystem implementation belongs here — see
// local-production-asset-export-adapter.mjs for the one implementation
// this milestone ships. `destination` is deliberately opaque to this
// interface: a local adapter interprets it as a directory path; a future
// cloud adapter might interpret the same parameter as a bucket/folder
// reference — the service layer never inspects or assumes its shape.
//
// Validation of the Finished Carousel itself (schema, completed status,
// approval) is deliberately NOT this adapter's concern — every real caller
// reaches an adapter through production-asset-export-service.mjs, which
// validates before ever calling exportPackage(), the same division of
// responsibility every other store/adapter and renderer/transport pair in
// this codebase already uses.

import { InvalidExportAdapterError } from "./production-asset-export-errors.mjs";

/**
 * Throws InvalidExportAdapterError if `adapter` doesn't implement the
 * Export Adapter shape. Used by production-asset-export-service.mjs so a
 * malformed adapter is caught immediately, not at the first export call.
 */
export function assertValidExportAdapter(adapter) {
  if (!adapter || typeof adapter.name !== "string" || typeof adapter.exportPackage !== "function") {
    throw new InvalidExportAdapterError();
  }
}

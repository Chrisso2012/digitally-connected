// DC-003-I027 — Social Publisher Adapter abstraction.
//
// The domain layer (social-publisher-service.mjs) must know nothing about
// Instagram, LinkedIn, or any other social platform — only this shape. A
// Social Publisher Adapter is any object shaped:
//
//   { name: string,
//     provider: string,    // e.g. "instagram" | "linkedin" — passed through
//                           // verbatim into the Publisher Result, never
//                           // re-derived by the service
//     destination: string, // a safe, non-secret identifier for the
//                           // configured account/page (e.g. an Instagram
//                           // user ID, a LinkedIn author URN) — computed
//                           // once at construction from the adapter's own
//                           // config, available SYNCHRONOUSLY before any
//                           // publish() call. The service needs this
//                           // up front to check the Publisher Result
//                           // Store for an existing successful
//                           // publication to this exact destination
//                           // BEFORE making any platform request — see
//                           // social-publisher-service.mjs's own
//                           // duplicate-publishing check.
//     publish({ manifest, finishedCarousel, assetPackagePath }): Promise<{
//       postId: string,       // platform post/media ID or URN
//       postUrl: string | null,
//       publishedAt: string,  // ISO date-time
//       itemCount: number,    // slides/images actually published
//     }> }
//
// This mirrors the same "dumb, swappable implementation behind one
// documented shape, no implicit default, no base class" pattern this
// codebase has already established five times — the Finished Carousel
// Store's Storage Adapter (I015), the Renderer's Transport (I006), the LLM
// Provider's Transport (I019), the Production Asset Export Adapter (I021),
// and the Production Asset Publisher Adapter (I022). The existing I022
// Publisher Adapter shape (`publishPackage(assetPackagePath, options)`)
// is deliberately NOT reused here — confirmed by investigation to be
// shaped specifically around "upload a local folder to Google Drive"
// (folderId/folderUrl/filesUploaded), with no place for a platform
// caption/commentary or a choice between two distinct platforms. A
// narrower, genuinely social-specific interface was required.
//
// `manifest` — the approved Social Publishing Manifest (already validated
// by the service before any adapter is ever called).
// `finishedCarousel` — the approved, completed Finished Carousel Object
// (already validated by the service) — adapters needing public image URLs
// (Instagram) read `finishedCarousel.slides[].image_url` directly.
// `assetPackagePath` — a local directory path to the completed Production
// Asset Package (I021) — adapters needing local file bytes (LinkedIn)
// read the six PNGs from here directly.
//
// No platform-specific logic belongs here — see
// instagram-carousel-publisher-adapter.mjs / instagram-mock-publisher-adapter.mjs
// and linkedin-multi-image-publisher-adapter.mjs / linkedin-mock-publisher-adapter.mjs
// for the two implementations this milestone ships.

import { InvalidSocialPublisherAdapterError } from "./social-publisher-service-errors.mjs";

/**
 * Throws InvalidSocialPublisherAdapterError if `adapter` doesn't
 * implement the Social Publisher Adapter shape. Used by
 * social-publisher-service.mjs so a malformed adapter is caught
 * immediately, not at the first publish call.
 */
export function assertValidSocialPublisherAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.provider !== "string" ||
    typeof adapter.destination !== "string" ||
    typeof adapter.publish !== "function"
  ) {
    throw new InvalidSocialPublisherAdapterError();
  }
}

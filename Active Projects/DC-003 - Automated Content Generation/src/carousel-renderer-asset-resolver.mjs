// DC-003-I035 — deterministic production-layer image asset resolver.
// carousel-content-package.schema.json deliberately stores
// `image.asset_reference` as an opaque approved string, "never
// interpreted, never dereferenced by this pipeline" — that principle is
// upheld INSIDE the CCP contract itself; this module is the one place
// downstream of CCP that resolves the reference to real bytes, exactly
// once, per this milestone's own brief ("do not change the CCP schema
// merely to solve file resolution — introduce a small deterministic
// production-layer asset resolver").
//
// Convention (V1, documented, not guessed): `asset_reference` is a POSIX
// relative path, resolved against exactly one caller-supplied
// `assetsRootDir` — never an absolute path, never a URL, never searched
// for elsewhere. A missing/unreadable file is a hard, fail-closed
// production error (CarouselAssetResolutionError) — never substituted,
// never skipped, never fetched from the network.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CarouselAssetResolutionError } from "./carousel-renderer-errors.mjs";

const MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function isAbsoluteOrEscaping(relativePath) {
  if (path.isAbsolute(relativePath)) return true;
  const normalized = path.normalize(relativePath);
  return normalized.startsWith("..") || normalized.includes(`..${path.sep}`);
}

/**
 * Resolves one CCP `image` object's `asset_reference` to a self-contained
 * base64 data URI, or returns null when no resolution is needed
 * (`mode: "none"`).
 *
 * image — the slide's own `{ mode, asset_reference, direction }` object
 *   (already validated by carousel-content-package.mjs).
 * slideNumber — used only for error messages.
 * assetsRootDir — the one directory `asset_reference` is resolved
 *   against; never guessed, always caller-supplied.
 *
 * Returns null when `image.mode === "none"`.
 *
 * Throws CarouselAssetResolutionError when `image.mode === "provided"`
 * and the reference: escapes assetsRootDir (path traversal), does not
 * exist, is not a regular file, cannot be read, or has an unsupported
 * extension. Never substitutes another image, never searches elsewhere,
 * never fetches from the network.
 */
export function resolveImageAsset(image, slideNumber, assetsRootDir) {
  if (image.mode === "none") {
    return null;
  }

  const assetReference = image.asset_reference;

  if (isAbsoluteOrEscaping(assetReference)) {
    throw new CarouselAssetResolutionError(slideNumber, assetReference, "must be a relative path within the configured assets root — absolute paths and path traversal are rejected");
  }

  const extension = path.extname(assetReference).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new CarouselAssetResolutionError(slideNumber, assetReference, `unsupported image extension "${extension}" — expected one of ${Object.keys(MIME_BY_EXTENSION).join(", ")}`);
  }

  const resolvedPath = path.join(assetsRootDir, assetReference);

  let stat;
  try {
    stat = statSync(resolvedPath);
  } catch {
    throw new CarouselAssetResolutionError(slideNumber, assetReference, "file does not exist under the configured assets root");
  }
  if (!stat.isFile()) {
    throw new CarouselAssetResolutionError(slideNumber, assetReference, "resolved path is not a regular file");
  }

  let bytes;
  try {
    bytes = readFileSync(resolvedPath);
  } catch (cause) {
    throw new CarouselAssetResolutionError(slideNumber, assetReference, `file could not be read (${cause.code ?? cause.message})`);
  }

  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

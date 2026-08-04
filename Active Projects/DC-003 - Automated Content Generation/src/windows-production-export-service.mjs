// DC-003-I026 — Windows Production Asset Export Service: delivers an
// already-approved, completed carousel's production asset package to
// BOTH the durable Docker archive (via I021, completely unmodified) and
// a second, human-facing Windows-visible delivery folder.
//
// Architectural principle, from the I026 brief: "The Docker export
// remains the authoritative system archive. The Windows export is a
// human-facing delivery copy." This module owns none of I021's own
// concerns — no image downloading, no metadata construction, no
// validation logic, no atomic-write primitive shared with it, no
// approval enforcement of its own. It only composes I021 (for the
// archive) with a small, genuinely new filesystem-copy step (for the
// Windows delivery) — see this file's own header comment on
// copyArchiveToWindowsDelivery() for why a second export-adapter
// implementation was never required (I021's own destination parameter is
// already a plain, opaque string — it already writes correctly to any
// writable directory, Docker-mounted or otherwise).
//
// Network-efficiency: I021's own `executeProductionAssetExport()` is
// idempotent by its own existing design (a second call against an
// already-complete archive makes zero network requests — see
// local-production-asset-export-adapter.mjs's own "alreadyExported" path).
// The Windows delivery step is a PLAIN FILESYSTEM COPY of that already-
// downloaded archive — never a second round of Templated CDN downloads,
// satisfying the brief's own "Network-Efficiency Rule" without inventing
// a second downloading code path.
//
// Approval enforcement: entirely delegated to I021's own
// executeProductionAssetExport() (CarouselNotEligibleForExportError for
// `overall_status !== "completed"` or `approval.approved !== true`) — a
// rejected carousel can never be approved under I014's own state
// machine, so that same check already covers `approval.rejected === true`
// too. This service adds no approval logic of its own, per the brief.

import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync, renameSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { executeProductionAssetExport } from "./production-asset-export-service.mjs";
import {
  WindowsDeliveryConflictError,
  WindowsDeliveryPartialPackageError,
  WindowsDeliveryPersistenceError,
  WindowsDeliveryVerificationError,
} from "./windows-production-export-errors.mjs";

const METADATA_FILENAME = "metadata.json";

// Same "temp file in the same directory, read-back verify, then rename"
// atomic-write strategy already established independently in
// local-json-carousel-store-adapter.mjs (I015) and
// local-production-asset-export-adapter.mjs (I021) — reimplemented here
// rather than importing either, since neither exports it publicly and
// this codebase's own convention (confirmed by those two existing,
// independent copies) is not to share this trivial primitive across
// modules.
function atomicWrite(targetPath, content, carouselId) {
  const dir = path.dirname(targetPath);
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.tmp-${randomUUID()}`);
  try {
    writeFileSync(tempPath, content);
    const writtenBack = readFileSync(tempPath);
    if (Buffer.compare(writtenBack, content) !== 0) {
      throw new Error("atomic write verification failed — temp file content did not match what was written");
    }
    renameSync(tempPath, targetPath);
  } catch (cause) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup only — the primary failure below is what
      // gets reported either way.
    }
    throw new WindowsDeliveryPersistenceError(carouselId, `write ${path.basename(targetPath)}`, cause);
  }
}

function readDestinationMetadata(destDir) {
  const metadataPath = path.join(destDir, METADATA_FILENAME);
  if (!existsSync(metadataPath)) return null;
  try {
    return JSON.parse(readFileSync(metadataPath, "utf-8"));
  } catch {
    return null; // corrupted metadata.json is never treated as "complete"
  }
}

function filesAreByteIdentical(sourcePath, destPath) {
  if (!existsSync(destPath)) return false;
  return Buffer.compare(readFileSync(sourcePath), readFileSync(destPath)) === 0;
}

function listRealFiles(dir, carouselId, operation) {
  try {
    return readdirSync(dir).filter((name) => !name.startsWith("."));
  } catch (cause) {
    throw new WindowsDeliveryPersistenceError(carouselId, operation, cause);
  }
}

/**
 * Copies an already-completed I021 archive package into a Windows-visible
 * delivery destination — a plain filesystem copy, never a re-download.
 *
 * Idempotency/replacement rules (see windows-production-export-errors.mjs
 * for the exact error semantics):
 *   - destination has a complete, byte-identical package already ->
 *     verified no-op success, zero writes.
 *   - destination has a complete but DIFFERENT package -> fails with
 *     WindowsDeliveryConflictError, unless `replace` is true.
 *   - destination has some files but no valid completed metadata.json
 *     (a partial/interrupted prior copy, or unrelated content) -> fails
 *     with WindowsDeliveryPartialPackageError, unless `replace` is true.
 *   - destination is empty or doesn't exist -> a normal fresh copy.
 *
 * Images are written first, `metadata.json` LAST as the completion
 * signal — the same discipline local-production-asset-export-adapter.mjs
 * (I021) already established for its own archive writes, so a reader can
 * never observe a half-copied package as "ready."
 */
function copyArchiveToWindowsDelivery({ archiveDir, destDir, carouselId, replace }) {
  const sourceFilenames = listRealFiles(archiveDir, carouselId, "read archive directory");

  const existingDestMetadata = readDestinationMetadata(destDir);
  if (existingDestMetadata && existingDestMetadata.carousel_id === carouselId) {
    const allIdentical = sourceFilenames.every((name) => filesAreByteIdentical(path.join(archiveDir, name), path.join(destDir, name)));
    if (allIdentical) {
      return { filesCopied: 0 };
    }
    if (!replace) {
      throw new WindowsDeliveryConflictError(carouselId);
    }
    // falls through to a full re-copy below
  } else if (existsSync(destDir) && listRealFiles(destDir, carouselId, "read destination directory").length > 0) {
    if (!replace) {
      throw new WindowsDeliveryPartialPackageError(carouselId);
    }
    // falls through to a full re-copy below
  }

  try {
    mkdirSync(destDir, { recursive: true });
  } catch (cause) {
    throw new WindowsDeliveryPersistenceError(carouselId, "create destination directory", cause);
  }

  const nonMetadataFiles = sourceFilenames.filter((name) => name !== METADATA_FILENAME);
  for (const name of nonMetadataFiles) {
    atomicWrite(path.join(destDir, name), readFileSync(path.join(archiveDir, name)), carouselId);
  }
  if (sourceFilenames.includes(METADATA_FILENAME)) {
    atomicWrite(path.join(destDir, METADATA_FILENAME), readFileSync(path.join(archiveDir, METADATA_FILENAME)), carouselId);
  }

  return { filesCopied: sourceFilenames.length };
}

// Always runs, even on the already-delivered no-op path, so
// `verifiedIdentical` is never a stale assumption carried over from a
// prior run.
function verifyIdentical(archiveDir, destDir, carouselId) {
  const filenames = listRealFiles(archiveDir, carouselId, "read archive directory for verification");
  for (const name of filenames) {
    if (!filesAreByteIdentical(path.join(archiveDir, name), path.join(destDir, name))) {
      throw new WindowsDeliveryVerificationError(carouselId, name);
    }
  }
  return true;
}

/**
 * Delivers an approved, completed carousel to both the Docker archive and
 * a Windows-visible delivery folder.
 *
 * fields.carouselId — required.
 *
 * dependencies.finishedCarouselStore — required, an I015 Finished
 *   Carousel Store instance.
 * dependencies.archiveAdapter — required, an I021 Production Asset Export
 *   Adapter (createLocalProductionAssetExportAdapter()) — passed straight
 *   through to executeProductionAssetExport() unmodified.
 * dependencies.archiveRoot — required, the container-visible Docker
 *   archive root.
 * dependencies.windowsDeliveryRoot — required, the container-visible
 *   Windows bind-mount root.
 * dependencies.replace — boolean, default false.
 *
 * Propagates whatever error finishedCarouselStore.get(carouselId) or
 * executeProductionAssetExport() themselves throw (including
 * CarouselNotEligibleForExportError for an unapproved/incomplete
 * carousel) — this service invents no new eligibility concept of its own.
 *
 * Returns { status: "completed", carouselId, assetPackageId,
 * archive: { status, reference }, windowsDelivery: { status, reference,
 * filesCopied }, verifiedIdentical }. `reference` fields are
 * container-visible paths, never a raw Windows host path (this service
 * has no knowledge of one) and never included in any thrown error.
 */
export async function executeWindowsProductionExport(fields = {}, dependencies = {}) {
  const { carouselId } = fields;
  const { finishedCarouselStore, archiveAdapter, archiveRoot, windowsDeliveryRoot, replace = false } = dependencies;

  const finishedCarousel = finishedCarouselStore.get(carouselId);

  const archiveResult = await executeProductionAssetExport(finishedCarousel, archiveRoot, { adapter: archiveAdapter });

  const destDir = path.join(windowsDeliveryRoot, finishedCarousel.carousel_id);
  const copyResult = copyArchiveToWindowsDelivery({
    archiveDir: archiveResult.exportPath,
    destDir,
    carouselId: finishedCarousel.carousel_id,
    replace,
  });

  const verifiedIdentical = verifyIdentical(archiveResult.exportPath, destDir, finishedCarousel.carousel_id);

  return {
    status: "completed",
    carouselId: finishedCarousel.carousel_id,
    assetPackageId: archiveResult.assetPackageId,
    archive: { status: "completed", reference: archiveResult.exportPath },
    windowsDelivery: { status: "completed", reference: destDir, filesCopied: copyResult.filesCopied },
    verifiedIdentical,
  };
}

// DC-003-I021 — Local Filesystem Export Adapter: the one
// production-asset-export-adapter.mjs implementation this milestone
// ships. Downloads every rendered slide image from the Finished
// Carousel's own `image_url` fields and writes a local, publishable asset
// package — six PNGs plus one metadata.json. No cloud upload; local
// filesystem only, per the I021 objective.
//
// Repository investigation findings this design is built on (see README
// "Production Asset Export (DC-003-I021)" for the full account):
//   - Rendered slide URLs live at finished-carousel.schema.json's own
//     `slides[].image_url` — already public, no auth needed to fetch them
//     (Templated's CDN, e.g. https://cdn.templated.media/render/<id>.png).
//   - Execution metadata lives at `execution_metadata` (execution_id,
//     rendered_at, provider, render_duration_ms) and `metadata`
//     (total_slides, completed_slides, failed_slides, total_duration_ms) —
//     both already on the Finished Carousel Object, nothing new needed.
//   - No exported assets, file-export abstraction, or remote-asset
//     download code existed anywhere in this repository before I021 —
//     confirmed by a repository-wide search, not assumed.
//   - The Finished Carousel Object has NO `llm_model` field (that lived on
//     the separate, unpersisted Carousel Content Object) and NO
//     `source_asset_id`/"GS01"-style field (only `topic_id`) — metadata.json
//     below reflects exactly what's actually on the object, per "do not
//     invent metadata": `llm_model` is omitted entirely (not even null —
//     there is nothing to look up), and `topic_id` is used in place of a
//     literal Content Asset ID, which this object simply does not carry.
//
// Atomic writes mirror local-json-carousel-store-adapter.mjs's own pattern
// exactly (I015): write to a temp file in the same directory, read it back
// to verify the write round-tripped intact, then rename into place — a
// same-directory rename is atomic on both POSIX and NTFS, so a reader can
// never observe a partially-written file at a real target path, and a
// failed write never touches (let alone corrupts) whatever was there
// before.
//
// Idempotency: an export directory is considered COMPLETE only once its
// own metadata.json exists and names this exact carousel_id — written
// LAST, only after every slide image has been downloaded and atomically
// written. A re-run against an already-complete export makes zero network
// requests and returns the persisted result (including the original
// asset_package_id and export_timestamp, unchanged) — "the export
// survives process restart" in both directions: a restart BEFORE
// completion just safely re-attempts from scratch (individual files are
// still atomic, never corrupted, just re-overwritten); a restart AFTER
// completion is a no-op.
//
// Stops immediately on the first slide download failure — matches the
// stop-on-first-failure discipline every other stage in this codebase
// already follows (I006's renderer, I020's live render stage) — never
// downloads slides out of order, and any slides already written from a
// prior, incomplete attempt are simply left as-is (harmless, since
// metadata.json was never written, so the directory is still correctly
// "not complete").

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ExportPersistenceError, SlideDownloadError } from "./production-asset-export-errors.mjs";

const METADATA_FILENAME = "metadata.json";
export const EXPORT_VERSION = "1.0";

function generateAssetPackageId() {
  return "pkg_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

// Writes `content` (a Buffer or a utf-8 string) to `targetPath` atomically:
// temp file in the same directory, read-back verification, then rename.
// Any failure (write, read-back, mismatch, rename) is reported as
// ExportPersistenceError — never a raw fs error with a host path in its
// own .message.
function atomicWrite(targetPath, content) {
  const dir = path.dirname(targetPath);
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.tmp-${randomUUID()}`);

  try {
    writeFileSync(tempPath, content);
    const writtenBack = readFileSync(tempPath);
    const matches = Buffer.isBuffer(content) ? Buffer.compare(writtenBack, Buffer.from(content)) === 0 : writtenBack.toString("utf-8") === content;
    if (!matches) {
      throw new Error("atomic write verification failed — temp file content did not match what was written");
    }
    renameSync(tempPath, targetPath);
  } catch (cause) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup only — the primary failure below is what gets
      // reported either way.
    }
    throw new ExportPersistenceError(`write ${path.basename(targetPath)}`, cause);
  }
}

// Downloads one slide's rendered image. Uses Node's built-in global fetch
// (Node 18+) — no new dependency, the same choice DC-003-I006/I019 already
// made for their own HTTP transports. No authentication: a Finished
// Carousel's image_url is already a public CDN link, not a credentialed
// API endpoint.
async function downloadSlideImage(slide) {
  if (typeof slide.image_url !== "string" || slide.image_url.trim() === "") {
    throw new SlideDownloadError(slide.slide_type, "no image_url present on this slide");
  }

  let response;
  try {
    response = await fetch(slide.image_url);
  } catch (cause) {
    throw new SlideDownloadError(slide.slide_type, "network request failed", cause);
  }

  if (!response.ok) {
    throw new SlideDownloadError(slide.slide_type, `download returned HTTP ${response.status}`);
  }

  let arrayBuffer;
  try {
    arrayBuffer = await response.arrayBuffer();
  } catch (cause) {
    throw new SlideDownloadError(slide.slide_type, "response body could not be read", cause);
  }

  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    throw new SlideDownloadError(slide.slide_type, "downloaded image was empty");
  }
  return buffer;
}

function buildMetadata(finishedCarousel, { assetPackageId, exportTimestamp, exportVersion }) {
  return {
    asset_package_id: assetPackageId,
    carousel_id: finishedCarousel.carousel_id,
    carousel_content_id: finishedCarousel.carousel_content_id,
    execution_id: finishedCarousel.execution_metadata.execution_id,
    topic_id: finishedCarousel.topic_id,
    export_timestamp: exportTimestamp,
    renderer_provider: finishedCarousel.execution_metadata.provider,
    render_duration_ms: finishedCarousel.execution_metadata.render_duration_ms,
    total_duration_ms: finishedCarousel.metadata.total_duration_ms,
    slide_count: finishedCarousel.metadata.total_slides,
    export_version: exportVersion,
  };
}

/**
 * Builds the Local Filesystem Export Adapter.
 *
 * options.exportVersion — override the stamped `export_version` (used by
 *   tests); defaults to EXPORT_VERSION.
 *
 * Returns { name, exportPackage }.
 */
export function createLocalProductionAssetExportAdapter(options = {}) {
  const exportVersion = options.exportVersion ?? EXPORT_VERSION;

  return {
    name: "local-production-asset-export-adapter",

    /**
     * Exports one already-validated Finished Carousel to
     * `<destination>/<carousel_id>/` — six ordered PNGs plus
     * metadata.json. Validation of the Finished Carousel itself
     * (schema/status/approval) is the service's job, not this adapter's —
     * see production-asset-export-adapter.mjs's own header comment.
     *
     * runOptions.now — override the clock (used by tests).
     * runOptions.idGenerator — override asset_package_id generation (used
     *   by tests).
     *
     * Returns { assetPackageId, exportPath, slideCount, filesExported,
     * alreadyExported, exportedAt }.
     */
    async exportPackage(finishedCarousel, destination, runOptions = {}) {
      const now = runOptions.now ?? (() => new Date().toISOString());
      const idGenerator = runOptions.idGenerator ?? generateAssetPackageId;

      const exportDir = path.join(destination, finishedCarousel.carousel_id);
      const metadataPath = path.join(exportDir, METADATA_FILENAME);

      if (existsSync(metadataPath)) {
        let existing;
        try {
          existing = JSON.parse(readFileSync(metadataPath, "utf-8"));
        } catch (cause) {
          throw new ExportPersistenceError("read existing metadata.json", cause);
        }
        if (existing.carousel_id === finishedCarousel.carousel_id) {
          return {
            assetPackageId: existing.asset_package_id,
            exportPath: exportDir,
            slideCount: existing.slide_count,
            filesExported: existing.slide_count + 1,
            alreadyExported: true,
            exportedAt: existing.export_timestamp,
          };
        }
        // metadata.json exists but names a different carousel_id — should
        // never happen, since exportDir is itself keyed by carousel_id,
        // but defensively falls through to a fresh export rather than
        // trusting a mismatched record.
      }

      try {
        mkdirSync(exportDir, { recursive: true });
      } catch (cause) {
        throw new ExportPersistenceError("create destination directory", cause);
      }

      // Sorted defensively by slide_number, never trusting array order
      // blindly — the same "don't assume an upstream stage already
      // guaranteed this" discipline carousel-payload-mapper.mjs's own
      // header comment already establishes for this codebase.
      const orderedSlides = [...finishedCarousel.slides].sort((a, b) => a.slide_number - b.slide_number);

      for (const slide of orderedSlides) {
        const bytes = await downloadSlideImage(slide);
        const filename = `${String(slide.slide_number).padStart(2, "0")}-${slide.slide_type}.${slide.format}`;
        atomicWrite(path.join(exportDir, filename), bytes);
      }

      const assetPackageId = idGenerator();
      const exportTimestamp = now();
      const metadata = buildMetadata(finishedCarousel, { assetPackageId, exportTimestamp, exportVersion });
      atomicWrite(metadataPath, JSON.stringify(metadata, null, 2));

      return {
        assetPackageId,
        exportPath: exportDir,
        slideCount: orderedSlides.length,
        filesExported: orderedSlides.length + 1,
        alreadyExported: false,
        exportedAt: exportTimestamp,
      };
    },
  };
}

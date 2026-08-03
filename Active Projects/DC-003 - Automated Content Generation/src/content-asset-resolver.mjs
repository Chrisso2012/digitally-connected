// DC-003-I018 — Content Asset Resolver: bridges the Content Asset
// Repository to the exact resolution contract DC-003-I016's Content
// Request Service already depends on — given { sourceType,
// sourceReference }, return a validated Topic Package.
//
// Internally, "GS01" (and every future source) now resolves through the
// Content Asset Repository (a direct asset_id lookup) instead of
// DC-003-I016's original fixture-directory scan by
// backlog_reference_id — replaced, not duplicated; see
// content-asset-repository.mjs for the repository itself.
//
// DC-003-I016's own UnknownSourceReferenceError/SourceResolutionError
// contract is preserved unchanged — every Content Asset Repository error
// is mapped onto one of those two, so content-request-service.mjs (and
// everything downstream, including DC-003-I017's n8n workflow, which
// only ever sees the Content Request Result's already-safe `error`
// field) needed zero changes to their own error handling.

import { createContentAssetRepository } from "./content-asset-repository.mjs";
import { UnknownContentAssetError } from "./content-asset-errors.mjs";
import { UnknownSourceReferenceError, SourceResolutionError } from "./content-request-errors.mjs";

const SUPPORTED_SOURCE_TYPES = ["article"];

/**
 * Resolves one source reference to an approved Topic Package, via the
 * Content Asset Repository.
 *
 * fields.sourceType — must be "article" (the only type DC-003-I016
 *   supports; unchanged by this milestone).
 * fields.sourceReference — used directly as the Content Asset's
 *   asset_id (e.g. "GS01") — a 1:1 mapping, not a field-match scan.
 *
 * options.contentAssetsDir — required, a directory of Content Asset JSON
 *   files (see content-asset-repository.mjs). Never hardcoded here.
 * options.validator — passed through to the repository (used by tests).
 *
 * Returns the resolved asset's embedded topic_package — already
 * immutable and schema-valid, per the repository's own contract, so
 * mapContentRequestToProductionWorkflowInput() (unchanged) needs no
 * changes at all.
 *
 * Throws SourceResolutionError for an unsupported sourceType, a
 * misconfigured/unreadable contentAssetsDir, or any Content Asset
 * Repository failure other than "not found". Throws
 * UnknownSourceReferenceError when the repository worked but had no
 * asset for this reference.
 */
export function resolveContentAsset({ sourceType, sourceReference }, options = {}) {
  const { contentAssetsDir } = options;

  if (!SUPPORTED_SOURCE_TYPES.includes(sourceType)) {
    throw new SourceResolutionError(
      sourceType,
      sourceReference,
      `unsupported sourceType — only ${SUPPORTED_SOURCE_TYPES.map((t) => `"${t}"`).join(", ")} is supported`
    );
  }
  if (!contentAssetsDir || typeof contentAssetsDir !== "string") {
    throw new SourceResolutionError(sourceType, sourceReference, "no contentAssetsDir was configured to resolve sources against");
  }

  const repository = createContentAssetRepository({ assetsDir: contentAssetsDir }, { validator: options.validator, rootDir: options.rootDir });

  let asset;
  try {
    asset = repository.get(sourceReference);
  } catch (cause) {
    if (cause instanceof UnknownContentAssetError) {
      throw new UnknownSourceReferenceError(sourceType, sourceReference);
    }
    throw new SourceResolutionError(sourceType, sourceReference, "the Content Asset Repository failed to resolve this reference");
  }

  return asset.topic_package;
}

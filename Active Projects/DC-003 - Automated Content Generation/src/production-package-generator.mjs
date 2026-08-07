// DC-003-I033 — Production Package Generator: the canonical gateway
// from marketing content into renderer-ready production data. Composes
// existing capability only, mirroring generateSocialMediaPackage()'s
// own orchestration shape, adapted for a pure, deterministic
// transformation with NO AI/LLM step at all:
//
//   Social Media Package (I032, loaded by ID)
//         -> Renderer Adapter's buildSlideSequence()
//         -> Renderer Adapter's mapToRendererPayload()   (validates the mapping actually works)
//         -> Production Package (immutable)
//         -> Production Package Store
//
// Depends on ONLY the Social Media Package object handed to it by ID —
// never reads Editorial Package, Ingested Content, Google Docs, any
// Content Source, or a raw article, and never performs editorial
// analysis or generates/rewrites marketing copy of its own. Confirmed
// by inspection: this file imports nothing from editorial-package*.mjs,
// ingested-content*.mjs, content-source*.mjs, or google-docs*.mjs.
//
// Two failure tiers, matching every other DC-003 service:
//   1. Misconfiguration (missing/malformed stores or adapter) throws
//      PipelineConfigurationError immediately.
//   2. A genuine generation failure (Social Media Package missing,
//      duplicate, a required renderer mapping missing, an invalid
//      template mapping) throws its own specific, typed error — no
//      retry loop, since this is a pure deterministic transform, not an
//      AI call subject to transient failure.

import { createProductionPackage } from "./production-package.mjs";
import { assertValidRendererAdapter } from "./production-package-renderer-adapter.mjs";
import { createTemplatedRendererAdapter } from "./templated-renderer-adapter.mjs";
import { loadVersions } from "./config-loader.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";
import { DuplicateProductionPackageError } from "./production-package-errors.mjs";

/**
 * Generates one Production Package from one Social Media Package record.
 *
 * socialMediaPackageId — required, the sm_... identifier to load and
 *   transform.
 *
 * dependencies.socialMediaPackageStore — required, a Social Media
 *   Package Store (DC-003-I032's own createSocialMediaPackageStore()) —
 *   the only source of marketing content this service ever reads.
 * dependencies.productionPackageStore — required, a Production Package
 *   Store (createProductionPackageStore()).
 * dependencies.rendererAdapter — optional, a Renderer Adapter; defaults
 *   to the Templated Adapter (the only one implemented this milestone).
 * dependencies.platform — optional, caller-supplied string or null
 *   (default null) — see production-package.schema.json's own
 *   `platform` field description for why this is never fabricated.
 * dependencies.schemaVersion — override the production_package schema
 *   version read from config/versions.json (used by tests).
 * dependencies.rootDir — passed through when reading config/versions.json
 *   or config/templates.json.
 * dependencies.now / idGenerator / validator — passed through to
 *   createProductionPackage() for deterministic tests.
 *
 * Throws PipelineConfigurationError if dependencies itself is malformed.
 * Throws SocialMediaPackageNotFoundError (DC-003-I032's own error class,
 * reused unmodified) if socialMediaPackageId doesn't exist. Throws
 * DuplicateProductionPackageError if a Production Package already exists
 * for this Social Media Package. Propagates RequiredRendererMappingMissingError
 * / InvalidTemplateMappingError verbatim if the chosen Renderer Adapter
 * cannot map this Social Media Package's content.
 */
export async function generateProductionPackage(socialMediaPackageId, dependencies = {}) {
  if (!dependencies.socialMediaPackageStore || typeof dependencies.socialMediaPackageStore.get !== "function") {
    throw new PipelineConfigurationError("generateProductionPackage requires dependencies.socialMediaPackageStore (a Social Media Package Store)");
  }
  if (
    !dependencies.productionPackageStore ||
    typeof dependencies.productionPackageStore.save !== "function" ||
    typeof dependencies.productionPackageStore.findBySocialMediaPackageId !== "function"
  ) {
    throw new PipelineConfigurationError("generateProductionPackage requires dependencies.productionPackageStore (a Production Package Store)");
  }

  const rendererAdapter = dependencies.rendererAdapter ?? createTemplatedRendererAdapter();
  assertValidRendererAdapter(rendererAdapter);

  const schemaVersion = dependencies.schemaVersion ?? loadVersions(dependencies).schema_versions?.production_package;
  const designId = dependencies.designId ?? loadVersions(dependencies).design_system_version;
  const platform = dependencies.platform ?? null;

  // Social Media Package missing: get() itself throws
  // SocialMediaPackageNotFoundError (unknown ID) or a corruption error —
  // both DC-003-I032's own error classes, propagated as-is.
  const socialMediaPackage = dependencies.socialMediaPackageStore.get(socialMediaPackageId);

  // Duplicate Production Package already exists.
  const existing = dependencies.productionPackageStore.findBySocialMediaPackageId(socialMediaPackageId);
  if (existing.length > 0) {
    throw new DuplicateProductionPackageError(socialMediaPackageId, existing[0].production_package_id);
  }

  // Builds the renderer-agnostic slide sequence — throws
  // RequiredRendererMappingMissingError if it genuinely cannot (defense
  // in depth; social-media-package.schema.json already guarantees the
  // shape this needs).
  const { slideSequence, templateId, renderingMetadata } = rendererAdapter.buildSlideSequence(socialMediaPackage);

  // Candidate assembled here (not yet persisted) so mapToRendererPayload()
  // can validate the mapping actually works against the real,
  // snake_case slide shape before anything is saved — this IS this
  // milestone's own concrete implementation of "reject creation when
  // required renderer mappings are missing / template mapping is
  // invalid."
  const candidateSlideSequence = slideSequence.map((slide) => ({
    slide_number: slide.slideNumber,
    headline_mapping: slide.headlineMapping,
    body_copy_mapping: slide.bodyCopyMapping,
    cta_mapping: slide.ctaMapping,
    image_guidance_mapping: slide.imageGuidanceMapping,
  }));
  rendererAdapter.mapToRendererPayload({ slide_sequence: candidateSlideSequence }, dependencies);

  const productionPackage = createProductionPackage(
    {
      socialMediaPackageId,
      renderer: rendererAdapter.renderer,
      platform,
      designId,
      templateId,
      slideSequence,
      renderingMetadata,
      validationMetadata: {
        socialMediaPackageChecksum: socialMediaPackage.checksum,
        allSlidesPopulated: true,
        rendererMappingValidated: true,
      },
      schemaVersion,
    },
    { now: dependencies.now, idGenerator: dependencies.idGenerator, validator: dependencies.validator }
  );

  return dependencies.productionPackageStore.save(productionPackage);
}

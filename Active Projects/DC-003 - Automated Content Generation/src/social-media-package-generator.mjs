// DC-003-I032 — Social Media Package Generator: the canonical gateway
// from editorial intelligence into marketing content. Composes existing
// capability only, mirroring generateEditorialPackage()'s own
// orchestration shape exactly (itself mirroring
// generateCarouselFromTopicPackage()'s):
//
//   Editorial Package (I031, loaded by ID)
//         -> Social Media Package Prompt Builder
//         -> Social Media Provider (mock, or Anthropic)
//         -> Social Media Result validation
//         -> (retry on failure)
//         -> Social Media Package (immutable)
//         -> Social Media Package Store
//
// Depends on ONLY the Editorial Package object handed to it by ID — never
// reads Ingested Content, Google Docs, any Content Source, or a raw
// article, and never performs editorial analysis of its own. Confirmed
// by inspection: this file imports nothing from ingested-content*.mjs,
// content-source*.mjs, or google-docs*.mjs.
//
// Two failure tiers, matching every other DC-003 service:
//   1. Misconfiguration (missing/malformed provider or stores) throws
//      PipelineConfigurationError immediately.
//   2. A genuine generation failure (Editorial Package missing,
//      duplicate, required platform content could not be generated)
//      throws its own specific, typed error.

import { createSocialMediaPackage } from "./social-media-package.mjs";
import { buildSocialMediaPackagePrompt, PROMPT_VERSION } from "./social-media-package-prompt-builder.mjs";
import { createSocialMediaMockProvider } from "./social-media-mock-provider.mjs";
import { assertValidSocialMediaProvider, assertValidSocialMediaResult, describeResultFieldShape, getResultFieldByPath } from "./social-media-provider.mjs";
import { MalformedSocialMediaResultError } from "./social-media-analysis-errors.mjs";
import { withRetry } from "./retry.mjs";
import { loadVersions } from "./config-loader.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";
import { DuplicateSocialMediaPackageError, SocialMediaPackageGenerationFailedError } from "./social-media-package-errors.mjs";

/**
 * Generates one Social Media Package from one Editorial Package record.
 *
 * editorialPackageId — required, the ep_... identifier to load and
 *   transform.
 *
 * dependencies.editorialPackageStore — required, an Editorial Package
 *   Store (DC-003-I031's createEditorialPackageStore()) — the only
 *   source of editorial content this service ever reads.
 * dependencies.socialMediaPackageStore — required, a Social Media
 *   Package Store (createSocialMediaPackageStore()).
 * dependencies.provider — optional, a Social Media Provider; defaults to
 *   the mock provider.
 * dependencies.maxAttempts — retry ceiling, default 3.
 * dependencies.schemaVersion — override the social_media_package schema
 *   version read from config/versions.json (used by tests).
 * dependencies.rootDir — passed through when reading config/versions.json.
 * dependencies.now / idGenerator / validator — passed through to
 *   createSocialMediaPackage() for deterministic tests.
 *
 * Throws PipelineConfigurationError if dependencies itself is malformed.
 * Throws EditorialPackageNotFoundError (DC-003-I031's own error class,
 * reused unmodified) if editorialPackageId doesn't exist. Throws
 * DuplicateSocialMediaPackageError if a Social Media Package already
 * exists for this Editorial Package. Throws
 * SocialMediaPackageGenerationFailedError if every retry attempt fails.
 * Propagates a provider error immediately (bypassing retry) if it
 * carries `retryable: false`.
 */
export async function generateSocialMediaPackage(editorialPackageId, dependencies = {}) {
  if (!dependencies.editorialPackageStore || typeof dependencies.editorialPackageStore.get !== "function") {
    throw new PipelineConfigurationError("generateSocialMediaPackage requires dependencies.editorialPackageStore (an Editorial Package Store)");
  }
  if (
    !dependencies.socialMediaPackageStore ||
    typeof dependencies.socialMediaPackageStore.save !== "function" ||
    typeof dependencies.socialMediaPackageStore.findByEditorialPackageId !== "function"
  ) {
    throw new PipelineConfigurationError("generateSocialMediaPackage requires dependencies.socialMediaPackageStore (a Social Media Package Store)");
  }

  const provider = dependencies.provider ?? createSocialMediaMockProvider();
  assertValidSocialMediaProvider(provider);

  const maxAttempts = dependencies.maxAttempts ?? 3;
  const schemaVersion = dependencies.schemaVersion ?? loadVersions(dependencies).schema_versions?.social_media_package;

  // Editorial Package missing: get() itself throws
  // EditorialPackageNotFoundError (unknown ID) or a corruption error —
  // both DC-003-I031's own error classes, propagated as-is.
  const editorialPackage = dependencies.editorialPackageStore.get(editorialPackageId);

  // Duplicate Social Media Package already exists.
  const existing = dependencies.socialMediaPackageStore.findByEditorialPackageId(editorialPackageId);
  if (existing.length > 0) {
    throw new DuplicateSocialMediaPackageError(editorialPackageId, existing[0].social_media_package_id);
  }

  // Built once, outside the retry loop.
  const prompt = buildSocialMediaPackagePrompt(editorialPackage);

  const outcome = await withRetry(
    async () => {
      let raw;
      try {
        raw = await provider.generateSocialMedia(prompt, { editorialPackage });
      } catch (cause) {
        if (cause?.retryable === false) {
          throw cause; // non-retryable — propagate immediately
        }
        return { ok: false, stage: "provider", message: `Provider "${provider.name}" threw: ${cause.message}` };
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (cause) {
        return { ok: false, stage: "parse", message: `Provider "${provider.name}" returned invalid JSON: ${cause.message}` };
      }

      try {
        assertValidSocialMediaResult(parsed);
      } catch (cause) {
        if (!(cause instanceof MalformedSocialMediaResultError)) throw cause;
        // DC-003-I032.3 — safe, content-free structural diagnostics only
        // (see describeResultFieldShape()'s own header comment), scoped
        // to whichever field actually failed (cause.field) — never
        // logged/printed here, and never anything but shape/type/length/
        // key-name facts. topLevelKeys additionally shows every key the
        // provider's result DID have, so a missing "carousel" key is
        // distinguishable from a present-but-wrong-typed one at a glance.
        return {
          ok: false,
          stage: "result-shape",
          message: cause.message,
          fieldDiagnostics: {
            field: cause.field,
            shape: describeResultFieldShape(getResultFieldByPath(parsed, cause.field)),
            topLevelKeys: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : null,
          },
        };
      }

      return { ok: true, result: parsed };
    },
    { maxAttempts }
  );

  if (!outcome.ok) {
    throw new SocialMediaPackageGenerationFailedError(outcome.attempts, maxAttempts);
  }

  const analysis = outcome.result.result;

  const socialMediaPackage = createSocialMediaPackage(
    {
      editorialPackageId,
      hook: analysis.hook,
      callToAction: analysis.callToAction,
      tone: analysis.tone,
      audience: analysis.audience,
      platforms: analysis.platforms,
      carousel: analysis.carousel,
      llmModel: provider.name,
      promptVersion: PROMPT_VERSION,
      schemaVersion,
    },
    { now: dependencies.now, idGenerator: dependencies.idGenerator, validator: dependencies.validator }
  );

  return dependencies.socialMediaPackageStore.save(socialMediaPackage);
}

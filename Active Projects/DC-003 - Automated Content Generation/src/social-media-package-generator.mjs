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
//
// DC-003-I032.8 — this file exports TWO generation entry points, kept
// deliberately separate (never one function branching on a flag):
//
//   generateSocialMediaPackage()  — ordinary creation. Unchanged
//     behaviour: still fails with DuplicateSocialMediaPackageError the
//     instant any Social Media Package already exists for the given
//     Editorial Package. This is what keeps ordinary duplicate
//     protection intact for every caller that hasn't opted into revision.
//
//   reviseSocialMediaPackage()    — the explicit revision/regeneration
//     operation. Requires the caller to name BOTH the Editorial Package
//     AND the exact existing Social Media Package being superseded, and
//     enforces every DC-003-I032.8 safety rule (superseded record must
//     exist, must belong to the same Editorial Package, must be the
//     CURRENT latest revision in its lineage) before ever calling the
//     provider. No bypass flag exists for any of these checks.
//
// Both share the same provider-call/parse/validate/retry machinery
// (runSocialMediaAnalysis() below) — the only difference between them is
// the duplicate-protection-vs-revision-safety-rules gate beforehand and
// the revision/supersedes fields handed to createSocialMediaPackage()
// afterward.

import { createSocialMediaPackage } from "./social-media-package.mjs";
import { buildSocialMediaPackagePrompt, PROMPT_VERSION } from "./social-media-package-prompt-builder.mjs";
import { createSocialMediaMockProvider } from "./social-media-mock-provider.mjs";
import { assertValidSocialMediaProvider, assertValidSocialMediaResult, describeResultFieldShape, getResultFieldByPath } from "./social-media-provider.mjs";
import { MalformedSocialMediaResultError } from "./social-media-analysis-errors.mjs";
import { withRetry } from "./retry.mjs";
import { loadVersions } from "./config-loader.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";
import {
  DuplicateSocialMediaPackageError,
  SocialMediaPackageGenerationFailedError,
  CrossEditorialPackageSupersessionError,
  NotLatestRevisionError,
} from "./social-media-package-errors.mjs";

function checkEditorialPackageStoreDependency(dependencies, callerName) {
  if (!dependencies.editorialPackageStore || typeof dependencies.editorialPackageStore.get !== "function") {
    throw new PipelineConfigurationError(`${callerName} requires dependencies.editorialPackageStore (an Editorial Package Store)`);
  }
}

function checkSocialMediaPackageStoreDependency(dependencies, callerName, { requireGetLineage = false } = {}) {
  const store = dependencies.socialMediaPackageStore;
  const hasBaseShape = store && typeof store.save === "function" && typeof store.findByEditorialPackageId === "function";
  const hasLineageShape = !requireGetLineage || (typeof store?.get === "function" && typeof store?.getLineage === "function");
  if (!hasBaseShape || !hasLineageShape) {
    throw new PipelineConfigurationError(`${callerName} requires dependencies.socialMediaPackageStore (a Social Media Package Store)`);
  }
}

/**
 * Shared provider-call/parse/validate/retry machinery used by both
 * generateSocialMediaPackage() and reviseSocialMediaPackage() — the only
 * difference between the two callers is what happens before this runs
 * (duplicate-protection vs. revision-safety-rule checks) and after it
 * returns (which revision/supersedes values get passed to
 * createSocialMediaPackage()). Returns the validated analysis object, or
 * throws SocialMediaPackageGenerationFailedError.
 */
async function runSocialMediaAnalysis(editorialPackage, provider, maxAttempts) {
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

  return outcome.result.result;
}

function buildSocialMediaPackageFields(editorialPackageId, analysis, provider, schemaVersion, revisionFields) {
  return {
    editorialPackageId,
    hook: analysis.hook,
    callToAction: analysis.callToAction,
    tone: analysis.tone,
    audience: analysis.audience,
    industryContext: analysis.industryContext,
    platforms: analysis.platforms,
    carousel: analysis.carousel,
    llmModel: provider.name,
    promptVersion: PROMPT_VERSION,
    schemaVersion,
    ...revisionFields,
  };
}

/**
 * Generates one Social Media Package from one Editorial Package record.
 * Ordinary creation only — unchanged since DC-003-I032: still rejects
 * outright the instant any Social Media Package already exists for this
 * Editorial Package, revision lineage or not. To produce a second/later
 * Social Media Package for an Editorial Package that already has one,
 * use reviseSocialMediaPackage() instead — this function deliberately
 * never does that itself (DC-003-I032.8's own "do not overload ordinary
 * create" architectural principle).
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
  checkEditorialPackageStoreDependency(dependencies, "generateSocialMediaPackage");
  checkSocialMediaPackageStoreDependency(dependencies, "generateSocialMediaPackage");

  const provider = dependencies.provider ?? createSocialMediaMockProvider();
  assertValidSocialMediaProvider(provider);

  const maxAttempts = dependencies.maxAttempts ?? 3;
  const schemaVersion = dependencies.schemaVersion ?? loadVersions(dependencies).schema_versions?.social_media_package;

  // Editorial Package missing: get() itself throws
  // EditorialPackageNotFoundError (unknown ID) or a corruption error —
  // both DC-003-I031's own error classes, propagated as-is.
  const editorialPackage = dependencies.editorialPackageStore.get(editorialPackageId);

  // Duplicate Social Media Package already exists — unchanged ordinary
  // duplicate protection, revision lineage or not.
  const existing = dependencies.socialMediaPackageStore.findByEditorialPackageId(editorialPackageId);
  if (existing.length > 0) {
    throw new DuplicateSocialMediaPackageError(editorialPackageId, existing[0].social_media_package_id);
  }

  const analysis = await runSocialMediaAnalysis(editorialPackage, provider, maxAttempts);

  // No revisionFields supplied — createSocialMediaPackage() defaults to
  // revision: 1, supersedes: null, exactly the pre-I032.8 shape.
  const socialMediaPackage = createSocialMediaPackage(buildSocialMediaPackageFields(editorialPackageId, analysis, provider, schemaVersion, {}), {
    now: dependencies.now,
    idGenerator: dependencies.idGenerator,
    validator: dependencies.validator,
  });

  return dependencies.socialMediaPackageStore.save(socialMediaPackage);
}

/**
 * DC-003-I032.8 — explicitly revises/regenerates a Social Media Package
 * for an Editorial Package that already has one. Never overloads
 * generateSocialMediaPackage(); this is a distinct entry point with its
 * own safety rules, none of which has a bypass flag:
 *
 *   - the superseded record (supersededSocialMediaPackageId) must exist
 *     (SocialMediaPackageNotFoundError, from the store's own get());
 *   - it must belong to the SAME editorialPackageId named here
 *     (CrossEditorialPackageSupersessionError);
 *   - it must be the CURRENT latest revision in its lineage — revising
 *     anything else would fork the chain (NotLatestRevisionError);
 *   - the lineage itself must be well-formed
 *     (MalformedSocialMediaPackageLineageError, from the store's own
 *     getLineage()/deriveLineage()).
 *
 * On success, the new record's revision is exactly
 * (superseded record's revision) + 1, and its supersedes is
 * supersededSocialMediaPackageId — the superseded record itself is never
 * mutated, deleted, or touched in any way.
 *
 * editorialPackageId — required, the ep_... identifier this revision is
 *   for (same as generateSocialMediaPackage()'s first argument).
 * supersededSocialMediaPackageId — required, the sm_... identifier of
 *   the existing Social Media Package this new revision supersedes.
 *
 * dependencies — same shape as generateSocialMediaPackage(), except
 *   dependencies.socialMediaPackageStore must additionally expose get()
 *   and getLineage() (createSocialMediaPackageStore() always does).
 *
 * Throws PipelineConfigurationError, EditorialPackageNotFoundError, and
 * SocialMediaPackageGenerationFailedError under the same conditions as
 * generateSocialMediaPackage(). Never throws
 * DuplicateSocialMediaPackageError — that check belongs only to ordinary
 * create.
 */
export async function reviseSocialMediaPackage(editorialPackageId, supersededSocialMediaPackageId, dependencies = {}) {
  checkEditorialPackageStoreDependency(dependencies, "reviseSocialMediaPackage");
  checkSocialMediaPackageStoreDependency(dependencies, "reviseSocialMediaPackage", { requireGetLineage: true });

  if (typeof supersededSocialMediaPackageId !== "string" || supersededSocialMediaPackageId.length === 0) {
    throw new PipelineConfigurationError("reviseSocialMediaPackage requires supersededSocialMediaPackageId (the sm_... identifier being revised)");
  }

  const provider = dependencies.provider ?? createSocialMediaMockProvider();
  assertValidSocialMediaProvider(provider);

  const maxAttempts = dependencies.maxAttempts ?? 3;
  const schemaVersion = dependencies.schemaVersion ?? loadVersions(dependencies).schema_versions?.social_media_package;

  const editorialPackage = dependencies.editorialPackageStore.get(editorialPackageId);

  // Safety rule: the superseded record must exist. store.get() itself
  // throws SocialMediaPackageNotFoundError/InvalidSocialMediaPackageIdentifierError
  // for a missing/malformed id — propagated as-is, no wrapping needed.
  const superseded = dependencies.socialMediaPackageStore.get(supersededSocialMediaPackageId);

  // Safety rule: must belong to the same Editorial Package named here.
  if (superseded.editorial_package_id !== editorialPackageId) {
    throw new CrossEditorialPackageSupersessionError(editorialPackageId, supersededSocialMediaPackageId, superseded.editorial_package_id);
  }

  // Safety rule: must be the CURRENT latest revision in its lineage —
  // this is also what prevents a fork (reviving an already-superseded
  // record would create a second child of the same parent).
  // getLineage() itself throws MalformedSocialMediaPackageLineageError
  // if the stored lineage isn't a single well-formed chain.
  const lineage = dependencies.socialMediaPackageStore.getLineage(editorialPackageId);
  if (!lineage.latest || lineage.latest.social_media_package_id !== supersededSocialMediaPackageId) {
    throw new NotLatestRevisionError(supersededSocialMediaPackageId, lineage.latest ? lineage.latest.social_media_package_id : null);
  }

  const nextRevision = superseded.revision + 1;

  const analysis = await runSocialMediaAnalysis(editorialPackage, provider, maxAttempts);

  const socialMediaPackage = createSocialMediaPackage(
    buildSocialMediaPackageFields(editorialPackageId, analysis, provider, schemaVersion, {
      revision: nextRevision,
      supersedes: supersededSocialMediaPackageId,
    }),
    { now: dependencies.now, idGenerator: dependencies.idGenerator, validator: dependencies.validator }
  );

  return dependencies.socialMediaPackageStore.save(socialMediaPackage);
}

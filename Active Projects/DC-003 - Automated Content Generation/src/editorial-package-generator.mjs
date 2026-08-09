// DC-003-I031 — Editorial Package Generator: the canonical gateway from
// long-form content into marketing content. Composes existing capability
// only, mirroring carousel-generator.mjs's own orchestration shape (I004,
// extended I019/I019.3):
//
//   Ingested Content (I030, loaded by ID)
//         -> Editorial Package Prompt Builder
//         -> Editorial Analysis Provider (mock, or Anthropic)
//         -> Editorial Analysis Result validation
//         -> (retry on failure)
//         -> Editorial Package (immutable)
//         -> Editorial Package Store
//
// Depends on ONLY the Ingested Content object handed to it by ID — never
// reads a source article, never calls a Content Source Adapter, never
// contains any source-specific logic. This is the explicit architectural
// boundary the Strategy Office set before this milestone's own brief was
// issued: I031 must consume Ingested Content as its only input, never
// bypass the ingestion layer I030 established.
//
// Two failure tiers, matching every other DC-003 service:
//   1. Misconfiguration (missing/malformed provider or stores) throws
//      PipelineConfigurationError immediately — a caller bug.
//   2. A genuine generation failure (Ingested Content missing, duplicate,
//      required editorial fields could not be generated) throws its own
//      specific, typed error.

import { createEditorialPackage } from "./editorial-package.mjs";
import { buildEditorialPackagePrompt, PROMPT_VERSION } from "./editorial-package-prompt-builder.mjs";
import { createEditorialAnalysisMockProvider } from "./editorial-analysis-mock-provider.mjs";
import {
  assertValidEditorialAnalysisProvider,
  assertValidEditorialAnalysisResult,
  describeKeyInsightsShape,
  normalizeEditorialAnalysisKeyInsights,
} from "./editorial-analysis-provider.mjs";
import { MalformedEditorialAnalysisResultError } from "./editorial-analysis-errors.mjs";
import { withRetry } from "./retry.mjs";
import { loadVersions } from "./config-loader.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";
import { DuplicateEditorialPackageError, EditorialPackageGenerationFailedError } from "./editorial-package-errors.mjs";

/**
 * Generates one Editorial Package from one Ingested Content record.
 *
 * ingestedContentId — required, the ic_... identifier to load and
 *   analyse.
 *
 * dependencies.ingestedContentStore — required, an Ingested Content
 *   Store (DC-003-I030's createIngestedContentStore()) — the only source
 *   of article content this service ever reads.
 * dependencies.editorialPackageStore — required, an Editorial Package
 *   Store (createEditorialPackageStore()).
 * dependencies.provider — optional, an Editorial Analysis Provider;
 *   defaults to the mock provider — mirrors generateCarouselFromTopicPackage()'s
 *   own default.
 * dependencies.maxAttempts — retry ceiling, default 3.
 * dependencies.schemaVersion — override the editorial_package schema
 *   version read from config/versions.json (used by tests).
 * dependencies.rootDir — passed through when reading config/versions.json.
 * dependencies.now / idGenerator / validator — passed through to
 *   createEditorialPackage() for deterministic tests.
 *
 * Throws PipelineConfigurationError if dependencies itself is malformed.
 * Throws IngestedContentNotFoundError (DC-003-I030's own error class,
 * reused unmodified) if ingestedContentId doesn't exist. Throws
 * DuplicateEditorialPackageError if an Editorial Package already exists
 * for this Ingested Content. Throws EditorialPackageGenerationFailedError
 * if every retry attempt fails (provider error, malformed result, or
 * schema validation failure). Propagates a provider error immediately
 * (bypassing retry) if it carries `retryable: false`, mirroring
 * generateCarouselFromTopicPackage()'s own identical reasoning.
 */
export async function generateEditorialPackage(ingestedContentId, dependencies = {}) {
  if (!dependencies.ingestedContentStore || typeof dependencies.ingestedContentStore.get !== "function") {
    throw new PipelineConfigurationError("generateEditorialPackage requires dependencies.ingestedContentStore (an Ingested Content Store)");
  }
  if (
    !dependencies.editorialPackageStore ||
    typeof dependencies.editorialPackageStore.save !== "function" ||
    typeof dependencies.editorialPackageStore.findByIngestedContentId !== "function"
  ) {
    throw new PipelineConfigurationError("generateEditorialPackage requires dependencies.editorialPackageStore (an Editorial Package Store)");
  }

  const provider = dependencies.provider ?? createEditorialAnalysisMockProvider();
  assertValidEditorialAnalysisProvider(provider);

  const maxAttempts = dependencies.maxAttempts ?? 3;
  const schemaVersion = dependencies.schemaVersion ?? loadVersions(dependencies).schema_versions?.editorial_package;

  // Ingested Content missing / content invalid: get() itself throws
  // IngestedContentNotFoundError (unknown ID) or a corruption error
  // (stored content no longer matches its own schema) — both DC-003-I030's
  // own error classes, propagated as-is, never re-wrapped.
  const ingestedContent = dependencies.ingestedContentStore.get(ingestedContentId);

  // Duplicate Editorial Package already exists.
  const existing = dependencies.editorialPackageStore.findByIngestedContentId(ingestedContentId);
  if (existing.length > 0) {
    throw new DuplicateEditorialPackageError(ingestedContentId, existing[0].editorial_package_id);
  }

  // Built once, outside the retry loop: if the Ingested Content itself
  // has no usable content, retrying with the same input would never help.
  const prompt = buildEditorialPackagePrompt(ingestedContent);

  const outcome = await withRetry(
    async () => {
      let raw;
      try {
        raw = await provider.analyzeContent(prompt, { ingestedContent });
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

      // DC-003-I031.4 — provider-boundary normalisation, keyInsights only.
      // See normalizeEditorialAnalysisKeyInsights()'s own header comment:
      // a lone non-blank string becomes a one-item array wrapping that
      // exact string; every other shape passes through untouched, so
      // validation below still rejects anything genuinely malformed.
      parsed = normalizeEditorialAnalysisKeyInsights(parsed);

      try {
        assertValidEditorialAnalysisResult(parsed);
      } catch (cause) {
        if (!(cause instanceof MalformedEditorialAnalysisResultError)) throw cause;
        // DC-003-I031.3 — safe, content-free structural diagnostics only
        // (see describeKeyInsightsShape()'s own header comment) attached
        // for whichever caller wants to inspect a "result-shape" failure
        // more closely (editorial-package.mjs's own --live path does);
        // never logged/printed here, and never anything but shape/type/
        // length/boolean facts about keyInsights specifically.
        return { ok: false, stage: "result-shape", message: cause.message, keyInsightsDiagnostics: describeKeyInsightsShape(parsed?.keyInsights) };
      }

      return { ok: true, result: parsed };
    },
    { maxAttempts }
  );

  if (!outcome.ok) {
    throw new EditorialPackageGenerationFailedError(outcome.attempts, maxAttempts);
  }

  const analysis = outcome.result.result;

  const editorialPackage = createEditorialPackage(
    {
      ingestedContentId,
      primaryHeadline: analysis.primaryHeadline,
      supportingHeadline: analysis.supportingHeadline,
      executiveSummary: analysis.executiveSummary,
      coreMessage: analysis.coreMessage,
      primaryAudience: analysis.primaryAudience,
      primaryProblem: analysis.primaryProblem,
      desiredOutcome: analysis.desiredOutcome,
      keyInsights: analysis.keyInsights,
      pullQuotes: analysis.pullQuotes,
      callToAction: analysis.callToAction,
      keywords: analysis.keywords,
      seoTitle: analysis.seoTitle,
      seoDescription: analysis.seoDescription,
      suggestedHashtags: analysis.suggestedHashtags,
      editorialThemes: analysis.editorialThemes,
      contentCategories: analysis.contentCategories,
      llmModel: provider.name,
      promptVersion: PROMPT_VERSION,
      schemaVersion,
    },
    { now: dependencies.now, idGenerator: dependencies.idGenerator, validator: dependencies.validator }
  );

  return dependencies.editorialPackageStore.save(editorialPackage);
}

// DC-003-I030 — Content Ingestion Service: the canonical entry point into
// the Digitally Connected Content Factory. Composes existing capability
// only, exactly like content-request-service.mjs (I016) does for its own
// boundary:
//
//   { sourceType, sourceReference }
//         -> Content Source Adapter        (mock, or google-docs-source-adapter.mjs)
//         -> Validation (title/body/length/metadata/fingerprint)
//         -> Duplicate check                (Ingested Content Store)
//         -> Ingested Content                (ingested-content.mjs)
//         -> Ingested Content Store          (persisted)
//
// This service owns zero rendering/generation/publishing logic — it never
// calls an LLM, never rewrites or summarises the retrieved text, and never
// touches anything downstream of ingestion. See README "Out of Scope".
//
// Two failure tiers, matching every other DC-003 service:
//   1. Misconfiguration (missing/malformed adapter or store) throws
//      PipelineConfigurationError immediately — a caller bug, not a
//      content problem.
//   2. A genuine ingestion failure (source not found/readable, article
//      too short, duplicate, schema validation) throws its own specific,
//      typed error — the CLI's job to catch and report safely, never
//      silently swallowed or downgraded to a generic failure.

import { createHash } from "node:crypto";
import { createIngestedContent } from "./ingested-content.mjs";
import { assertValidContentSourceAdapter, assertValidContentSourceFetchResult } from "./content-source-adapter.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";
import { ArticleTooShortError, DuplicateIngestionError } from "./content-ingestion-errors.mjs";

// Distinguishes a genuine long-form article from a stub/placeholder
// document — chosen as a round, clearly-documented threshold rather than
// derived from any existing DC-003 convention (none exists yet for prose
// length). Overridable per call via dependencies.minWordCount (the CLI
// exposes this as --min-words for operator control, e.g. for a shorter
// test document).
export const DEFAULT_MIN_WORD_COUNT = 200;

function fingerprintOf(body) {
  return createHash("sha256").update(body).digest("hex");
}

function normalizeBody(body) {
  // Whitespace-normalisation only, per ingested-content.schema.json's own
  // full_article_text description — CRLF -> LF and leading/trailing trim.
  // Never rewrites, summarises, or otherwise transforms the retrieved
  // text — see README "Out of Scope".
  return body.replace(/\r\n/g, "\n").trim();
}

/**
 * Ingests one source document end-to-end.
 *
 * request.sourceType — required, e.g. "google_docs".
 * request.sourceReference — required, whatever reference the adapter
 *   accepts (a bare ID or a share URL for Google Docs — the adapter
 *   normalises it; see content-source-adapter.mjs's own sourceIdentifier).
 *
 * dependencies.adapter — required, a Content Source Adapter (the mock,
 *   or google-docs-source-adapter.mjs).
 * dependencies.store — required, an Ingested Content Store (the return
 *   value of createIngestedContentStore()).
 * dependencies.minWordCount — optional, default DEFAULT_MIN_WORD_COUNT.
 * dependencies.now / idGenerator / validator — passed through to
 *   createIngestedContent() for deterministic tests.
 *
 * Throws PipelineConfigurationError if dependencies itself is malformed.
 * Throws whatever the adapter itself throws (ContentSourceNotFoundError,
 * ContentSourceAuthenticationError, ContentSourceRateLimitError,
 * ContentSourceTransportError, ContentSourceConfigurationError) for a
 * source-access failure. Throws ArticleTooShortError if the retrieved
 * body is below the minimum word count. Throws DuplicateIngestionError if
 * the same normalised source was already ingested with an unchanged
 * fingerprint. Throws IngestedContentValidationError for anything that
 * still fails schema validation (defence-in-depth; should not occur if
 * the adapter contract is honoured).
 */
export async function ingestContent(request, dependencies = {}) {
  if (!dependencies.adapter) {
    throw new PipelineConfigurationError("ingestContent requires dependencies.adapter (a Content Source Adapter)");
  }
  assertValidContentSourceAdapter(dependencies.adapter);

  if (!dependencies.store || typeof dependencies.store.save !== "function" || typeof dependencies.store.findBySourceReference !== "function") {
    throw new PipelineConfigurationError("ingestContent requires dependencies.store (an Ingested Content Store)");
  }

  if (typeof request?.sourceType !== "string" || request.sourceType.trim() === "") {
    throw new PipelineConfigurationError("ingestContent requires request.sourceType (a non-empty string)");
  }
  if (typeof request?.sourceReference !== "string" || request.sourceReference.trim() === "") {
    throw new PipelineConfigurationError("ingestContent requires request.sourceReference (a non-empty string)");
  }

  const minWordCount = dependencies.minWordCount ?? DEFAULT_MIN_WORD_COUNT;

  // Source exists / source readable: any failure here is the adapter's
  // own typed error (ContentSourceNotFoundError etc.), propagated as-is.
  const fetchResult = await dependencies.adapter.fetch({ sourceReference: request.sourceReference });
  // Title present / body present / metadata successfully collected.
  assertValidContentSourceFetchResult(fetchResult, request.sourceReference);

  const normalizedBody = normalizeBody(fetchResult.body);
  const wordCount = normalizedBody.split(/\s+/).filter(Boolean).length;
  if (wordCount < minWordCount) {
    throw new ArticleTooShortError(wordCount, minWordCount);
  }

  // Fingerprint generated.
  const sourceFingerprint = fingerprintOf(normalizedBody);

  // Duplicate check: the same stable source, unchanged since a prior
  // ingestion, is rejected — a CHANGED fingerprint is a legitimate new
  // ingestion (the source genuinely changed), not a duplicate.
  const priorIngestions = dependencies.store.findBySourceReference(fetchResult.sourceIdentifier);
  const unchangedDuplicate = priorIngestions.find((record) => record.source_fingerprint === sourceFingerprint);
  if (unchangedDuplicate) {
    throw new DuplicateIngestionError(fetchResult.sourceIdentifier, unchangedDuplicate.ingested_content_id);
  }

  // Checksum generated (internally, by createIngestedContent() — see
  // ingested-content.mjs) and schema validation (also internal) both
  // happen here; either failure throws IngestedContentValidationError /
  // InvalidIngestedContentInputError.
  const ingestedContent = createIngestedContent(
    {
      sourceType: request.sourceType,
      sourceReference: fetchResult.sourceIdentifier,
      sourceFingerprint,
      title: fetchResult.title,
      fullArticleText: normalizedBody,
      metadata: fetchResult.metadata,
    },
    { now: dependencies.now, idGenerator: dependencies.idGenerator, validator: dependencies.validator }
  );

  return dependencies.store.save(ingestedContent);
}

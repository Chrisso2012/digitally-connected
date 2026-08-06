// DC-003-I030 — structured errors specific to the Content Ingestion
// Service (content-ingestion-service.mjs). Dependency-misconfiguration
// (missing adapter/store) reuses pipeline-errors.mjs's own
// PipelineConfigurationError — the same "caller bug, not a content
// problem" reuse automated-delivery-office-service.mjs already applies to
// itself — rather than inventing a duplicate concept here.

export class ArticleTooShortError extends Error {
  constructor(wordCount, minimumWordCount) {
    super(`Article is ${wordCount} word(s), below the minimum of ${minimumWordCount} required for ingestion`);
    this.name = "ArticleTooShortError";
    this.wordCount = wordCount;
    this.minimumWordCount = minimumWordCount;
  }
}

export class DuplicateIngestionError extends Error {
  constructor(sourceReference, existingIngestedContentId) {
    super(`Source "${sourceReference}" was already ingested with no change since (see "${existingIngestedContentId}") — not ingested again`);
    this.name = "DuplicateIngestionError";
    this.sourceReference = sourceReference;
    this.existingIngestedContentId = existingIngestedContentId;
  }
}

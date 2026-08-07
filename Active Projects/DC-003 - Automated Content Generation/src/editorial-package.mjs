// DC-003-I031 — Editorial Package domain object factory. Mirrors
// ingested-content.mjs's own "assemble, then validate, then deep-freeze"
// discipline exactly — composition only, no filesystem APIs, no HTTP, no
// AI provider call (that happens one layer up, in
// editorial-package-generator.mjs, before this factory is ever called).
//
// Like ingested-content.mjs (and unlike bridge-transport-record.mjs),
// this factory computes its OWN checksum internally, over its own
// assembled fields — self-integrity/tamper-evidence for this record, not
// a reference to something else.

import { randomUUID, createHash } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidEditorialPackageInputError, EditorialPackageValidationError } from "./editorial-package-errors.mjs";

const INGESTED_CONTENT_ID_PATTERN = /^ic_[A-Za-z0-9]+$/;

function generateEditorialPackageId() {
  return "ep_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkNonEmptyString(value, label) {
  if (!isNonEmptyString(value)) {
    throw new InvalidEditorialPackageInputError(`fields.${label} is required and must be a non-empty string`);
  }
}

function checkStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonEmptyString)) {
    throw new InvalidEditorialPackageInputError(`fields.${label} must be a non-empty array of non-empty strings`);
  }
}

function checksumOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Builds an immutable Editorial Package from already-generated editorial
 * fields (the output of an Editorial Analysis Provider, already validated
 * against the Editorial Analysis Result contract — see
 * editorial-analysis-provider.mjs).
 *
 * fields.ingestedContentId — required, the ic_... identifier this package
 *   was derived from.
 * fields.primaryHeadline / supportingHeadline / executiveSummary /
 *   coreMessage / primaryAudience / primaryProblem / desiredOutcome /
 *   callToAction / seoTitle / seoDescription — required, non-empty strings.
 * fields.keyInsights / pullQuotes / keywords / suggestedHashtags /
 *   editorialThemes / contentCategories — required, non-empty arrays of
 *   non-empty strings.
 * fields.llmModel / promptVersion / schemaVersion — required, non-empty
 *   strings (provenance metadata — see README "AI Processing").
 *
 * options.now — override the clock (used by tests).
 * options.idGenerator — override editorial_package_id generation (used by tests).
 * options.validator — inject a pre-built validator.
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidEditorialPackageInputError for structurally invalid
 * input. Throws EditorialPackageValidationError if the assembled object
 * still fails schema validation.
 */
export function createEditorialPackage(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateEditorialPackageId;
  const validator = options.validator ?? createValidator(options);

  if (typeof fields.ingestedContentId !== "string" || !INGESTED_CONTENT_ID_PATTERN.test(fields.ingestedContentId)) {
    throw new InvalidEditorialPackageInputError("fields.ingestedContentId must match ic_<alphanumeric>");
  }

  checkNonEmptyString(fields.primaryHeadline, "primaryHeadline");
  checkNonEmptyString(fields.supportingHeadline, "supportingHeadline");
  checkNonEmptyString(fields.executiveSummary, "executiveSummary");
  checkNonEmptyString(fields.coreMessage, "coreMessage");
  checkNonEmptyString(fields.primaryAudience, "primaryAudience");
  checkNonEmptyString(fields.primaryProblem, "primaryProblem");
  checkNonEmptyString(fields.desiredOutcome, "desiredOutcome");
  checkNonEmptyString(fields.callToAction, "callToAction");
  checkNonEmptyString(fields.seoTitle, "seoTitle");
  checkNonEmptyString(fields.seoDescription, "seoDescription");
  checkNonEmptyString(fields.llmModel, "llmModel");
  checkNonEmptyString(fields.promptVersion, "promptVersion");
  checkNonEmptyString(fields.schemaVersion, "schemaVersion");

  checkStringArray(fields.keyInsights, "keyInsights");
  checkStringArray(fields.pullQuotes, "pullQuotes");
  checkStringArray(fields.keywords, "keywords");
  checkStringArray(fields.suggestedHashtags, "suggestedHashtags");
  checkStringArray(fields.editorialThemes, "editorialThemes");
  checkStringArray(fields.contentCategories, "contentCategories");

  const withoutChecksum = {
    editorial_package_id: idGenerator(),
    ingested_content_id: fields.ingestedContentId,
    status: "generated",
    primary_headline: fields.primaryHeadline,
    supporting_headline: fields.supportingHeadline,
    executive_summary: fields.executiveSummary,
    core_message: fields.coreMessage,
    primary_audience: fields.primaryAudience,
    primary_problem: fields.primaryProblem,
    desired_outcome: fields.desiredOutcome,
    key_insights: fields.keyInsights,
    pull_quotes: fields.pullQuotes,
    call_to_action: fields.callToAction,
    keywords: fields.keywords,
    seo_title: fields.seoTitle,
    seo_description: fields.seoDescription,
    suggested_hashtags: fields.suggestedHashtags,
    editorial_themes: fields.editorialThemes,
    content_categories: fields.contentCategories,
    generated_at: now(),
    llm_model: fields.llmModel,
    prompt_version: fields.promptVersion,
    schema_version: fields.schemaVersion,
  };

  const editorialPackage = { ...withoutChecksum, checksum: checksumOf(withoutChecksum) };

  const validation = validator.validate("editorialPackage", editorialPackage);
  if (!validation.valid) {
    throw new EditorialPackageValidationError(validation.errors);
  }

  return deepFreezeClone(editorialPackage);
}

// DC-003-I030 — Ingested Content domain object factory. Mirrors the
// "assemble, then validate, then deep-freeze" discipline every other
// domain-object factory in this codebase already applies to itself
// (engineering-work-order.mjs, bridge-transport-record.mjs) — composition
// only, no filesystem APIs, no HTTP.
//
// Unlike bridge-transport-record.mjs (which accepts a pre-computed
// checksum of an EXTERNAL object it is transporting), this factory
// computes its OWN checksum internally, over its own assembled fields —
// the checksum here is self-integrity/tamper-evidence for this record,
// not a reference to something else. source_fingerprint (a checksum of
// full_article_text alone) is passed in by the caller, not computed here,
// since it exists to detect a CHANGED SOURCE across ingestions — a
// concern of the Content Ingestion Service (which can compare it against
// prior records), not of this factory.

import { randomUUID, createHash } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidIngestedContentInputError, IngestedContentValidationError } from "./ingested-content-errors.mjs";

const SOURCE_TYPES = ["google_docs"];
const APPROVAL_STATES = ["pending", "approved", "rejected"];
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function generateIngestedContentId() {
  return "ic_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checksumOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Builds an immutable Ingested Content record from already-retrieved
 * source fields (the output of a Content Source Adapter's fetch(), plus
 * a computed source_fingerprint).
 *
 * fields.sourceType — required, one of SOURCE_TYPES.
 * fields.sourceReference — required, the STABLE source identifier (e.g.
 *   a Google Doc ID, already normalised — see content-ingestion-service.mjs).
 * fields.sourceFingerprint — required, a 64-char lowercase hex SHA-256
 *   digest of fields.fullArticleText, computed by the caller.
 * fields.title / fullArticleText — required, non-empty strings.
 * fields.metadata — optional, object or null (default null).
 * fields.approvalState — optional, one of APPROVAL_STATES (default "pending").
 *
 * options.now — override the clock (used by tests).
 * options.idGenerator — override ingested_content_id generation (used by tests).
 * options.validator — inject a pre-built validator.
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidIngestedContentInputError for structurally invalid input.
 * Throws IngestedContentValidationError if the assembled object still
 * fails schema validation.
 */
export function createIngestedContent(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateIngestedContentId;
  const validator = options.validator ?? createValidator(options);

  if (!SOURCE_TYPES.includes(fields.sourceType)) {
    throw new InvalidIngestedContentInputError(`fields.sourceType must be one of ${SOURCE_TYPES.join(", ")}`);
  }
  if (!isNonEmptyString(fields.sourceReference)) {
    throw new InvalidIngestedContentInputError("fields.sourceReference is required and must be a non-empty string");
  }
  if (typeof fields.sourceFingerprint !== "string" || !FINGERPRINT_PATTERN.test(fields.sourceFingerprint)) {
    throw new InvalidIngestedContentInputError("fields.sourceFingerprint must be a 64-character lowercase hex SHA-256 digest");
  }
  if (!isNonEmptyString(fields.title)) {
    throw new InvalidIngestedContentInputError("fields.title is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.fullArticleText)) {
    throw new InvalidIngestedContentInputError("fields.fullArticleText is required and must be a non-empty string");
  }
  if (fields.metadata !== null && fields.metadata !== undefined && typeof fields.metadata !== "object") {
    throw new InvalidIngestedContentInputError("fields.metadata must be an object or null");
  }
  const approvalState = fields.approvalState ?? "pending";
  if (!APPROVAL_STATES.includes(approvalState)) {
    throw new InvalidIngestedContentInputError(`fields.approvalState must be one of ${APPROVAL_STATES.join(", ")}`);
  }

  const wordCount = fields.fullArticleText.trim().split(/\s+/).filter(Boolean).length;
  const timestamp = now();

  const withoutChecksum = {
    ingested_content_id: idGenerator(),
    source_type: fields.sourceType,
    source_reference: fields.sourceReference,
    source_fingerprint: fields.sourceFingerprint,
    title: fields.title,
    status: "ingested",
    approval_state: approvalState,
    full_article_text: fields.fullArticleText,
    word_count: wordCount,
    metadata: fields.metadata ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const ingestedContent = { ...withoutChecksum, checksum: checksumOf(withoutChecksum) };

  const validation = validator.validate("ingestedContent", ingestedContent);
  if (!validation.valid) {
    throw new IngestedContentValidationError(validation.errors);
  }

  return deepFreezeClone(ingestedContent);
}

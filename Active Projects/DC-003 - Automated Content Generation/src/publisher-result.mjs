// DC-003-I025 — Publisher Result domain object factory. Mirrors the
// "assemble, then validate, then deep-freeze" discipline every other
// domain-object factory in this codebase already applies to itself
// (execution-metadata.mjs, finished-carousel-builder.mjs,
// production-metrics.mjs) — composition only, no filesystem APIs, no
// provider-specific SDKs, no HTTP.
//
// This module never invents evidence: every field it accepts is exactly
// what the caller (production-asset-publisher-service.mjs, after a
// successful adapter.publishPackage() call) already has in hand — this
// factory's own job is narrower: apply the shared validation/immutability/
// ID-generation discipline, and nothing else.
//
// Represents ONE successful publication only — there is no "failed"
// status. A failed publish attempt never reaches this factory at all (see
// production-asset-publisher-service.mjs's own header comment).

import { randomUUID } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidPublisherResultInputError, PublisherResultValidationError } from "./publisher-result-errors.mjs";

function generatePublisherResultId() {
  return "pub_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Builds an immutable Publisher Result from an already-completed publish —
 * composition only, never invents a field.
 *
 * fields.carouselId — required, `^car_[A-Za-z0-9]+$`.
 * fields.assetPackageId — required, `^pkg_[A-Za-z0-9]+$` — from the I021
 *   export package's own metadata.json.
 * fields.executionId — required, `^exec_[0-9]{8}_[A-Za-z0-9]+$` — from the
 *   same export metadata.json.
 * fields.provider — required, non-empty string, e.g. "google-drive" — the
 *   publisher adapter's own result `publisher` field, passed through
 *   verbatim.
 * fields.destination — required, non-empty string — a human-navigable
 *   location for the published package (e.g. a Drive folder URL).
 * fields.providerReference — required, non-empty string — an opaque
 *   provider-specific identifier (e.g. a Drive folder ID).
 * fields.metadata — optional, a plain object of provider-specific extra
 *   evidence; defaults to `{}` when omitted, never invented beyond what
 *   the caller supplies.
 *
 * options.now — override the clock (used by tests); defaults to
 *   () => new Date().toISOString().
 * options.idGenerator — override publisher_result_id generation (used by
 *   tests).
 * options.validator — inject a pre-built validator.
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidPublisherResultInputError immediately for a structurally
 * malformed input (a caller bug, not a real publishing problem). Throws
 * PublisherResultValidationError if the assembled object still fails
 * schema validation despite passing every composition check above.
 */
export function createPublisherResult(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generatePublisherResultId;
  const validator = options.validator ?? createValidator(options);

  if (!isNonEmptyString(fields.carouselId)) {
    throw new InvalidPublisherResultInputError("fields.carouselId is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.assetPackageId)) {
    throw new InvalidPublisherResultInputError("fields.assetPackageId is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.executionId)) {
    throw new InvalidPublisherResultInputError("fields.executionId is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.provider)) {
    throw new InvalidPublisherResultInputError("fields.provider is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.destination)) {
    throw new InvalidPublisherResultInputError("fields.destination is required and must be a non-empty string");
  }
  if (!isNonEmptyString(fields.providerReference)) {
    throw new InvalidPublisherResultInputError("fields.providerReference is required and must be a non-empty string");
  }
  if (fields.metadata !== undefined && !isPlainObject(fields.metadata)) {
    throw new InvalidPublisherResultInputError("fields.metadata, when supplied, must be a plain object");
  }

  const record = {
    publisher_result_id: idGenerator(),
    carousel_id: fields.carouselId,
    asset_package_id: fields.assetPackageId,
    execution_id: fields.executionId,
    provider: fields.provider,
    destination: fields.destination,
    published_at: now(),
    status: "completed",
    provider_reference: fields.providerReference,
    metadata: fields.metadata ?? {},
  };

  const validation = validator.validate("publisherResult", record);
  if (!validation.valid) {
    throw new PublisherResultValidationError(validation.errors);
  }

  return deepFreezeClone(record);
}

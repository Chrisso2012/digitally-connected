// DC-003-I028 — Social Analytics Snapshot domain object factory. Mirrors
// the "assemble, then validate, then deep-freeze" discipline every other
// domain-object factory in this codebase already applies to itself
// (production-metrics.mjs, publisher-result.mjs, finished-carousel-builder.mjs)
// — composition only, no filesystem APIs, no HTTP, no platform SDKs.
//
// This module never invents evidence: every metric/engagement value it
// accepts must already be normalized by the calling adapter (see
// social-analytics-adapter.mjs) into { value, availability } form. Its own
// job is narrower — apply the shared validation/immutability/ID-generation
// discipline, reject structurally invalid input (negative counts, an
// unrecognized availability state), and calculate the one
// provider-independent derived total this milestone defines (brief §11):
// engagement.total = reactions + comments + shares + saves, calculated
// ONLY when every input is "available".

import { randomUUID } from "node:crypto";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidSocialAnalyticsSnapshotInputError, SocialAnalyticsSnapshotValidationError } from "./social-analytics-errors.mjs";

const SUPPORTED_PROVIDERS = ["instagram", "linkedin"];
const AVAILABILITY_VALUES = ["available", "unavailable", "not-supported", "not-returned"];
const ENGAGEMENT_KEYS = ["reactions", "comments", "shares", "saves"];

function generateSnapshotId() {
  return "sas_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function checkMetricValue(metric, label) {
  if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
    throw new InvalidSocialAnalyticsSnapshotInputError(`${label} must be an object { value, availability }`);
  }
  if (!AVAILABILITY_VALUES.includes(metric.availability)) {
    throw new InvalidSocialAnalyticsSnapshotInputError(`${label}.availability must be one of ${AVAILABILITY_VALUES.join(", ")}`);
  }
  if (metric.availability === "available") {
    if (typeof metric.value !== "number" || !Number.isFinite(metric.value) || metric.value < 0) {
      throw new InvalidSocialAnalyticsSnapshotInputError(`${label}.value must be a non-negative number when availability is "available"`);
    }
  } else if (metric.value !== null) {
    throw new InvalidSocialAnalyticsSnapshotInputError(
      `${label}.value must be null when availability is not "available" — unavailable data is never represented as a number`
    );
  }
}

function checkMetrics(metrics) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new InvalidSocialAnalyticsSnapshotInputError("fields.metrics must be an object of metric name -> { value, availability }");
  }
  for (const [name, metric] of Object.entries(metrics)) {
    checkMetricValue(metric, `fields.metrics.${name}`);
  }
}

function checkEngagementInputs(engagement) {
  if (!engagement || typeof engagement !== "object") {
    throw new InvalidSocialAnalyticsSnapshotInputError(
      "fields.engagement must be an object { reactions, comments, shares, saves }, each { value, availability }"
    );
  }
  for (const key of ENGAGEMENT_KEYS) {
    checkMetricValue(engagement[key], `fields.engagement.${key}`);
  }
}

function deriveEngagementTotal(engagement) {
  const allAvailable = ENGAGEMENT_KEYS.every((key) => engagement[key].availability === "available");
  if (!allAvailable) {
    return { value: null, availability: "unavailable" };
  }
  const total = ENGAGEMENT_KEYS.reduce((sum, key) => sum + engagement[key].value, 0);
  return { value: total, availability: "available" };
}

function checkSource(source) {
  if (!source || !["provider-api", "mock"].includes(source.type)) {
    throw new InvalidSocialAnalyticsSnapshotInputError('fields.source.type must be "provider-api" or "mock"');
  }
  if (source.providerApiVersion !== null && typeof source.providerApiVersion !== "string") {
    throw new InvalidSocialAnalyticsSnapshotInputError("fields.source.providerApiVersion must be a string or null");
  }
}

/**
 * Builds an immutable Social Analytics Snapshot — one observation of one
 * published social post at one point in time.
 *
 * fields.publisherResultId / carouselId — required, must match the source
 *   Publisher Result's own identifiers (the service, not this factory,
 *   verifies they actually correspond to a real stored record).
 * fields.provider — required, "instagram" | "linkedin".
 * fields.destination / providerPostReference — required, non-empty
 *   strings, copied verbatim from the source Publisher Result.
 * fields.collectedAt — optional ISO date-time string; defaults to
 *   options.now().
 * fields.metrics — required, { <name>: { value, availability } }.
 * fields.engagement — required, { reactions, comments, shares, saves },
 *   each { value, availability } — already normalized by the adapter;
 *   `total` is calculated here, never supplied by the caller.
 * fields.source — required, { type: "provider-api" | "mock",
 *   providerApiVersion: string | null }.
 *
 * options.now / idGenerator / validator / rootDir — injectable for tests.
 *
 * Throws InvalidSocialAnalyticsSnapshotInputError for structurally invalid
 * input. Throws SocialAnalyticsSnapshotValidationError if the assembled
 * object still fails schema validation.
 */
export function createSocialAnalyticsSnapshot(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const idGenerator = options.idGenerator ?? generateSnapshotId;
  const validator = options.validator ?? createValidator(options);

  if (typeof fields.publisherResultId !== "string" || !/^pub_[A-Za-z0-9]+$/.test(fields.publisherResultId)) {
    throw new InvalidSocialAnalyticsSnapshotInputError("fields.publisherResultId must be a valid pub_... identifier");
  }
  if (typeof fields.carouselId !== "string" || !/^car_[A-Za-z0-9]+$/.test(fields.carouselId)) {
    throw new InvalidSocialAnalyticsSnapshotInputError("fields.carouselId must be a valid car_... identifier");
  }
  if (!SUPPORTED_PROVIDERS.includes(fields.provider)) {
    throw new InvalidSocialAnalyticsSnapshotInputError(`fields.provider must be one of ${SUPPORTED_PROVIDERS.join(", ")}`);
  }
  if (typeof fields.destination !== "string" || fields.destination.trim() === "") {
    throw new InvalidSocialAnalyticsSnapshotInputError("fields.destination is required and must be a non-empty string");
  }
  if (typeof fields.providerPostReference !== "string" || fields.providerPostReference.trim() === "") {
    throw new InvalidSocialAnalyticsSnapshotInputError("fields.providerPostReference is required and must be a non-empty string");
  }
  if (fields.collectedAt !== undefined && (typeof fields.collectedAt !== "string" || fields.collectedAt.trim() === "")) {
    throw new InvalidSocialAnalyticsSnapshotInputError("fields.collectedAt must be a non-empty ISO date-time string when supplied");
  }
  checkMetrics(fields.metrics);
  checkEngagementInputs(fields.engagement);
  checkSource(fields.source);

  const engagement = {
    reactions: fields.engagement.reactions,
    comments: fields.engagement.comments,
    shares: fields.engagement.shares,
    saves: fields.engagement.saves,
    total: deriveEngagementTotal(fields.engagement),
  };

  const snapshot = {
    analytics_snapshot_id: idGenerator(),
    publisher_result_id: fields.publisherResultId,
    carousel_id: fields.carouselId,
    provider: fields.provider,
    destination: fields.destination,
    provider_post_reference: fields.providerPostReference,
    collected_at: fields.collectedAt ?? now(),
    status: "completed",
    metrics: fields.metrics,
    engagement,
    source: { type: fields.source.type, provider_api_version: fields.source.providerApiVersion },
  };

  const validation = validator.validate("socialAnalyticsSnapshot", snapshot);
  if (!validation.valid) {
    throw new SocialAnalyticsSnapshotValidationError(validation.errors);
  }

  return deepFreezeClone(snapshot);
}

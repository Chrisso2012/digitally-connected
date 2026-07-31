// DC-003-I003 — Topic Package operational readiness checks.
//
// Runs only after schema validation has already passed (see
// topic-package-loader.mjs) — this module checks things JSON Schema
// structurally cannot: whether "approved" fields contain usable content,
// not just correctly-typed content, and whether the object is internally
// consistent with itself.
//
// Approval-state scope note: the Topic Package schema (schemas/topic-package.schema.json)
// has a `status` field but no separate approval-metadata block (no approved_by,
// approved_at, etc.) — that metadata was deliberately placed on the Finished
// Carousel Object instead, per DC-003-T002 §7 ("approval applies to a
// rendered output, not a topic or a content draft"). Confirmed with the user
// during DC-003-I003 rather than inventing new Topic Package fields.
// `status === "approved"` is therefore the sole approval signal checked here.

const REQUIRED_TEXT_FIELDS = [
  "working_title",
  "audience",
  "primary_goal",
  "core_message",
  "cta",
  "brand_voice",
  "owner",
];

function isBlank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function checkApprovalState(topicPackage, issues) {
  if (topicPackage.status !== "approved") {
    issues.push({
      check: "approval-state",
      message: `status is "${topicPackage.status}" — a Topic Package must have status "approved" before use by content generation`,
    });
  }
}

function checkVersionMetadata(topicPackage, expectedSchemaVersion, issues) {
  if (isBlank(topicPackage.schema_version)) {
    issues.push({ check: "schema-version-present", message: `schema_version is missing or blank` });
    return;
  }
  if (expectedSchemaVersion && topicPackage.schema_version !== expectedSchemaVersion) {
    issues.push({
      check: "schema-version-compatible",
      message:
        `Topic Package schema_version "${topicPackage.schema_version}" does not match the ` +
        `currently approved topic_package schema version "${expectedSchemaVersion}" (config/versions.json)`,
    });
  }
}

function checkUsableContent(topicPackage, issues) {
  if (isBlank(topicPackage.topic_id)) {
    issues.push({ check: "usable-content", message: `"topic_id" is blank` });
  }
  for (const field of REQUIRED_TEXT_FIELDS) {
    if (isBlank(topicPackage[field])) {
      issues.push({ check: "usable-content", message: `"${field}" is blank or whitespace-only` });
    }
  }
  if (Array.isArray(topicPackage.supporting_points)) {
    const blankIndexes = topicPackage.supporting_points
      .map((point, index) => (isBlank(point) ? index : -1))
      .filter((index) => index !== -1);
    if (blankIndexes.length > 0) {
      issues.push({
        check: "usable-content",
        message: `"supporting_points" has blank or whitespace-only entries at index: ${blankIndexes.join(", ")}`,
      });
    }
  }
}

function checkInternalConsistency(topicPackage, issues) {
  const created = Date.parse(topicPackage.created_date);
  const updated = Date.parse(topicPackage.updated_date);
  if (!Number.isNaN(created) && !Number.isNaN(updated) && updated < created) {
    issues.push({
      check: "timestamp-sequence",
      message: `updated_date (${topicPackage.updated_date}) is earlier than created_date (${topicPackage.created_date})`,
    });
  }

  if (Array.isArray(topicPackage.related_topic_ids) && topicPackage.related_topic_ids.length > 0) {
    if (topicPackage.related_topic_ids.includes(topicPackage.topic_id)) {
      issues.push({
        check: "self-reference",
        message: `related_topic_ids includes the Topic Package's own topic_id ("${topicPackage.topic_id}")`,
      });
    }
    const seen = new Set();
    const duplicates = new Set();
    for (const id of topicPackage.related_topic_ids) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    if (duplicates.size > 0) {
      issues.push({
        check: "duplicate-related-topic-ids",
        message: `related_topic_ids contains duplicate value(s): ${[...duplicates].join(", ")}`,
      });
    }
  }
}

/**
 * Runs every operational readiness check against a schema-valid Topic
 * Package. Returns { ok, issues } — never throws on its own; the loader
 * decides whether to raise TopicPackageReadinessError.
 *
 * options.expectedSchemaVersion — the topic_package value from
 *   config/versions.json's schema_versions. Passed in explicitly (rather
 *   than loaded here) so this module stays a pure function of its inputs.
 */
export function checkTopicPackageReadiness(topicPackage, options = {}) {
  const issues = [];

  checkApprovalState(topicPackage, issues);
  checkVersionMetadata(topicPackage, options.expectedSchemaVersion, issues);
  checkUsableContent(topicPackage, issues);
  checkInternalConsistency(topicPackage, issues);

  return { ok: issues.length === 0, issues };
}

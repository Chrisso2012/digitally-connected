import test from "node:test";
import assert from "node:assert/strict";
import { checkTopicPackageReadiness } from "../../src/topic-package-readiness.mjs";

function baseTopic(overrides = {}) {
  return {
    topic_id: "topic_TEST0001",
    working_title: "A perfectly fine working title",
    audience: "Owner-operators running 10-50 staff service businesses",
    primary_goal: "Book a database audit call",
    funnel_stage: "consideration",
    core_message: "A substantive core message.",
    supporting_points: ["Point one", "Point two"],
    cta: "Book your audit",
    brand_voice: "confident-direct",
    status: "approved",
    created_date: "2026-07-20T09:00:00Z",
    updated_date: "2026-07-21T09:00:00Z",
    version: 1,
    schema_version: "1.0",
    source: "manual",
    locale: "en",
    owner: "chris@digitallyconnected.net",
    related_topic_ids: [],
    ...overrides,
  };
}

test("a fully valid, approved topic is ready with no issues", () => {
  const report = checkTopicPackageReadiness(baseTopic(), { expectedSchemaVersion: "1.0" });
  assert.equal(report.ok, true, JSON.stringify(report.issues));
});

test("status other than 'approved' fails the approval-state check", () => {
  for (const status of ["draft", "in_production", "completed", "archived"]) {
    const report = checkTopicPackageReadiness(baseTopic({ status }), { expectedSchemaVersion: "1.0" });
    assert.equal(report.ok, false, `expected status "${status}" to be rejected`);
    assert.ok(report.issues.some((i) => i.check === "approval-state"));
  }
});

test("schema_version mismatch against config fails the compatibility check", () => {
  const report = checkTopicPackageReadiness(baseTopic({ schema_version: "0.9" }), { expectedSchemaVersion: "1.0" });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "schema-version-compatible"));
});

test("whitespace-only required text fields fail the usable-content check", () => {
  const report = checkTopicPackageReadiness(
    baseTopic({ working_title: "   ", audience: "\t\n" }),
    { expectedSchemaVersion: "1.0" }
  );
  assert.equal(report.ok, false);
  const messages = report.issues.filter((i) => i.check === "usable-content").map((i) => i.message);
  assert.ok(messages.some((m) => m.includes("working_title")));
  assert.ok(messages.some((m) => m.includes("audience")));
});

test("whitespace-only supporting_points entries are reported by index", () => {
  const report = checkTopicPackageReadiness(
    baseTopic({ supporting_points: ["Real point", "   ", ""] }),
    { expectedSchemaVersion: "1.0" }
  );
  assert.equal(report.ok, false);
  const issue = report.issues.find((i) => i.check === "usable-content" && i.message.includes("supporting_points"));
  assert.ok(issue, "expected a supporting_points usable-content issue");
  assert.match(issue.message, /index: 1, 2/);
});

test("updated_date earlier than created_date fails the timestamp-sequence check", () => {
  const report = checkTopicPackageReadiness(
    baseTopic({ created_date: "2026-07-29T12:00:00Z", updated_date: "2026-07-28T09:00:00Z" }),
    { expectedSchemaVersion: "1.0" }
  );
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "timestamp-sequence"));
});

test("a topic listing itself in related_topic_ids fails the self-reference check", () => {
  const report = checkTopicPackageReadiness(
    baseTopic({ related_topic_ids: ["topic_TEST0001"] }),
    { expectedSchemaVersion: "1.0" }
  );
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "self-reference"));
});

test("duplicate related_topic_ids entries are detected", () => {
  const report = checkTopicPackageReadiness(
    baseTopic({ related_topic_ids: ["topic_OTHER0001", "topic_OTHER0001"] }),
    { expectedSchemaVersion: "1.0" }
  );
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.check === "duplicate-related-topic-ids"));
});

test("collects every issue at once rather than stopping at the first", () => {
  const report = checkTopicPackageReadiness(
    baseTopic({ status: "draft", working_title: "   ", schema_version: "0.9" }),
    { expectedSchemaVersion: "1.0" }
  );
  assert.equal(report.ok, false);
  const checks = report.issues.map((i) => i.check);
  assert.ok(checks.includes("approval-state"));
  assert.ok(checks.includes("usable-content"));
  assert.ok(checks.includes("schema-version-compatible"));
});

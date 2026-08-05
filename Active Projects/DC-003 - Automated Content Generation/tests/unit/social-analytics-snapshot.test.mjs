import test from "node:test";
import assert from "node:assert/strict";
import { createSocialAnalyticsSnapshot } from "../../src/social-analytics-snapshot.mjs";
import { InvalidSocialAnalyticsSnapshotInputError, SocialAnalyticsSnapshotValidationError } from "../../src/social-analytics-errors.mjs";

const available = (value) => ({ value, availability: "available" });
const unavailable = { value: null, availability: "unavailable" };

function baseFields(overrides = {}) {
  return {
    publisherResultId: "pub_snaptest00000001",
    carouselId: "car_snaptest00000001",
    provider: "instagram",
    destination: "17800000000000001",
    providerPostReference: "17800000000000099",
    metrics: { reach: available(1000), views: { value: null, availability: "not-supported" } },
    engagement: { reactions: available(80), comments: available(10), shares: available(5), saves: available(15) },
    source: { type: "mock", providerApiVersion: "v21.0" },
    ...overrides,
  };
}

test("builds a valid, immutable snapshot with a derived engagement total", () => {
  const snapshot = createSocialAnalyticsSnapshot(baseFields(), { idGenerator: () => "sas_test0000000001", now: () => "2026-08-06T00:00:00.000Z" });
  assert.equal(snapshot.analytics_snapshot_id, "sas_test0000000001");
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.collected_at, "2026-08-06T00:00:00.000Z");
  assert.deepEqual(snapshot.engagement.total, { value: 110, availability: "available" });
  assert.throws(() => {
    snapshot.provider = "linkedin";
  }, TypeError);
});

test("respects an explicit fields.collectedAt over the injected clock", () => {
  const snapshot = createSocialAnalyticsSnapshot(baseFields({ collectedAt: "2026-08-01T00:00:00.000Z" }), {
    idGenerator: () => "sas_test0000000002",
    now: () => "2026-08-06T00:00:00.000Z",
  });
  assert.equal(snapshot.collected_at, "2026-08-01T00:00:00.000Z");
});

test("engagement.total is unavailable when any one input is not available — never a partial sum", () => {
  const snapshot = createSocialAnalyticsSnapshot(
    baseFields({ engagement: { reactions: available(80), comments: unavailable, shares: available(5), saves: available(15) } }),
    { idGenerator: () => "sas_test0000000003" }
  );
  assert.deepEqual(snapshot.engagement.total, { value: null, availability: "unavailable" });
});

test("a legitimate zero is preserved as available:0, distinct from unavailable", () => {
  const snapshot = createSocialAnalyticsSnapshot(
    baseFields({ engagement: { reactions: available(0), comments: available(0), shares: available(0), saves: available(0) } }),
    { idGenerator: () => "sas_test0000000004" }
  );
  assert.deepEqual(snapshot.engagement.reactions, { value: 0, availability: "available" });
  assert.deepEqual(snapshot.engagement.total, { value: 0, availability: "available" });
});

test("preserves not-supported and not-returned availability classifications verbatim", () => {
  const snapshot = createSocialAnalyticsSnapshot(
    baseFields({ metrics: { reach: available(500), views: { value: null, availability: "not-returned" }, clicks: { value: null, availability: "not-supported" } } }),
    { idGenerator: () => "sas_test0000000005" }
  );
  assert.equal(snapshot.metrics.views.availability, "not-returned");
  assert.equal(snapshot.metrics.clicks.availability, "not-supported");
});

test("rejects a negative metric value even when availability is 'available'", () => {
  assert.throws(
    () => createSocialAnalyticsSnapshot(baseFields({ metrics: { reach: { value: -1, availability: "available" } } })),
    InvalidSocialAnalyticsSnapshotInputError
  );
});

test("rejects a non-null value when availability is not 'available' — unavailable data is never a number", () => {
  assert.throws(
    () => createSocialAnalyticsSnapshot(baseFields({ metrics: { reach: { value: 5, availability: "unavailable" } } })),
    InvalidSocialAnalyticsSnapshotInputError
  );
});

test("rejects an unrecognized availability state", () => {
  assert.throws(
    () => createSocialAnalyticsSnapshot(baseFields({ metrics: { reach: { value: null, availability: "bogus" } } })),
    InvalidSocialAnalyticsSnapshotInputError
  );
});

test("rejects an unsupported provider", () => {
  assert.throws(() => createSocialAnalyticsSnapshot(baseFields({ provider: "google-drive" })), InvalidSocialAnalyticsSnapshotInputError);
});

test("rejects a malformed publisherResultId / carouselId", () => {
  assert.throws(() => createSocialAnalyticsSnapshot(baseFields({ publisherResultId: "not-a-real-id" })), InvalidSocialAnalyticsSnapshotInputError);
  assert.throws(() => createSocialAnalyticsSnapshot(baseFields({ carouselId: "not-a-real-id" })), InvalidSocialAnalyticsSnapshotInputError);
});

test("rejects an empty destination / providerPostReference", () => {
  assert.throws(() => createSocialAnalyticsSnapshot(baseFields({ destination: "" })), InvalidSocialAnalyticsSnapshotInputError);
  assert.throws(() => createSocialAnalyticsSnapshot(baseFields({ providerPostReference: "" })), InvalidSocialAnalyticsSnapshotInputError);
});

test("rejects an invalid source.type", () => {
  assert.throws(() => createSocialAnalyticsSnapshot(baseFields({ source: { type: "bogus", providerApiVersion: null } })), InvalidSocialAnalyticsSnapshotInputError);
});

test("does not mutate the supplied metrics/engagement objects", () => {
  const fields = baseFields();
  const before = JSON.stringify(fields);
  createSocialAnalyticsSnapshot(fields, { idGenerator: () => "sas_test0000000006" });
  assert.equal(JSON.stringify(fields), before);
});

test("throws SocialAnalyticsSnapshotValidationError if a caller-supplied idGenerator produces a malformed id", () => {
  assert.throws(() => createSocialAnalyticsSnapshot(baseFields(), { idGenerator: () => "not-a-real-id" }), SocialAnalyticsSnapshotValidationError);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSocialAnalyticsStore } from "../../src/social-analytics-store.mjs";
import { createLocalJsonSocialAnalyticsStoreAdapter } from "../../src/local-json-social-analytics-store-adapter.mjs";
import { createSocialAnalyticsSnapshot } from "../../src/social-analytics-snapshot.mjs";
import {
  InvalidSocialAnalyticsStoreAdapterError,
  InvalidSocialAnalyticsSnapshotIdentifierError,
  SocialAnalyticsSnapshotAlreadyExistsError,
  SocialAnalyticsSnapshotNotFoundError,
  CorruptedSocialAnalyticsSnapshotError,
} from "../../src/social-analytics-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-social-analytics-store-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createSocialAnalyticsStore({ adapter: createLocalJsonSocialAnalyticsStoreAdapter({ storageDir }) });
}

const available = (value) => ({ value, availability: "available" });

function snapshotFields(overrides = {}) {
  return {
    publisherResultId: "pub_storetest00000001",
    carouselId: "car_storetest00000001",
    provider: "instagram",
    destination: "17800000000000001",
    providerPostReference: "17800000000000099",
    metrics: { reach: available(100) },
    engagement: { reactions: available(10), comments: available(2), shares: available(1), saves: available(3) },
    source: { type: "mock", providerApiVersion: "v21.0" },
    ...overrides,
  };
}

function buildSnapshot(overrides = {}, options = {}) {
  return createSocialAnalyticsSnapshot(snapshotFields(overrides), options);
}

// --- Adapter validation ----------------------------------------------------

test("throws InvalidSocialAnalyticsStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createSocialAnalyticsStore({ adapter: { name: "x" } }), InvalidSocialAnalyticsStoreAdapterError);
});

// --- save() / get() / exists() ---------------------------------------------

test("save() persists a valid snapshot and returns an immutable copy", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const snapshot = buildSnapshot({}, { idGenerator: () => "sas_savetest0000001" });
    const saved = store.save(snapshot);
    assert.equal(saved.analytics_snapshot_id, "sas_savetest0000001");
    assert.throws(() => {
      saved.status = "failed";
    }, TypeError);
  }));

test("save() rejects a second save for the same analytics_snapshot_id — never overwrites", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const idGen = () => "sas_duplicatetest001";
    store.save(buildSnapshot({}, { idGenerator: idGen }));
    assert.throws(() => store.save(buildSnapshot({}, { idGenerator: idGen })), SocialAnalyticsSnapshotAlreadyExistsError);
  }));

test("save() allows a fresh snapshot for the same publisher_result_id — repeated collection is the intended usage", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildSnapshot({}, { idGenerator: () => "sas_first0000000001", now: () => "2026-08-01T00:00:00.000Z" }));
    assert.doesNotThrow(() => store.save(buildSnapshot({}, { idGenerator: () => "sas_second00000002", now: () => "2026-08-03T00:00:00.000Z" })));
    assert.equal(store.list().length, 2);
  }));

test("get() retrieves a stored, immutable snapshot; throws for missing/invalid identifiers", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const snapshot = buildSnapshot({}, { idGenerator: () => "sas_gettest00000001" });
    store.save(snapshot);
    const fetched = store.get("sas_gettest00000001");
    assert.equal(fetched.analytics_snapshot_id, "sas_gettest00000001");
    assert.throws(() => store.get("sas_doesnotexist0001"), SocialAnalyticsSnapshotNotFoundError);
    assert.throws(() => store.get("../../etc/passwd"), InvalidSocialAnalyticsSnapshotIdentifierError);
  }));

test("list() throws CorruptedSocialAnalyticsSnapshotError naming the specific corrupted identifier", () =>
  withTempDir((dir) => {
    const adapter = createLocalJsonSocialAnalyticsStoreAdapter({ storageDir: dir });
    adapter.write("sas_corrupted0000001", "{ not valid json");
    const store = createSocialAnalyticsStore({ adapter });
    assert.throws(
      () => store.list(),
      (error) => {
        assert.ok(error instanceof CorruptedSocialAnalyticsSnapshotError);
        assert.equal(error.identifier, "sas_corrupted0000001");
        return true;
      }
    );
  }));

// --- findByPublisherResult() / findByCarousel() / latestByPublisherResult() ---

test("findByPublisherResult() returns full records ordered chronologically, [] when none match", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const early = buildSnapshot({ publisherResultId: "pub_target000000001" }, { idGenerator: () => "sas_a00000000000001", now: () => "2026-08-01T00:00:00.000Z" });
    const late = buildSnapshot({ publisherResultId: "pub_target000000001" }, { idGenerator: () => "sas_b00000000000002", now: () => "2026-08-05T00:00:00.000Z" });
    const other = buildSnapshot({ publisherResultId: "pub_other0000000002" }, { idGenerator: () => "sas_c00000000000003" });
    store.save(late); // saved out of order — must still come back sorted
    store.save(early);
    store.save(other);

    const results = store.findByPublisherResult("pub_target000000001");
    assert.deepEqual(results.map((r) => r.analytics_snapshot_id), ["sas_a00000000000001", "sas_b00000000000002"]);
    assert.deepEqual(store.findByPublisherResult("pub_nomatch0000000001"), []);
  }));

test("findByCarousel() returns full records across multiple providers/publisher results for the same carousel", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(
      buildSnapshot({ carouselId: "car_target000000001", provider: "instagram" }, { idGenerator: () => "sas_ig0000000000001" })
    );
    store.save(
      buildSnapshot(
        { carouselId: "car_target000000001", provider: "linkedin", destination: "urn:li:person:1", providerPostReference: "urn:li:share:1" },
        { idGenerator: () => "sas_li0000000000002" }
      )
    );
    const results = store.findByCarousel("car_target000000001");
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.provider).sort(), ["instagram", "linkedin"]);
  }));

test("latestByPublisherResult() returns the maximum collected_at, or null when none exist", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.equal(store.latestByPublisherResult("pub_nonexistent000001"), null);

    store.save(buildSnapshot({ publisherResultId: "pub_target000000002" }, { idGenerator: () => "sas_d00000000000001", now: () => "2026-08-01T00:00:00.000Z" }));
    store.save(buildSnapshot({ publisherResultId: "pub_target000000002" }, { idGenerator: () => "sas_e00000000000002", now: () => "2026-08-07T00:00:00.000Z" }));
    store.save(buildSnapshot({ publisherResultId: "pub_target000000002" }, { idGenerator: () => "sas_f00000000000003", now: () => "2026-08-03T00:00:00.000Z" }));

    const latest = store.latestByPublisherResult("pub_target000000002");
    assert.equal(latest.analytics_snapshot_id, "sas_e00000000000002");
  }));

test("historical snapshots are never overwritten by a later collection for the same publisher result", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildSnapshot({ publisherResultId: "pub_history000000001" }, { idGenerator: () => "sas_history0000001", now: () => "2026-08-01T00:00:00.000Z" }));
    store.save(buildSnapshot({ publisherResultId: "pub_history000000001" }, { idGenerator: () => "sas_history0000002", now: () => "2026-08-05T00:00:00.000Z" }));

    const first = store.get("sas_history0000001");
    assert.equal(first.collected_at, "2026-08-01T00:00:00.000Z");
    const history = store.findByPublisherResult("pub_history000000001");
    assert.equal(history.length, 2);
  }));

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEngineeringStrategyReviewStore } from "../../src/engineering-strategy-review-store.mjs";
import { createLocalJsonEngineeringStrategyReviewStoreAdapter } from "../../src/local-json-engineering-strategy-review-store-adapter.mjs";
import { createEngineeringStrategyReview } from "../../src/engineering-strategy-review.mjs";
import {
  InvalidEngineeringStrategyReviewIdentifierError,
  EngineeringStrategyReviewAlreadyExistsError,
  EngineeringStrategyReviewNotFoundError,
  CorruptedEngineeringStrategyReviewError,
  DuplicateDeliveryReportReviewError,
} from "../../src/engineering-strategy-review-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-strategy-review-store-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildStore(storageDir) {
  return createEngineeringStrategyReviewStore({ adapter: createLocalJsonEngineeringStrategyReviewStoreAdapter({ storageDir }) });
}

function buildReview(overrides = {}, options = {}) {
  return createEngineeringStrategyReview(
    {
      workOrderId: "wo_storetest0000001",
      deliveryReportId: "dr_storetest0000001",
      workOrderReviewCriteria: ["c1"],
      milestone: "DC-003-I029.3",
      reviewerProvider: "mock",
      decision: "approved",
      criteria: [{ criterionIndex: 1, criterion: "c1", result: "pass", evidence: [], reason: null }],
      repositoryEvidence: { startingCommit: "aaa1111", endingCommit: "bbb2222", branch: "main", workingTree: "clean", pushStatus: "not_applicable", verifiable: true },
      verification: {
        tests: { status: "passed", passed: 1, failed: 0, total: 1, source: "independent-verification" },
        fixtures: { status: "passed", passed: 1, failed: 0, total: 1, source: "independent-verification" },
      },
      summary: "ok",
      ...overrides,
    },
    options
  );
}

test("save()/get(): round-trips a real review, deep-frozen on read", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const review = buildReview();
    store.save(review);
    const fetched = store.get(review.strategy_review_id);
    assert.equal(fetched.strategy_review_id, review.strategy_review_id);
    assert.throws(() => {
      "use strict";
      fetched.decision = "rejected";
    });
  }));

test("save(): rejects a duplicate strategy_review_id", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const review = buildReview({}, { idGenerator: () => "esr_dup00000000001" });
    store.save(review);
    const sameId = buildReview({ deliveryReportId: "dr_storetest0000002" }, { idGenerator: () => "esr_dup00000000001" });
    assert.throws(() => store.save(sameId), EngineeringStrategyReviewAlreadyExistsError);
  }));

test("save(): rejects a second review for the same Delivery Report — no versioning exists yet", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const first = buildReview({}, { idGenerator: () => "esr_first0000000001" });
    store.save(first);
    const second = buildReview({}, { idGenerator: () => "esr_second000000001" }); // same deliveryReportId as first
    assert.throws(() => store.save(second), DuplicateDeliveryReportReviewError);
  }));

test("get(): throws EngineeringStrategyReviewNotFoundError for an unknown id", () =>
  withTempDir((dir) => {
    assert.throws(() => buildStore(dir).get("esr_doesnotexist0001"), EngineeringStrategyReviewNotFoundError);
  }));

test("get()/save(): reject a malformed identifier — path traversal safe", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.throws(() => store.get("../../etc/passwd"), InvalidEngineeringStrategyReviewIdentifierError);
  }));

test("get(): a corrupted stored file throws CorruptedEngineeringStrategyReviewError", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    writeFileSync(path.join(dir, "esr_corrupt0000001.json"), "{ not valid json", "utf-8");
    assert.throws(() => store.get("esr_corrupt0000001"), CorruptedEngineeringStrategyReviewError);
  }));

test("list(): returns summaries ordered chronologically by reviewed_at", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildReview({ deliveryReportId: "dr_storetest0000002", reviewedAt: "2026-08-05T02:00:00.000Z" }, { idGenerator: () => "esr_b0000000000001" }));
    store.save(buildReview({ deliveryReportId: "dr_storetest0000003", reviewedAt: "2026-08-05T01:00:00.000Z" }, { idGenerator: () => "esr_a0000000000001" }));
    const list = store.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].strategy_review_id, "esr_a0000000000001");
    assert.equal(list[1].strategy_review_id, "esr_b0000000000001");
  }));

test("findByWorkOrder(): returns every full review for one Work Order, empty array otherwise", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    store.save(buildReview({ deliveryReportId: "dr_storetest0000002" }, { idGenerator: () => "esr_wo0000000000001" }));
    assert.equal(store.findByWorkOrder("wo_storetest0000001").length, 1);
    assert.deepEqual(store.findByWorkOrder("wo_doesnotexist0001"), []);
  }));

test("findByDeliveryReport(): returns the review for one Delivery Report, empty array otherwise", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const review = buildReview();
    store.save(review);
    const found = store.findByDeliveryReport(review.delivery_report_id);
    assert.equal(found.length, 1);
    assert.equal(found[0].strategy_review_id, review.strategy_review_id);
    assert.deepEqual(store.findByDeliveryReport("dr_doesnotexist0001"), []);
  }));

test("latestByWorkOrder(): returns the most recent review, or null when none exist", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    assert.equal(store.latestByWorkOrder("wo_storetest0000001"), null);
    store.save(buildReview({ deliveryReportId: "dr_storetest0000002", reviewedAt: "2026-08-05T01:00:00.000Z" }, { idGenerator: () => "esr_old0000000001" }));
    store.save(buildReview({ deliveryReportId: "dr_storetest0000003", reviewedAt: "2026-08-05T02:00:00.000Z" }, { idGenerator: () => "esr_new0000000001" }));
    assert.equal(store.latestByWorkOrder("wo_storetest0000001").strategy_review_id, "esr_new0000000001");
  }));

test("exists(): reflects real presence", () =>
  withTempDir((dir) => {
    const store = buildStore(dir);
    const review = buildReview();
    assert.equal(store.exists(review.strategy_review_id), false);
    store.save(review);
    assert.equal(store.exists(review.strategy_review_id), true);
  }));

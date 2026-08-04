import test from "node:test";
import assert from "node:assert/strict";
import { createProductionMetrics } from "../../src/production-metrics.mjs";
import { InvalidProductionMetricsInputError, ProductionMetricsValidationError } from "../../src/production-metrics-errors.mjs";

function completedFields(overrides = {}) {
  return {
    requestId: "req_01J9METRICSTEST1",
    executionId: "exec_20260804_deadbeefcafe",
    carouselContentId: "cc_metricstest0001",
    carouselId: "car_metricstest0001",
    status: "completed",
    requests: { anthropic: 1, templated: 6, googleDrive: 0 },
    durationsMs: { generation: null, render: 20570, export: null, publish: null, total: 33734 },
    outputs: { slidesGenerated: 6, slidesRendered: 6, filesExported: 7, filesPublished: 0 },
    costs: {
      currency: "USD",
      anthropic: { amount: 0.0234, calculationType: "estimated" },
      templated: { amount: 0.3, calculationType: "estimated" },
      googleDrive: { amount: 0, calculationType: "unavailable" },
      total: 0.3234,
    },
    ...overrides,
  };
}

// --- Successful construction, immutability, determinism -----------------

test("builds a valid, schema-conforming completed record", () => {
  const record = createProductionMetrics(completedFields(), {
    now: () => "2026-08-04T12:00:00.000Z",
    idGenerator: () => "met_deterministictest01",
  });
  assert.equal(record.metrics_id, "met_deterministictest01");
  assert.equal(record.request_id, "req_01J9METRICSTEST1");
  assert.equal(record.status, "completed");
  assert.equal(record.carousel_content_id, "cc_metricstest0001");
  assert.equal(record.carousel_id, "car_metricstest0001");
  assert.equal(record.recorded_at, "2026-08-04T12:00:00.000Z");
  assert.equal(record.requests.anthropic, 1);
  assert.equal(record.requests.google_drive, 0);
  assert.equal(record.durations_ms.generation, null);
  assert.equal(record.durations_ms.total, 33734);
  assert.equal(record.outputs.slides_generated, 6);
  assert.equal(record.costs.anthropic.calculation_type, "estimated");
  assert.equal(record.costs.total, 0.3234);
});

test("returns a fully frozen (immutable) object, including nested sub-objects", () => {
  const record = createProductionMetrics(completedFields());
  assert.throws(() => {
    record.status = "failed";
  }, TypeError);
  assert.throws(() => {
    record.requests.anthropic = 99;
  }, TypeError);
  assert.throws(() => {
    record.costs.total = 999;
  }, TypeError);
});

test("metrics_id defaults to a fresh met_ prefixed ID when no idGenerator is supplied", () => {
  const record = createProductionMetrics(completedFields());
  assert.match(record.metrics_id, /^met_[A-Za-z0-9]+$/);
});

test("recorded_at defaults to the real clock (an ISO date-time string) when no now is supplied", () => {
  const record = createProductionMetrics(completedFields());
  assert.equal(Number.isNaN(Date.parse(record.recorded_at)), false);
});

// --- Completed vs. failed shape ------------------------------------------

test("a failed record may have null carouselContentId/carouselId and execution_id", () => {
  const record = createProductionMetrics(
    completedFields({
      status: "failed",
      executionId: null,
      carouselContentId: null,
      carouselId: null,
      requests: { anthropic: 0, templated: 0, googleDrive: 0 },
      outputs: { slidesGenerated: 0, slidesRendered: 0, filesExported: 0, filesPublished: 0 },
      costs: {
        currency: "USD",
        anthropic: { amount: 0, calculationType: "unavailable" },
        templated: { amount: 0, calculationType: "estimated" },
        googleDrive: { amount: 0, calculationType: "unavailable" },
        total: 0,
      },
    })
  );
  assert.equal(record.status, "failed");
  assert.equal(record.carousel_content_id, null);
  assert.equal(record.carousel_id, null);
  assert.equal(record.execution_id, null);
});

test("a \"completed\" record without carouselContentId/carouselId fails schema validation (never a fake success record)", () => {
  assert.throws(
    () => createProductionMetrics(completedFields({ carouselContentId: null, carouselId: null })),
    ProductionMetricsValidationError
  );
});

// --- Negative-value rejection ---------------------------------------------

test("rejects negative request counts", () => {
  assert.throws(
    () => createProductionMetrics(completedFields({ requests: { anthropic: -1, templated: 6, googleDrive: 0 } })),
    InvalidProductionMetricsInputError
  );
});

test("rejects negative durations", () => {
  assert.throws(
    () => createProductionMetrics(completedFields({ durationsMs: { generation: null, render: -5, export: null, publish: null, total: 100 } })),
    InvalidProductionMetricsInputError
  );
});

test("rejects negative output counts", () => {
  assert.throws(
    () => createProductionMetrics(completedFields({ outputs: { slidesGenerated: 6, slidesRendered: -1, filesExported: 7, filesPublished: 0 } })),
    InvalidProductionMetricsInputError
  );
});

test("rejects a negative cost amount", () => {
  assert.throws(
    () =>
      createProductionMetrics(
        completedFields({
          costs: {
            currency: "USD",
            anthropic: { amount: -0.01, calculationType: "estimated" },
            templated: { amount: 0.3, calculationType: "estimated" },
            googleDrive: { amount: 0, calculationType: "unavailable" },
            total: 0.29,
          },
        })
      ),
    InvalidProductionMetricsInputError
  );
});

test("rejects an unrecognized calculation_type", () => {
  assert.throws(
    () =>
      createProductionMetrics(
        completedFields({
          costs: {
            currency: "USD",
            anthropic: { amount: 0, calculationType: "guessed" },
            templated: { amount: 0.3, calculationType: "estimated" },
            googleDrive: { amount: 0, calculationType: "unavailable" },
            total: 0.3,
          },
        })
      ),
    InvalidProductionMetricsInputError
  );
});

test("null is a legal duration value (genuinely untracked), distinct from a rejected negative number", () => {
  const record = createProductionMetrics(completedFields({ durationsMs: { generation: null, render: null, export: null, publish: null, total: null } }));
  assert.equal(record.durations_ms.total, null);
});

// --- Required top-level fields --------------------------------------------

test("requires a non-empty requestId", () => {
  assert.throws(() => createProductionMetrics(completedFields({ requestId: "" })), InvalidProductionMetricsInputError);
  assert.throws(() => createProductionMetrics(completedFields({ requestId: undefined })), InvalidProductionMetricsInputError);
});

test("requires status to be \"completed\" or \"failed\"", () => {
  assert.throws(() => createProductionMetrics(completedFields({ status: "in_progress" })), InvalidProductionMetricsInputError);
});

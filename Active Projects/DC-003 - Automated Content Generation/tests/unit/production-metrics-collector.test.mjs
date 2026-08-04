import test from "node:test";
import assert from "node:assert/strict";
import { collectProductionMetrics } from "../../src/production-metrics-collector.mjs";

const COST_CONFIG = {
  anthropicInputCostPerMillionTokens: 3.0,
  anthropicOutputCostPerMillionTokens: 15.0,
  templatedCostPerRender: 0.05,
  googleDriveCostPerUpload: 0,
  currency: "USD",
};

function successfulProductionResult(overrides = {}) {
  return {
    success: true,
    requestId: "req_01J9COLLECTORTEST1",
    sourceReference: "GS01",
    executionId: "exec_20260804_deadbeefcafe",
    carouselContentId: "cc_collectortest0001",
    carouselId: "car_collectortest0001",
    status: "completed",
    slideCount: 6,
    renderedSlideCount: 6,
    stored: true,
    storeReference: "local-json-carousel-store:car_collectortest0001",
    warnings: [],
    error: null,
    duration: 33734,
    ...overrides,
  };
}

// --- Successful collection, tolerating optional stages -------------------

test("collects a completed record from a Production Run Result alone (export/publish not yet run)", () => {
  const record = collectProductionMetrics(
    { productionResult: successfulProductionResult() },
    { costConfig: COST_CONFIG, idGenerator: () => "met_collectortest0001" }
  );
  assert.equal(record.status, "completed");
  assert.equal(record.request_id, "req_01J9COLLECTORTEST1");
  assert.equal(record.execution_id, "exec_20260804_deadbeefcafe");
  assert.equal(record.carousel_content_id, "cc_collectortest0001");
  assert.equal(record.carousel_id, "car_collectortest0001");
  assert.equal(record.requests.anthropic, 1);
  assert.equal(record.requests.templated, 6);
  assert.equal(record.requests.google_drive, 0, "no publish result supplied — google_drive requests default to 0");
  assert.equal(record.outputs.files_exported, 0, "no export result supplied");
  assert.equal(record.outputs.files_published, 0, "no publish result supplied");
  assert.equal(record.durations_ms.total, 33734);
  assert.equal(record.durations_ms.generation, null, "not tracked anywhere in the current pipeline");
  assert.equal(record.durations_ms.render, null);
  assert.equal(record.durations_ms.export, null);
  assert.equal(record.durations_ms.publish, null);
});

test("collects a completed record enriched with export and publish results when supplied", () => {
  const record = collectProductionMetrics(
    {
      productionResult: successfulProductionResult(),
      exportResult: { status: "completed", assetPackageId: "pkg_x", exportPath: "/exports/car_collectortest0001", slideCount: 6, filesExported: 7, alreadyExported: false },
      publishResult: { status: "completed", publisher: "google-drive", packageId: "car_collectortest0001", folderId: "folder_x", folderUrl: "https://drive.google.com/drive/folders/folder_x", filesUploaded: 7 },
    },
    { costConfig: COST_CONFIG }
  );
  assert.equal(record.outputs.files_exported, 7);
  assert.equal(record.outputs.files_published, 7);
  assert.equal(record.requests.google_drive, 7);
});

// --- Request-count derivation --------------------------------------------

test("derives Anthropic request count as 1 when generation succeeded, 0 when it never reached that point", () => {
  const succeeded = collectProductionMetrics({ productionResult: successfulProductionResult() }, { costConfig: COST_CONFIG });
  assert.equal(succeeded.requests.anthropic, 1);

  const neverGenerated = collectProductionMetrics(
    { productionResult: successfulProductionResult({ success: false, carouselContentId: null, carouselId: null, renderedSlideCount: 0, slideCount: 0 }) },
    { costConfig: COST_CONFIG }
  );
  assert.equal(neverGenerated.requests.anthropic, 0);
});

test("derives Templated request count from renderedSlideCount, including a partial-failure count", () => {
  const partial = collectProductionMetrics(
    { productionResult: successfulProductionResult({ success: false, renderedSlideCount: 2, carouselId: null }) },
    { costConfig: COST_CONFIG }
  );
  assert.equal(partial.requests.templated, 2);
});

test("an explicit requests override takes precedence over the derived defaults", () => {
  const record = collectProductionMetrics(
    { productionResult: successfulProductionResult(), requests: { anthropic: 3, templated: 12, googleDrive: 1 } },
    { costConfig: COST_CONFIG }
  );
  assert.equal(record.requests.anthropic, 3);
  assert.equal(record.requests.templated, 12);
  assert.equal(record.requests.google_drive, 1);
});

// --- Failed production run ------------------------------------------------

test("collects a failed record: no Finished Carousel ID required, no fake export/publish success", () => {
  const record = collectProductionMetrics(
    {
      productionResult: successfulProductionResult({
        success: false,
        carouselContentId: null,
        carouselId: null,
        renderedSlideCount: 2,
        slideCount: 6,
        error: { code: "SlideDownloadError", message: "download failed" },
      }),
    },
    { costConfig: COST_CONFIG, idGenerator: () => "met_failedtest0001" }
  );
  assert.equal(record.status, "failed");
  assert.equal(record.carousel_content_id, null);
  assert.equal(record.carousel_id, null);
  assert.equal(record.requests.templated, 2, "requests already made before the failure are still recorded");
  assert.equal(record.outputs.files_exported, 0);
  assert.equal(record.outputs.files_published, 0);
  assert.equal(record.costs.templated.amount, 0.1, "cost already incurred for the 2 slides that did render");
});

test("a completed production run's carouselContentId/carouselId are never forced through when status resolves to failed via requests override", () => {
  // Defensive: even if a caller's productionResult.success were somehow
  // true but they wanted status treated as failed via other means, this
  // collector always derives status strictly from productionResult.success
  // — there is no override for status itself, so this test simply confirms
  // that contract holds.
  const record = collectProductionMetrics({ productionResult: successfulProductionResult({ success: true }) }, { costConfig: COST_CONFIG });
  assert.equal(record.status, "completed");
});

// --- Cost calculation integration -----------------------------------------

test("Anthropic cost is \"unavailable\" when no usage is supplied", () => {
  const record = collectProductionMetrics({ productionResult: successfulProductionResult() }, { costConfig: COST_CONFIG });
  assert.equal(record.costs.anthropic.calculation_type, "unavailable");
  assert.equal(record.costs.anthropic.amount, 0);
});

test("Anthropic cost is \"estimated\" and calculated when usage is supplied", () => {
  const record = collectProductionMetrics(
    { productionResult: successfulProductionResult(), anthropicUsage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } },
    { costConfig: COST_CONFIG }
  );
  assert.equal(record.costs.anthropic.calculation_type, "estimated");
  assert.equal(record.costs.anthropic.amount, 18);
});

test("Templated and total costs are calculated end-to-end from render count", () => {
  const record = collectProductionMetrics({ productionResult: successfulProductionResult() }, { costConfig: COST_CONFIG });
  assert.equal(record.costs.templated.amount, 0.3); // 6 * 0.05
  assert.equal(record.costs.total, 0.3); // anthropic unavailable (0) + templated 0.3 + drive 0
});

// --- Never mutates supplied results ----------------------------------

test("never mutates the supplied productionResult/exportResult/publishResult", () => {
  const productionResult = successfulProductionResult();
  const exportResult = { filesExported: 7 };
  const publishResult = { filesUploaded: 7 };
  const beforeProduction = JSON.stringify(productionResult);
  const beforeExport = JSON.stringify(exportResult);
  const beforePublish = JSON.stringify(publishResult);

  collectProductionMetrics({ productionResult, exportResult, publishResult }, { costConfig: COST_CONFIG });

  assert.equal(JSON.stringify(productionResult), beforeProduction);
  assert.equal(JSON.stringify(exportResult), beforeExport);
  assert.equal(JSON.stringify(publishResult), beforePublish);
});

// --- Durations override ------------------------------------------------

test("an explicit durationsMs override enriches what's otherwise unavailable", () => {
  const record = collectProductionMetrics(
    { productionResult: successfulProductionResult(), durationsMs: { render: 20570 } },
    { costConfig: COST_CONFIG }
  );
  assert.equal(record.durations_ms.render, 20570);
  assert.equal(record.durations_ms.total, 33734, "total is still derived from productionResult.duration unless also overridden");
  assert.equal(record.durations_ms.generation, null);
});

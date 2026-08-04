// DC-003-I023 — Production Metrics Collector: observes already-completed
// results and builds one validated Production Metrics Record. It does
// NOT own generation, rendering, exporting, or publishing — it never
// calls I004/I006/I019/I021/I022 itself, never touches a provider, and
// never mutates any supplied result (every input is read-only; the
// returned record is built from copied primitive values, deep-frozen by
// production-metrics.mjs).
//
//   Production Run Result (I020, required)
//         + Export Result (I021, optional — may not have run yet)
//         + Publish Result (I022, optional — may not have run yet)
//         + Anthropic usage (I023's own onUsage hook output, optional)
//         ↓
//   Production Metrics Collector (this module)
//         ↓
//   Production Metrics Record
//
// Tolerates optional downstream stages exactly as the brief requires:
// production may be complete while export/publish have not yet run — the
// record represents the evidence available at collection time, never
// invented success for a stage that hasn't happened.
//
// Request-count derivation (documented once, here — see README "Request
// counts"): when the caller doesn't supply an explicit `requests`
// override, counts are DERIVED from the Production Run Result under the
// stated assumption of a single-attempt live run (I020's own
// maxAttempts: 1 live-verification rule) — `renderedSlideCount` slides
// succeeded means that many Templated requests were made (1 attempt =
// no retries), and a non-null `carouselContentId` means exactly one
// Anthropic request succeeded. This has one known, documented
// imprecision: for a FAILED generation, Production Run Result cannot
// distinguish "Anthropic was never called" from "Anthropic was called
// and rejected the request" (both leave carouselContentId null) — the
// default conservatively reports 0 in both cases rather than guessing.
// Supply `requests.anthropic` explicitly when this distinction matters.
//
// Duration availability (documented once, here — see README "Durations"):
// only `total` (Production Run Result's own `duration`) is derivable
// today. `generation`/`render`/`export`/`publish` are not tracked as
// isolated durations anywhere in this pipeline as of I023 (confirmed by
// repository investigation — Production Asset Export and Google Drive
// Publisher results carry no timing at all, and Carousel Content Object
// never tracked its own generation time) — they are always `null` unless
// the caller explicitly supplies a value it obtained some other way
// (e.g. a separately-loaded Finished Carousel's own render_duration_ms).

import { createProductionMetrics } from "./production-metrics.mjs";
import { calculateAnthropicCost, calculateTemplatedCost, calculateGoogleDriveCost, calculateTotalCost } from "./production-cost-calculator.mjs";

function deriveRequests({ productionResult, publishResult, override }) {
  return {
    anthropic: override?.anthropic ?? (productionResult.carouselContentId ? 1 : 0),
    templated: override?.templated ?? (productionResult.renderedSlideCount ?? 0),
    googleDrive: override?.googleDrive ?? (publishResult?.filesUploaded ?? 0),
  };
}

function deriveDurations({ productionResult, override }) {
  return {
    generation: override?.generation ?? null,
    render: override?.render ?? null,
    export: override?.export ?? null,
    publish: override?.publish ?? null,
    total: override?.total ?? productionResult.duration ?? null,
  };
}

function deriveOutputs({ productionResult, exportResult, publishResult }) {
  return {
    slidesGenerated: productionResult.slideCount ?? 0,
    slidesRendered: productionResult.renderedSlideCount ?? 0,
    filesExported: exportResult?.filesExported ?? 0,
    filesPublished: publishResult?.filesUploaded ?? 0,
  };
}

/**
 * Collects one Production Metrics Record from already-completed evidence.
 *
 * evidence.productionResult — required, a Production Run Result (I020's
 *   executeProductionRun() return value, or an equivalent plain object
 *   loaded from disk with the same field names): { success, requestId,
 *   executionId, carouselContentId, carouselId, slideCount,
 *   renderedSlideCount, duration, ... }.
 * evidence.exportResult — optional, a Production Asset Export result
 *   (I021's executeProductionAssetExport() return value): { filesExported, ... }.
 * evidence.publishResult — optional, a Google Drive Publisher result
 *   (I022's executeProductionAssetPublish() return value): { filesUploaded, ... }.
 * evidence.anthropicUsage — optional, `{ inputTokens, outputTokens }` —
 *   normally captured via createAnthropicProvider()'s own onUsage hook
 *   (DC-003-I023) at generation time; `null`/omitted means "unavailable",
 *   never a guessed token count.
 * evidence.requests — optional override, { anthropic, templated,
 *   googleDrive } — see this module's own header comment for the default
 *   derivation and its one documented imprecision.
 * evidence.durationsMs — optional override, { generation, render, export,
 *   publish, total } — see this module's own header comment for what's
 *   derivable by default.
 *
 * dependencies.costConfig — required, loadProductionCostConfig()'s own
 *   return shape.
 * dependencies.now / idGenerator / validator — forwarded to
 *   createProductionMetrics() unchanged, for deterministic tests.
 *
 * Throws PipelineConfigurationError-style errors only via
 * createProductionMetrics()'s own validation (InvalidProductionMetricsInputError /
 * ProductionMetricsValidationError) — this function itself performs no
 * additional validation beyond what it needs to derive safe defaults.
 *
 * Returns an immutable Production Metrics Record.
 */
export function collectProductionMetrics(evidence, dependencies = {}) {
  const { productionResult, exportResult = null, publishResult = null, anthropicUsage = null } = evidence;

  const requests = deriveRequests({ productionResult, publishResult, override: evidence.requests });
  const durationsMs = deriveDurations({ productionResult, override: evidence.durationsMs });
  const outputs = deriveOutputs({ productionResult, exportResult, publishResult });

  const anthropicCost = calculateAnthropicCost(anthropicUsage, dependencies.costConfig);
  const templatedCost = calculateTemplatedCost(requests.templated, dependencies.costConfig);
  const googleDriveCost = calculateGoogleDriveCost(requests.googleDrive, dependencies.costConfig);
  const costs = calculateTotalCost({
    anthropic: anthropicCost,
    templated: templatedCost,
    googleDrive: googleDriveCost,
    currency: dependencies.costConfig.currency,
  });

  const status = productionResult.success === true ? "completed" : "failed";

  return createProductionMetrics(
    {
      requestId: productionResult.requestId,
      executionId: productionResult.executionId ?? null,
      // A "completed" status requires non-null carouselContentId/carouselId
      // (production-metrics.schema.json's own oneOf) — a "failed" run
      // legitimately has neither when it never got that far; passing them
      // through as-is (null on failure) rather than forcing a value is
      // what "no fake zero-cost success records" and "no invented
      // Finished Carousel ID for a failed run" mean in practice.
      carouselContentId: status === "completed" ? productionResult.carouselContentId : null,
      carouselId: status === "completed" ? productionResult.carouselId : null,
      status,
      requests,
      durationsMs,
      outputs,
      costs: {
        currency: costs.currency,
        anthropic: costs.anthropic,
        templated: costs.templated,
        googleDrive: costs.googleDrive,
        total: costs.total,
      },
    },
    { now: dependencies.now, idGenerator: dependencies.idGenerator, validator: dependencies.validator, rootDir: dependencies.rootDir }
  );
}

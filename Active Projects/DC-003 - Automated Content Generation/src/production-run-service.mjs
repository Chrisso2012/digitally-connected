// DC-003-I020.1 — Production Run Service: the one entry point that can
// compose LIVE Anthropic generation and LIVE Templated rendering into one
// persisted Finished Carousel, routed through the platform's EXISTING
// production architecture — not a parallel, hand-rolled composition.
//
// DC-003-I020's first implementation (`d159dc4`) directly sequenced I004
// (generateCarouselFromTopicPackage), I005 (mapCarouselToTemplatedPayload),
// I006 (renderTemplatedPayload), and I007 (createFinishedCarousel) itself —
// bypassing the Execution Ledger, Pipeline Orchestrator, External
// Invocation Adapter, n8n Adapter, Production Workflow, and I016 Content
// Request Service entirely. An architecture review found this produced no
// audit trail for a live run and duplicated sequencing those existing
// layers already own. See README "Live Production Run — Architectural
// Correction (DC-003-I020.1)" for the full incompatibility analysis. That
// direct-sequencing path has been removed entirely, not retained.
//
// The corrected composition:
//
//   Execution Ledger (I008, unmodified)
//         -> Pipeline Orchestrator (I009, unmodified) — running a LIVE
//            stage list: LoadTopicStage, a live-bound Generate stage,
//            MapPayloadStage, a live-bound Render stage,
//            BuildFinishedCarouselStage (see pipeline-stages-live.mjs;
//            the first, third, and fifth are pipeline-stages.mjs's own
//            unmodified exports)
//         -> External Invocation Adapter (I010, unmodified)
//         -> n8n Adapter (I011, unmodified)
//         -> Production Workflow (I012, unmodified)
//         -> I016 Content Request Service (executeContentRequest(),
//            unmodified) — resolves the Content Asset, builds and
//            validates the Content Request, invokes the Production
//            Workflow above, and persists through I015 — exactly what the
//            mock path already does; only the Production Workflow
//            instance handed to it differs (built with live-bound stages
//            instead of DEFAULT_PIPELINE).
//
// The live provider/transport are bound via closure at stage-construction
// time (pipeline-stages-live.mjs) — never through context.configuration,
// never through the InvocationRequest. invocation-request.schema.json,
// invocation-normalizer.mjs, n8n-workflow-mapper.mjs, n8n-adapter.mjs,
// invocation-adapter.mjs, production-workflow.mjs, and
// content-request-service.mjs are all untouched by this correction.
//
// Known, deliberate trade-off of routing through the existing
// architecture: I010's toSafeInvocationError() narrows a failed stage's
// error down to { code, message, retryable } — it does not forward a
// stage name or an LlmClientError's own `.diagnostic` (DC-003-I019.1)
// through to the Content Request Result's `error` field, and this
// service does not work around that by changing toSafeInvocationError()
// or content-request-service.mjs itself (both are reused unchanged, per
// the approved I020.1 scope). A live Anthropic HTTP 400's safe diagnostic
// therefore is NOT visible on this service's own result — only
// `error.code`/`error.message`/`error.retryable` are. See the delivery
// report for this trade-off; recovering the diagnostic would require a
// separately-scoped, explicitly-approved change to I010's own allowlist.
//
// I016's own Content Request Result shape doesn't carry
// carouselContentId/renderedSlideCount (it was never designed to, and
// isn't changed here) — this service observes both via the
// onGenerated/onSlideRendered hooks pipeline-stages-live.mjs exposes,
// entirely outside content-request-service.mjs's own return value, so
// I016's contract needed no change to support this milestone's richer
// Production Run Result.

import { createExecutionLedger } from "./execution-ledger.mjs";
import { createPipelineOrchestrator } from "./pipeline-orchestrator.mjs";
import { createExternalInvocationAdapter } from "./invocation-adapter.mjs";
import { createN8nAdapter } from "./n8n-adapter.mjs";
import { createProductionWorkflow } from "./production-workflow.mjs";
import { executeContentRequest } from "./content-request-service.mjs";
import { LoadTopicStage, MapPayloadStage, BuildFinishedCarouselStage } from "./pipeline-stages.mjs";
import { createLiveGenerateCarouselStage, createLiveRenderStage } from "./pipeline-stages-live.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";

function elapsedMs(startedAt, completedAt) {
  return Date.parse(completedAt) - Date.parse(startedAt);
}

// A minimal, ephemeral Ledger Store scoped to this one run — the same
// reasoning content-request.mjs's own CLI already established for I016:
// the Execution Ledger's durable audit trail is a separate I008 concern
// this service does not expose or manage on its own. Matches the Ledger
// Store shape execution-ledger-store.mjs requires: { name, append,
// readAll }.
function createInMemoryLedgerStore() {
  const records = [];
  return {
    name: "in-memory-production-run-store",
    append(record) {
      records.push(record);
    },
    readAll() {
      return [...records];
    },
  };
}

function buildLiveStages({ provider, renderTransport, maxAttempts, observed }) {
  return [
    LoadTopicStage,
    createLiveGenerateCarouselStage(provider, {
      maxAttempts,
      onGenerated: (carouselContent) => {
        observed.carouselContentId = carouselContent.carousel_content_id;
      },
    }),
    MapPayloadStage,
    createLiveRenderStage(renderTransport, {
      maxAttempts,
      onSlideRendered: () => {
        observed.renderedSlideCount += 1;
      },
    }),
    BuildFinishedCarouselStage,
  ];
}

function buildResult({
  success,
  requestId,
  sourceReference,
  executionId = null,
  carouselContentId = null,
  carouselId = null,
  status,
  slideCount = 0,
  renderedSlideCount = 0,
  stored = false,
  storeReference = null,
  warnings = [],
  error = null,
  duration,
}) {
  return deepFreezeClone({
    success,
    requestId,
    sourceReference,
    executionId,
    carouselContentId,
    carouselId,
    status,
    slideCount,
    renderedSlideCount,
    stored,
    storeReference,
    warnings,
    error,
    duration,
  });
}

/**
 * Executes one complete production run for one Content Asset, routed
 * through the platform's existing production architecture (I008-I012,
 * I016) with a live-bound generate/render stage pair.
 *
 * fields.assetId — required, forwarded as source_reference to I016's
 *   Content Request Service (source_type fixed to "article", design_count
 *   fixed to 6 — the only production contract I016 itself supports).
 * fields.contentAssetsDir — forwarded to executeContentRequest() unchanged.
 *
 * dependencies.provider — required, { name, generateCarousel(prompt, context) }.
 *   The live Anthropic provider, or the mock provider for a mock run —
 *   bound into the live stage list via pipeline-stages-live.mjs.
 * dependencies.renderTransport — required, { name, send(request, options) }.
 *   The live Templated transport, or the mock transport for a mock run.
 * dependencies.carouselStore — required, createFinishedCarouselStore()'s
 *   return value, forwarded to executeContentRequest() unchanged.
 * dependencies.maxAttempts — the attempt ceiling bound into BOTH live
 *   stages; defaults to 3 (matching generateCarouselFromTopicPackage's/
 *   renderTemplatedPayload's own defaults) when omitted — the caller
 *   (the CLI) is responsible for passing 1 for a live run; there is no
 *   options-propagation path through I016/I012/I011/I010 this service
 *   could rely on instead (see the module header).
 * dependencies.ledgerStore — inject a Ledger Store (used by tests to
 *   assert on the recorded lifecycle); defaults to a fresh in-memory store
 *   per run.
 * dependencies.now / idGenerator / validator — forwarded to
 *   executeContentRequest() unchanged, for deterministic tests.
 *
 * Throws PipelineConfigurationError immediately if `dependencies` itself
 * is malformed (missing provider/renderTransport/carouselStore) — the
 * same fail-fast-on-misconfiguration pattern every adapter/orchestrator in
 * this codebase already uses.
 *
 * Never throws once dependencies are well-formed: executeContentRequest()
 * (I016) already never throws once ITS OWN dependencies and request shape
 * are valid — this service adds no new throwing path on top of it.
 */
export async function executeProductionRun(fields = {}, dependencies = {}) {
  if (!dependencies.provider || typeof dependencies.provider.generateCarousel !== "function") {
    throw new PipelineConfigurationError("executeProductionRun requires dependencies.provider (an object with generateCarousel())");
  }
  if (!dependencies.renderTransport || typeof dependencies.renderTransport.send !== "function") {
    throw new PipelineConfigurationError("executeProductionRun requires dependencies.renderTransport (an object with send())");
  }
  if (!dependencies.carouselStore || typeof dependencies.carouselStore.save !== "function") {
    throw new PipelineConfigurationError("executeProductionRun requires dependencies.carouselStore (an object with save())");
  }

  const now = dependencies.now ?? (() => new Date().toISOString());
  const startedAt = now();

  const observed = { carouselContentId: null, renderedSlideCount: 0 };
  const stages = buildLiveStages({
    provider: dependencies.provider,
    renderTransport: dependencies.renderTransport,
    maxAttempts: dependencies.maxAttempts,
    observed,
  });

  const ledger = createExecutionLedger({ store: dependencies.ledgerStore ?? createInMemoryLedgerStore() });
  const orchestrator = createPipelineOrchestrator({ ledger, stages });
  const invocationAdapter = createExternalInvocationAdapter({ orchestrator });
  const n8nAdapter = createN8nAdapter({ invocationAdapter });
  const productionWorkflow = createProductionWorkflow({ n8nAdapter });

  const contentRequestResult = await executeContentRequest(
    { action: "create", designCount: 6, sourceType: "article", sourceReference: fields.assetId, rawCommand: null },
    {
      productionWorkflow,
      carouselStore: dependencies.carouselStore,
      contentAssetsDir: fields.contentAssetsDir,
      now: dependencies.now,
      idGenerator: dependencies.idGenerator,
      validator: dependencies.validator,
    }
  );

  const completedAt = now();

  return buildResult({
    success: contentRequestResult.success,
    requestId: contentRequestResult.requestId,
    sourceReference: contentRequestResult.sourceReference,
    executionId: contentRequestResult.executionId,
    carouselContentId: observed.carouselContentId,
    carouselId: contentRequestResult.carouselId,
    status: contentRequestResult.status,
    slideCount: observed.carouselContentId ? 6 : 0,
    renderedSlideCount: observed.renderedSlideCount,
    stored: contentRequestResult.stored,
    storeReference: contentRequestResult.storeReference,
    warnings: contentRequestResult.warnings,
    error: contentRequestResult.error,
    duration: elapsedMs(startedAt, completedAt),
  });
}

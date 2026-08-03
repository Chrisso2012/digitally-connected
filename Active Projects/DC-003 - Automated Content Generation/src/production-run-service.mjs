// DC-003-I020 — Production Run Service: the one controlled entry point
// that can select LIVE Anthropic generation and LIVE Templated rendering
// for a complete, real production run. Composes existing capability only —
// this module implements no generation, mapping, rendering, carousel
// construction, or persistence logic of its own:
//
//   Content Asset (I018)
//         -> Carousel Content Generator (I004, live provider injected — I019)
//         -> Templated Payload Mapper (I005, unchanged)
//         -> Renderer (I006, live transport injected)
//         -> Finished Carousel Builder (I007, unchanged)
//         -> Finished Carousel Store (I015, unchanged)
//         -> Production Run Result (I020)
//
// Deliberately bypasses the Ledger/Pipeline Orchestrator/Invocation
// Adapter/n8n Adapter stack (I008-I012): normalizeInvocationRequest()
// (I010) hardcodes its returned configuration to
// `{ topicPackageSource }` only — there is no existing mechanism to carry
// a live provider or live transport object through
// invocation-request.schema.json's validated, JSON-only shape without a
// genuine schema/normalizer change, which is out of scope for this
// milestone ("must not redesign the pipeline"). This module instead
// composes the same per-stage functions pipeline-stages.mjs already calls
// (generateCarouselFromTopicPackage, mapCarouselToTemplatedPayload,
// renderTemplatedPayload, createFinishedCarousel) directly and
// sequentially — the exact pattern DC-003-I019's own
// generate-live-carousel.mjs already established for live generation; this
// module extends that same pattern through live rendering and persistence.
// See README "Live Production Run (DC-003-I020)" -> "Why this bypasses the
// orchestrator" for the full account.
//
// Two failure tiers, matching content-request-service.mjs's own
// established split:
//   1. Missing/malformed `dependencies` (no provider/renderTransport/
//      carouselStore) throws PipelineConfigurationError immediately —
//      caller misconfiguration, not a runtime production failure.
//   2. Everything from asset resolution onward is caught internally and
//      folded into the returned Production Run Result instead of thrown —
//      this service never throws once dependencies are well-formed.
//
// Live-call budget (enforced by the CALLER, not this module): this service
// makes exactly one generateCarousel() call and up to six renderTemplatedPayload()
// calls, in slide order, stopping immediately on the first render failure —
// never more. Per-invocation retry ceilings (dependencies.llmMaxAttempts /
// dependencies.renderMaxAttempts) are the caller's responsibility to cap at
// 1 for a live run (see tests/validation/production-run-live.mjs, which
// reuses the existing resolveLlmLiveMaxAttempts()/resolveLiveMaxAttempts()
// safety primitives from I019/I006 unmodified) — this module applies
// whatever ceiling it is given, exactly like generateCarouselFromTopicPackage
// and renderTemplatedPayload already do for every other caller.

import { randomUUID } from "node:crypto";
import { createContentAssetRepository } from "./content-asset-repository.mjs";
import { generateCarouselFromTopicPackage } from "./carousel-generator.mjs";
import { mapCarouselToTemplatedPayload } from "./carousel-payload-mapper.mjs";
import { renderTemplatedPayload } from "./renderer.mjs";
import { createFinishedCarousel } from "./finished-carousel-builder.mjs";
import { createExecutionMetadata, generateExecutionId } from "./execution-metadata.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { toSafeInvocationError } from "./invocation-errors.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";

function generateProductionRequestId() {
  return "prod_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function elapsedMs(startedAt, completedAt) {
  return Date.parse(completedAt) - Date.parse(startedAt);
}

// Extends toSafeInvocationError()'s { code, message, retryable } with two
// fields specific to this service's own richer reporting requirement:
// `stage` (which step failed) and `slideType` (which slide, render
// failures only). `diagnostic` passes through LlmClientError.diagnostic
// (DC-003-I019.1's own safe, secret-free shape — status/errorType/
// requestId/sanitised message) verbatim when the thrown error carries one;
// never the raw response body, headers, API key, prompt, or tool content —
// same guarantee I019.1 already established, just surfaced one level
// higher.
function safeProductionError(stage, error, slideType = null) {
  const base = toSafeInvocationError(error);
  return {
    stage,
    code: base.code,
    message: base.message,
    retryable: base.retryable,
    slideType,
    diagnostic: error?.diagnostic
      ? {
          status: error.diagnostic.status ?? null,
          errorType: error.diagnostic.errorType ?? null,
          requestId: error.diagnostic.requestId ?? null,
          message: error.diagnostic.message ?? null,
        }
      : null,
  };
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
 * Executes one complete production run for one Content Asset — the only
 * entry point in this codebase that can compose live generation and live
 * rendering into one persisted Finished Carousel.
 *
 * fields.assetId — required, resolved through the I018 Content Asset
 *   Repository.
 * fields.contentAssetsDir — required, passed through to
 *   createContentAssetRepository() unchanged — no default lives here (the
 *   caller, e.g. the CLI, owns that default, matching every other
 *   storage-directory-taking module in this codebase).
 *
 * dependencies.provider — required, { name, generateCarousel(prompt, context) }
 *   (the mock provider, or createAnthropicProvider() for a live run — this
 *   service never constructs either; the caller decides, exactly like
 *   generateCarouselFromTopicPackage() itself already requires).
 * dependencies.renderTransport — required, { name, send(request, options) }
 *   (the mock transport, or createHttpTransport() for a live run).
 * dependencies.carouselStore — required, the return value of
 *   createFinishedCarouselStore() (an object with save() and name).
 * dependencies.llmMaxAttempts — forwarded to generateCarouselFromTopicPackage()
 *   unchanged; defaults to 3 (that function's own default) when omitted.
 * dependencies.renderMaxAttempts — forwarded to every renderTemplatedPayload()
 *   call unchanged; defaults to 3 (that function's own default) when
 *   omitted.
 * dependencies.now / requestIdGenerator / executionIdGenerator /
 *   carouselIdOverride — deterministic overrides, used by tests.
 *
 * Throws PipelineConfigurationError immediately if `dependencies` itself
 * is malformed — the same fail-fast-on-misconfiguration pattern every
 * adapter/orchestrator in this codebase already uses.
 *
 * Never throws once dependencies are well-formed: every failure from asset
 * resolution onward resolves to a Production Run Result with
 * `success: false` and a safe `error`.
 *
 * On an Anthropic (generation) failure: returns before any Templated
 * request is made — `renderedSlideCount` stays 0, no Finished Carousel is
 * built or persisted.
 *
 * On a Templated (render) failure: stops immediately after the failing
 * slide — no later slide is requested, `renderedSlideCount` reflects only
 * the slides that actually completed, `error.slideType` names which slide
 * type failed, no Finished Carousel is built or persisted. A partial
 * render that may already exist on Templated's own side is never
 * represented as a completed or stored carousel here.
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
  const requestId = (dependencies.requestIdGenerator ?? generateProductionRequestId)();
  const sourceReference = fields.assetId ?? null;

  function finish(partial) {
    return buildResult({ requestId, sourceReference, duration: elapsedMs(startedAt, now()), ...partial });
  }

  // 1. Resolve the Content Asset (I018) — unmodified.
  let topicPackage;
  try {
    const repository = createContentAssetRepository({ assetsDir: fields.contentAssetsDir });
    const asset = repository.get(fields.assetId);
    topicPackage = asset.topic_package;
  } catch (cause) {
    return finish({ success: false, status: "rejected", error: safeProductionError("asset-resolution", cause) });
  }

  // 2-4. Generate + validate Carousel Content (I004, live provider — I019).
  // Zero Templated requests are made if this fails — every return path
  // below this point returns before mapCarouselToTemplatedPayload() (and
  // therefore before any render call) ever runs.
  let carouselContent;
  try {
    carouselContent = await generateCarouselFromTopicPackage(topicPackage, {
      provider: dependencies.provider,
      maxAttempts: dependencies.llmMaxAttempts,
    });
  } catch (cause) {
    return finish({ success: false, status: "failed", error: safeProductionError("generation", cause) });
  }

  // 5. Produce six Templated Payloads (I005) — unchanged, pure mapping.
  let templatedPayloads;
  try {
    templatedPayloads = mapCarouselToTemplatedPayload(carouselContent);
  } catch (cause) {
    return finish({
      success: false,
      carouselContentId: carouselContent.carousel_content_id,
      status: "failed",
      error: safeProductionError("mapping", cause),
    });
  }

  // 6. Render each payload in slide order (I006, live transport). Stops
  // immediately on the first failure — no later slide is requested, and no
  // Finished Carousel is ever built from a partial set.
  const renderResults = [];
  for (const payload of templatedPayloads) {
    try {
      const renderResult = await renderTemplatedPayload(payload, {
        transport: dependencies.renderTransport,
        maxAttempts: dependencies.renderMaxAttempts,
      });
      renderResults.push(renderResult);
    } catch (cause) {
      return finish({
        success: false,
        carouselContentId: carouselContent.carousel_content_id,
        status: "failed",
        slideCount: templatedPayloads.length,
        renderedSlideCount: renderResults.length,
        error: safeProductionError("rendering", cause, payload.slide_type),
      });
    }
  }

  // 7. Build one Finished Carousel (I007) — unchanged.
  const totalDurationMs = renderResults.reduce((sum, r) => sum + r.durationMs, 0);
  const executionId = (dependencies.executionIdGenerator ?? generateExecutionId)();
  const executionMetadata = createExecutionMetadata(
    { executionId, provider: renderResults[0].provider, renderDurationMs: totalDurationMs },
    { now: () => new Date(now()) }
  );

  let finishedCarousel;
  try {
    finishedCarousel = createFinishedCarousel(
      {
        carouselContent,
        slideRenders: templatedPayloads.map((templatedPayload, index) => ({ templatedPayload, renderResult: renderResults[index] })),
        executionMetadata,
      },
      { now, carouselId: dependencies.carouselIdOverride }
    );
  } catch (cause) {
    return finish({
      success: false,
      carouselContentId: carouselContent.carousel_content_id,
      status: "failed",
      slideCount: templatedPayloads.length,
      renderedSlideCount: renderResults.length,
      error: safeProductionError("finished-carousel", cause),
    });
  }

  // 8. Persist through I015 — unchanged. Only ever reached after a fully
  // rendered, successfully built Finished Carousel.
  let stored = false;
  let storeReference = null;
  let persistenceError = null;
  try {
    dependencies.carouselStore.save(finishedCarousel);
    stored = true;
    storeReference = `${dependencies.carouselStore.name ?? "carousel-store"}:${finishedCarousel.carousel_id}`;
  } catch (cause) {
    // CarouselAlreadyExistsError (a genuine, if rare, carousel_id
    // collision) and any storage-layer failure are both reported the same
    // safe way here — I015's own domain layer is what decides whether an
    // overwrite/versioning story is ever needed, not this service (see
    // "Idempotency and Duplicate Runs" in the I020 brief).
    persistenceError = safeProductionError("persistence", cause);
  }

  // 9. Safe Production Run Result.
  return finish({
    success: stored === true && finishedCarousel.overall_status === "completed",
    executionId,
    carouselContentId: carouselContent.carousel_content_id,
    carouselId: finishedCarousel.carousel_id,
    status: stored ? finishedCarousel.overall_status : "failed",
    slideCount: templatedPayloads.length,
    renderedSlideCount: renderResults.length,
    stored,
    storeReference,
    error: persistenceError,
  });
}

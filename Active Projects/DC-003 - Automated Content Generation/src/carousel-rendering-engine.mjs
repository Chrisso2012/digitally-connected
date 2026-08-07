// DC-003-I034 — Carousel Rendering Engine: the first real visual-output
// milestone of the new I030->I031->I032->I033->I034 pipeline. Orchestration
// around EXISTING rendering capability — no new rendering subsystem:
//
//   Production Package (I033, loaded by ID)
//         -> Templated Renderer Adapter's mapToRendererPayload()   (I033, unmodified)
//         -> renderTemplatedPayload() per slide                    (I006, unmodified)
//         -> createFinishedCarousel({ productionPackageId, ... })  (I007, DC-003-I034's own additive lineage)
//         -> Finished Carousel Store                                (I015, DC-003-I034's own additive findByProductionPackageId())
//
// Consumes ONLY the Production Package object handed to it by ID — never
// reads Social Media Package, Editorial Package, Ingested Content, Google
// Docs, or a raw article, and never rewrites copy, performs AI analysis,
// or invents missing content. Confirmed by inspection: this file imports
// nothing from social-media-package*.mjs, editorial-package*.mjs,
// ingested-content*.mjs, content-source*.mjs, or google-docs*.mjs, and no
// LLM provider of any kind.
//
// Rendering sequence is deterministic: renders each of the Production
// Package's 6 slides exactly once, in slide order (slide_number 1-6,
// matching mapToRendererPayload()'s own output order), via ONE shared
// transport.
//
// Real behavior discovered by inspection, not assumed: I006's own
// renderTemplatedPayload() does NOT return a non-throwing RenderResult
// with status "failed" when Templated legitimately rejects a render —
// renderer-response-validator.mjs throws RenderRejected instead (see
// renderer.mjs's own header comment: "non-retryable... propagate
// immediately"). Left completely unhandled, that would mean a single
// rejected slide aborts the ENTIRE run with no Finished Carousel
// persisted at all — there would be no way to ever reach a genuine
// "partial" outcome, contradicting this milestone's own explicit
// "collect renderer result metadata... do not silently omit failed
// slides" requirement. The smallest composition-only fix: this engine
// catches ONLY RenderRejected (a deterministic, non-retryable "Templated
// said no" outcome) and converts it into a RenderResult via I006's own
// createRenderResult() factory, status "failed" — reusing the exact
// existing shape/status vocabulary finished-carousel-builder.mjs already
// understands, not inventing a new one. Every OTHER failure
// (AuthenticationError, RetryLimitExceeded, TimeoutError, TransportError,
// ValidationError) still propagates immediately and aborts the whole run
// before anything is persisted — those represent a broken PIPELINE, not
// one bad render, and retrying/partially-persisting against them would be
// unsafe.

import { createTemplatedRendererAdapter } from "./templated-renderer-adapter.mjs";
import { assertValidRendererAdapter } from "./production-package-renderer-adapter.mjs";
import { renderTemplatedPayload } from "./renderer.mjs";
import { createRenderResult } from "./render-result.mjs";
import { RenderRejected } from "./renderer-errors.mjs";
import { createMockTransport } from "./renderer-transport-mock.mjs";
import { createExecutionMetadata } from "./execution-metadata.mjs";
import { createFinishedCarousel } from "./finished-carousel-builder.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";
import { DuplicateRenderError } from "./carousel-rendering-engine-errors.mjs";

/**
 * Renders one Production Package into one persisted Finished Carousel.
 *
 * productionPackageId — required, the pp_... identifier to load and render.
 *
 * dependencies.productionPackageStore — required, a Production Package
 *   Store (DC-003-I033's own createProductionPackageStore()) — the only
 *   source of rendering instructions this service ever reads.
 * dependencies.finishedCarouselStore — required, a Finished Carousel
 *   Store (DC-003-I015's own createFinishedCarouselStore(), extended in
 *   DC-003-I034 with findByProductionPackageId()).
 * dependencies.rendererAdapter — optional, a Renderer Adapter; defaults
 *   to the Templated Adapter (the only one implemented as of I033/I034).
 * dependencies.transport — optional, a renderer transport ({ name,
 *   send() }); defaults to the mock transport. A real live run supplies
 *   an HTTP transport explicitly — this service never selects one itself.
 * dependencies.maxAttempts — per-slide retry ceiling passed to
 *   renderTemplatedPayload(), default 3 (I006's own default).
 * dependencies.timeoutMs — per-slide, per-attempt timeout, default 15000.
 * dependencies.now / carouselId — passed through to createFinishedCarousel()
 *   for deterministic tests.
 *
 * Throws PipelineConfigurationError if dependencies itself is malformed.
 * Throws ProductionPackageNotFoundError (DC-003-I033's own error class,
 * reused unmodified) if productionPackageId doesn't exist. Throws
 * DuplicateRenderError if a Finished Carousel with overall_status
 * "completed" already exists for this Production Package — a prior
 * "failed"/"partial" attempt does NOT block a retry (mirrors I029's own
 * DuplicateDeliveryError precedent). A per-slide RenderRejected (Templated
 * itself rejected that one render) is caught and converted into a
 * "failed" RenderResult, never thrown — see this module's own header
 * comment. Propagates every OTHER renderer/transport error
 * (AuthenticationError, RetryLimitExceeded, TimeoutError, TransportError,
 * ValidationError) or Finished Carousel composition/validation error
 * verbatim, aborting before anything is persisted.
 */
export async function renderProductionPackage(productionPackageId, dependencies = {}) {
  if (!dependencies.productionPackageStore || typeof dependencies.productionPackageStore.get !== "function") {
    throw new PipelineConfigurationError("renderProductionPackage requires dependencies.productionPackageStore (a Production Package Store)");
  }
  if (
    !dependencies.finishedCarouselStore ||
    typeof dependencies.finishedCarouselStore.save !== "function" ||
    typeof dependencies.finishedCarouselStore.findByProductionPackageId !== "function"
  ) {
    throw new PipelineConfigurationError(
      "renderProductionPackage requires dependencies.finishedCarouselStore (a Finished Carousel Store with findByProductionPackageId())"
    );
  }

  const rendererAdapter = dependencies.rendererAdapter ?? createTemplatedRendererAdapter();
  assertValidRendererAdapter(rendererAdapter);
  const transport = dependencies.transport ?? createMockTransport();
  const maxAttempts = dependencies.maxAttempts ?? 3;
  const timeoutMs = dependencies.timeoutMs ?? 15000;

  // Production Package missing: get() itself throws
  // ProductionPackageNotFoundError (unknown ID) or a corruption error —
  // both DC-003-I033's own error classes, propagated as-is.
  const productionPackage = dependencies.productionPackageStore.get(productionPackageId);

  // Duplicate protection: only a genuinely SUCCESSFUL prior render blocks
  // a retry (see DuplicateRenderError's own header comment).
  const existing = dependencies.finishedCarouselStore.findByProductionPackageId(productionPackageId);
  const successfulExisting = existing.find((carousel) => carousel.overall_status === "completed");
  if (successfulExisting) {
    throw new DuplicateRenderError(productionPackageId, successfulExisting.carousel_id);
  }

  // Renderer-agnostic Production Package -> this renderer's own real
  // per-slide template IDs and literal layer names. Defense-in-depth:
  // I033 already validated this mapping succeeds at generation time, so
  // this should never actually fail in normal operation.
  const rendererPayloads = rendererAdapter.mapToRendererPayload(productionPackage);

  const now = dependencies.now ?? (() => new Date().toISOString());

  const slideRenders = [];
  for (const templatedPayload of rendererPayloads) {
    let renderResult;
    try {
      renderResult = await renderTemplatedPayload(templatedPayload, { transport, maxAttempts, timeoutMs });
    } catch (error) {
      if (!(error instanceof RenderRejected)) throw error; // every other failure aborts the whole run — see header comment
      const rejectedAt = now();
      renderResult = createRenderResult({
        renderId: error.renderId ?? `rejected_slide_${templatedPayload.slide_number}`,
        status: "failed",
        imageUrl: null,
        templateId: templatedPayload.template_id,
        slideType: templatedPayload.slide_type,
        provider: transport.name,
        requestedAt: rejectedAt,
        completedAt: rejectedAt,
        durationMs: 0,
      });
    }
    slideRenders.push({ templatedPayload, renderResult });
  }

  const totalDurationMs = slideRenders.reduce((sum, { renderResult }) => sum + renderResult.durationMs, 0);
  const executionMetadata = createExecutionMetadata(
    { provider: transport.name, renderDurationMs: totalDurationMs },
    { now: dependencies.now }
  );

  const finishedCarousel = createFinishedCarousel(
    { productionPackageId, slideRenders, executionMetadata },
    { now: dependencies.now, carouselId: dependencies.carouselId }
  );

  return dependencies.finishedCarouselStore.save(finishedCarousel);
}

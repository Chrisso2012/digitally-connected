// DC-003-I016 — Content Request Service: the platform's first
// user-facing command. Composes existing capability only — this module
// recreates no generation, orchestration, rendering, approval, or
// persistence logic of its own:
//
//   User Content Request
//         -> Content Request Parser        (this milestone)
//         -> Source Resolver                (this milestone, over I003's loadTopicPackage)
//         -> I012 Production Workflow        (unchanged)
//         -> Finished Carousel
//         -> I015 Finished Carousel Store    (unchanged)
//         -> Content Request Result          (this milestone)
//
// Two failure tiers, matching this module's own errors file:
//   1. Request-shape problems (ambiguous command, unsupported design
//      count, schema validation) throw immediately — caller/input bugs,
//      rejected before anything downstream runs.
//   2. Everything from source resolution onward is caught internally and
//      folded into the returned Content Request Result instead of
//      thrown — matching DC-003-I012's own Production Workflow "never
//      throws" contract. A failed production execution is never
//      persisted (DC-003-I015's save() is only ever called after a
//      confirmed successful, completed execution).

import { createContentRequest } from "./content-request.mjs";
import { parseContentRequestCommand } from "./content-request-parser.mjs";
import { resolveSource } from "./content-request-source-resolver.mjs";
import { mapContentRequestToProductionWorkflowInput } from "./content-request-workflow-mapper.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { PipelineConfigurationError } from "./pipeline-errors.mjs";
import { CarouselAlreadyExistsError } from "./finished-carousel-store-errors.mjs";
import {
  UnsupportedDesignCountError,
  ContentRequestProductionFailedError,
  ContentRequestPersistenceFailedError,
  DuplicateStoredCarouselError,
} from "./content-request-errors.mjs";

function safeErrorShape(error) {
  return { code: error.name, message: error.message };
}

function buildResult({ contentRequest, executionId, carouselId, status, stored, storeReference, warnings, error }) {
  return deepFreezeClone({
    success: stored === true && status === "completed",
    requestId: contentRequest.request_id,
    sourceReference: contentRequest.source_reference,
    executionId: executionId ?? null,
    carouselId: carouselId ?? null,
    status,
    stored,
    storeReference: storeReference ?? null,
    warnings: warnings ?? [],
    error: error ?? null,
  });
}

/**
 * Executes one Content Request end-to-end.
 *
 * request — either a raw command string (parsed via
 *   parseContentRequestCommand()) or an already-structured
 *   { action, designCount, sourceType, sourceReference, rawCommand? }
 *   object using the same camelCase field names the parser produces.
 *
 * dependencies.productionWorkflow — required, the return value of
 *   createProductionWorkflow() (an object with run()). This service
 *   never constructs the ledger/orchestrator/adapter stack beneath it —
 *   the caller wires up the real thing, exactly like DC-003-I012's own
 *   CLI already does; this service only ever depends on the { run() }
 *   shape.
 * dependencies.carouselStore — required, the return value of
 *   createFinishedCarouselStore() (an object with save() and, since
 *   DC-003-I016, name).
 * dependencies.topicPackagesDir — required, passed through to
 *   resolveSource().
 * dependencies.now / dependencies.idGenerator / dependencies.validator —
 *   passed through to createContentRequest() for deterministic tests.
 *
 * Throws AmbiguousContentRequestError, UnsupportedDesignCountError, or
 * ContentRequestValidationError immediately for a malformed request.
 * Throws PipelineConfigurationError immediately if `dependencies` itself
 * is malformed (missing productionWorkflow/carouselStore) — the same
 * fail-fast-on-misconfiguration pattern every adapter/orchestrator in
 * this codebase already uses.
 *
 * Never throws once the request itself has been accepted as valid and
 * dependencies are well-formed — every failure from source resolution
 * onward resolves to a Content Request Result with `success: false` and
 * a safe `error`.
 */
export async function executeContentRequest(request, dependencies = {}) {
  if (!dependencies.productionWorkflow || typeof dependencies.productionWorkflow.run !== "function") {
    throw new PipelineConfigurationError("executeContentRequest requires dependencies.productionWorkflow (an object with run())");
  }
  if (!dependencies.carouselStore || typeof dependencies.carouselStore.save !== "function") {
    throw new PipelineConfigurationError("executeContentRequest requires dependencies.carouselStore (an object with save())");
  }

  const parsed = typeof request === "string" ? parseContentRequestCommand(request) : request;

  if (parsed?.designCount !== 6) {
    throw new UnsupportedDesignCountError(parsed?.designCount);
  }

  // Throws ContentRequestValidationError for anything else malformed —
  // the schema's own enums (action, source_type, design_count) are a
  // defense-in-depth backstop behind the explicit check above.
  const contentRequest = createContentRequest(parsed, {
    now: dependencies.now,
    idGenerator: dependencies.idGenerator,
    validator: dependencies.validator,
  });

  let resolvedTopicPackage;
  try {
    resolvedTopicPackage = resolveSource(
      { sourceType: contentRequest.source_type, sourceReference: contentRequest.source_reference },
      { topicPackagesDir: dependencies.topicPackagesDir, validator: dependencies.validator }
    );
  } catch (cause) {
    return buildResult({ contentRequest, status: "rejected", stored: false, error: safeErrorShape(cause) });
  }

  const workflowInput = mapContentRequestToProductionWorkflowInput(contentRequest, resolvedTopicPackage);
  const workflowResult = await dependencies.productionWorkflow.run(workflowInput);

  if (workflowResult.summary.status !== "completed" || !workflowResult.invocationResponse.success) {
    const productionError = workflowResult.invocationResponse.error
      ? { code: workflowResult.invocationResponse.error.code, message: workflowResult.invocationResponse.error.message }
      : safeErrorShape(new ContentRequestProductionFailedError("production workflow did not report success"));

    return buildResult({
      contentRequest,
      executionId: workflowResult.executionId,
      status: workflowResult.summary.status,
      stored: false,
      warnings: workflowResult.invocationResponse.warnings,
      error: productionError,
    });
  }

  // Production completed successfully — and only now does persistence
  // get attempted. A failed/rejected execution never reaches this line.
  const finishedCarousel = workflowResult.finishedCarousel;
  let stored = false;
  let storeReference = null;
  let persistenceError = null;

  try {
    dependencies.carouselStore.save(finishedCarousel);
    stored = true;
    storeReference = `${dependencies.carouselStore.name ?? "carousel-store"}:${finishedCarousel.carousel_id}`;
  } catch (cause) {
    persistenceError =
      cause instanceof CarouselAlreadyExistsError
        ? safeErrorShape(new DuplicateStoredCarouselError(finishedCarousel.carousel_id))
        : safeErrorShape(new ContentRequestPersistenceFailedError(finishedCarousel.carousel_id, "storage adapter failure"));
  }

  return buildResult({
    contentRequest,
    executionId: workflowResult.executionId,
    carouselId: finishedCarousel.carousel_id,
    status: workflowResult.summary.status,
    stored,
    storeReference,
    warnings: workflowResult.invocationResponse.warnings,
    error: persistenceError,
  });
}

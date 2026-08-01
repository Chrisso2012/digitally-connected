// DC-003-I009 — Pipeline Context: the orchestrator's internal working
// state as it moves through the declarative stage pipeline.
//
// Deliberately NOT one of this project's public contracts: never
// persisted, never returned from createPipelineOrchestrator().run() (see
// pipeline-orchestrator.mjs — PipelineResult is the only public return
// value), and never mutated in place — every update replaces the whole
// context with a new, separately frozen object (withContext(), below),
// matching "mutable only through orchestrator-controlled replacement" and
// the same immutability convention every other domain object in this
// codebase already follows.
//
// The Execution Ledger is deliberately NOT one of its fields: the ledger
// is an independent operational component the orchestrator holds
// separately (see pipeline-orchestrator.mjs's own `ledger` argument) —
// never something a stage could reach through the context and write to
// directly. Stages only ever return execution record *data*; only the
// orchestrator ever calls ledger.appendRecord().

import { deepFreeze } from "./immutable.mjs";

/**
 * Builds an immutable PipelineContext. Every field defaults to null/empty
 * so a stage can freely read any field before it's been populated by an
 * earlier stage, without a defensive `?.` chain everywhere.
 *
 * Deliberately uses deepFreeze() (freeze in place), not deepFreezeClone()
 * (clone via structuredClone, then freeze): `configuration` may carry a
 * mock transport/provider object with function properties for a stage to
 * use, and structuredClone() throws DataCloneError on any function
 * anywhere in the value. Every other field (topicPackage, carouselContent,
 * etc.) is already independently deep-frozen by its own factory before it
 * ever reaches this function, so freezing again here is idempotent, not a
 * weaker guarantee — see immutable.mjs's own comment for the full
 * rationale.
 */
export function createPipelineContext(fields = {}) {
  return deepFreeze({
    executionId: fields.executionId ?? null,
    configuration: fields.configuration ?? null,
    topicPackage: fields.topicPackage ?? null,
    carouselContent: fields.carouselContent ?? null,
    templatedPayloads: fields.templatedPayloads ?? null,
    renderResults: fields.renderResults ?? null,
    finishedCarousel: fields.finishedCarousel ?? null,
    metrics: fields.metrics ?? [],
    warnings: fields.warnings ?? [],
  });
}

/**
 * Returns a NEW PipelineContext with `patch`'s fields overlaid onto
 * `context` — the only way this codebase updates a context, matching
 * "mutable only through orchestrator-controlled replacement": nothing
 * about `context` itself ever changes; a fresh, separately frozen object
 * is returned instead.
 */
export function withContext(context, patch = {}) {
  return createPipelineContext({ ...context, ...patch });
}

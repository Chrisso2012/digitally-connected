// DC-003-I007 — Execution Metadata: the immutable trace-identity object
// carried by a Finished Carousel Object (see finished-carousel-builder.mjs).
//
// execution_id is this carousel's execution run's trace identifier — the
// Strategy Office brief for I007 calls it out explicitly as "the trace
// identifier carried through future milestones," meaning DC-003-I008
// (Execution Logging) is expected to reuse this exact ID to tie its own
// record back to this one. Its format therefore matches
// execution-log.schema.json's own execution_id pattern exactly
// (^exec_[0-9]{8}_[A-Za-z0-9]+$), even though I008 itself is not
// implemented yet — see README "Execution metadata".

import { randomUUID } from "node:crypto";
import { deepFreezeClone } from "./immutable.mjs";

const EXECUTION_ID_PATTERN = /^exec_[0-9]{8}_[A-Za-z0-9]+$/;

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Generates a fresh execution_id: exec_YYYYMMDD_<12 lowercase hex chars>.
 * `now` — a () => Date, overridden by tests for deterministic output.
 */
export function generateExecutionId(now = () => new Date()) {
  const date = now();
  const datePart = `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
  const randomPart = randomUUID().replace(/-/g, "").slice(0, 12);
  return `exec_${datePart}_${randomPart}`;
}

/**
 * Builds an immutable ExecutionMetadata object — one of the Finished
 * Carousel Builder's three required inputs (alongside CarouselContent and
 * the per-slide TemplatedPayload/RenderResult pairs).
 *
 * fields.provider — required, non-empty string (e.g. a RenderResult's own
 *   `provider`, since every slide in one carousel is expected to share the
 *   same transport).
 * fields.renderDurationMs — required, a non-negative number — this run's
 *   measured wall-clock render duration. Composition only: the caller
 *   measures it, this factory does not compute or infer it.
 * fields.executionId, fields.renderedAt — optional; generated automatically
 *   when omitted (via generateExecutionId() and `now()` respectively).
 *
 * options.now — override the clock (used by tests).
 *
 * Throws TypeError immediately for any missing or malformed field — the
 * same "fail fast, no silent coercion" contract every other domain-object
 * factory in this codebase follows (see render-result.mjs).
 */
export function createExecutionMetadata(fields = {}, options = {}) {
  const now = options.now ?? (() => new Date());

  if (typeof fields.provider !== "string" || fields.provider.trim() === "") {
    throw new TypeError('createExecutionMetadata: "provider" must be a non-empty string');
  }
  if (typeof fields.renderDurationMs !== "number" || !Number.isFinite(fields.renderDurationMs) || fields.renderDurationMs < 0) {
    throw new TypeError('createExecutionMetadata: "renderDurationMs" must be a non-negative finite number');
  }

  const executionId = fields.executionId ?? generateExecutionId(now);
  if (typeof executionId !== "string" || !EXECUTION_ID_PATTERN.test(executionId)) {
    throw new TypeError(`createExecutionMetadata: "executionId" must match exec_YYYYMMDD_<id> — received ${JSON.stringify(executionId)}`);
  }

  const renderedAt = fields.renderedAt ?? now().toISOString();
  if (typeof renderedAt !== "string" || Number.isNaN(Date.parse(renderedAt))) {
    throw new TypeError(`createExecutionMetadata: "renderedAt" must be a valid ISO date-time string — received ${JSON.stringify(renderedAt)}`);
  }

  return deepFreezeClone({
    executionId,
    renderedAt,
    provider: fields.provider,
    renderDurationMs: fields.renderDurationMs,
  });
}

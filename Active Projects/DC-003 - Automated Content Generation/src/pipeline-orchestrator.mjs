// DC-003-I009 — Pipeline Orchestrator: the single execution engine that
// coordinates every existing pipeline stage. It contains no business
// logic of its own — every domain decision (how to validate a Topic
// Package, how to map a slide onto a template, how to render, how to
// compose a Finished Carousel) still lives entirely inside the module
// that already implemented it (DC-003-I003 through DC-003-I008). This
// file only sequences those modules via the Stage interface
// (pipeline-stages.mjs) and records what happened via the Execution
// Ledger (DC-003-I008) — it does not decide anything about content,
// templates, or rendering itself.
//
// Fundamental Principle (per the DC-003-I009 brief): only ONE component
// may coordinate multiple stages — this one. No stage ever calls another
// stage, and no stage ever writes to the Execution Ledger directly; both
// are exclusively this module's job.
//
// Sequential only: stages run one at a time, in declared order
// (pipeline-definition.mjs's DEFAULT_PIPELINE). No concurrency, no
// parallel rendering, no background workers — explicitly out of scope.
//
// Execution Ledger relationship: PipelineContext never holds a reference
// to the ledger (see pipeline-context.mjs). Stages return execution
// record *data* (partial ExecutionRecord fields); only this orchestrator
// ever calls ledger.appendRecord(), assigning execution_id and a
// monotonically increasing sequence number that stages never need to
// know about.
//
// Clock convention note: most DC-003 modules' `now`/`clock` option returns
// an ISO string (renderer.mjs, finished-carousel-builder.mjs,
// carousel-generator.mjs, carousel-payload-mapper.mjs, execution-record.mjs's
// `clock`) — this orchestrator's own `clock` option matches that
// convention. The one exception is DC-003-I007's createExecutionMetadata(),
// whose `now` option expects a Date object; pipeline-stages.mjs adapts
// between the two at that one call site rather than this file trying to
// paper over the inconsistency generically.
//
// Determinism: `clock` and `executionIdGenerator`/`recordIdGenerator` are
// all injectable, exactly as DC-003-I008 already established for
// ExecutionRecord/ExecutionLedger — no test in this milestone depends on
// the real clock, a random UUID, or network access.

import { generateExecutionId } from "./execution-metadata.mjs";
import { createPipelineContext, withContext } from "./pipeline-context.mjs";
import { DEFAULT_PIPELINE } from "./pipeline-definition.mjs";
import { PipelineConfigurationError, toSafeStageError } from "./pipeline-errors.mjs";

function elapsedMs(startedAt, completedAt) {
  return Date.parse(completedAt) - Date.parse(startedAt);
}

/**
 * Builds a Pipeline Orchestrator bound to one Execution Ledger and one
 * declarative stage list.
 *
 * fields.ledger — required, an ExecutionLedger (createExecutionLedger()'s
 *   return value) — checked immediately via its `appendRecord` shape.
 * fields.stages — the declarative pipeline; defaults to DEFAULT_PIPELINE.
 *   Must be a non-empty array.
 *
 * factoryOptions.clock / executionIdGenerator / recordIdGenerator —
 *   defaults for every run() call made against this orchestrator; each can
 *   still be overridden per-call via run()'s own options.
 *
 * Returns { run }.
 */
export function createPipelineOrchestrator({ ledger, stages = DEFAULT_PIPELINE } = {}, factoryOptions = {}) {
  if (!ledger || typeof ledger.appendRecord !== "function") {
    throw new PipelineConfigurationError(
      "createPipelineOrchestrator requires a valid ExecutionLedger (an object with appendRecord())"
    );
  }
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new PipelineConfigurationError("createPipelineOrchestrator requires a non-empty stage list");
  }

  /**
   * Runs the full declarative pipeline once, start to finish.
   *
   * inputFields.executionId — override the generated execution_id (tests).
   * inputFields.configuration — passed onto the initial PipelineContext;
   *   read by individual stages (e.g. configuration.topicPackageSource).
   *
   * runOptions.clock — () => ISO date-time string. Defaults to the real
   *   clock (or factoryOptions.clock).
   * runOptions.executionIdGenerator — () => string, for the execution_id
   *   itself. Defaults to generateExecutionId() (DC-003-I007/I008's own
   *   exec_YYYYMMDD_<id> generator, reused rather than duplicated).
   * runOptions.recordIdGenerator — () => string, passed through as every
   *   ledger.appendRecord() call's own `idGenerator` (record_id
   *   generation) — left undefined by default, in which case
   *   execution-record.mjs's own default applies.
   *
   * Returns a PipelineResult: { success, executionId, finishedCarousel,
   * warnings, error, duration }. This is the orchestrator's one public
   * return value — PipelineContext itself is never returned.
   */
  async function run(inputFields = {}, runOptions = {}) {
    const clock = runOptions.clock ?? factoryOptions.clock ?? (() => new Date().toISOString());
    const executionIdGenerator =
      runOptions.executionIdGenerator ?? factoryOptions.executionIdGenerator ?? (() => generateExecutionId(() => new Date(clock())));
    const recordIdGenerator = runOptions.recordIdGenerator ?? factoryOptions.recordIdGenerator;
    const stageOptions = { ...runOptions, clock, idGenerator: recordIdGenerator };

    const executionId = inputFields.executionId ?? executionIdGenerator();
    const runStartedAt = clock();
    let sequence = 0;

    function append(partialFields) {
      sequence += 1;
      return ledger.appendRecord({ execution_id: executionId, sequence, ...partialFields }, { clock, idGenerator: recordIdGenerator });
    }

    append({ event_type: "execution.started", status: "started", stage: null, source: "pipeline-orchestrator" });

    let context = createPipelineContext({ executionId, configuration: inputFields.configuration ?? null });

    for (const stage of stages) {
      const stageStartedAt = clock();
      let stageResult;
      try {
        stageResult = await stage.execute(context, stageOptions);
      } catch (thrown) {
        // A stage threw instead of returning a StageResult — the
        // orchestrator is still the safety net; this never escapes run().
        stageResult = { success: false, updatedContext: null, executionRecords: [], warnings: [], error: toSafeStageError(stage.name, thrown) };
      }
      const stageCompletedAt = clock();
      const stageDurationMs = elapsedMs(stageStartedAt, stageCompletedAt);

      context = withContext(context, {
        metrics: [...context.metrics, { stage: stage.name, startedAt: stageStartedAt, completedAt: stageCompletedAt, durationMs: stageDurationMs }],
      });

      // Append whatever this stage reported, success or failure, enriching
      // every record with this stage's own measured duration ("stage
      // timing... feeds the Execution Ledger").
      for (const record of stageResult.executionRecords ?? []) {
        append({ ...record, data: { ...(record.data ?? {}), duration_ms: stageDurationMs } });
      }

      if (!stageResult.success) {
        append({
          event_type: "execution.failed",
          status: "failed",
          stage: stage.name,
          source: "pipeline-orchestrator",
          diagnostics: {
            error_category: "stage-failure",
            error_code: stageResult.error?.code ?? "UnknownError",
            retryable: stageResult.error?.retryable ?? false,
            field_path: stage.name,
            safe_message: stageResult.error?.message ?? "Stage failed with no further detail",
          },
        });

        return {
          success: false,
          executionId,
          finishedCarousel: null,
          warnings: [...context.warnings, ...(stageResult.warnings ?? [])],
          error: stageResult.error,
          duration: elapsedMs(runStartedAt, clock()),
        };
      }

      context = withContext(context, {
        ...stageResult.updatedContext,
        warnings: [...context.warnings, ...(stageResult.warnings ?? [])],
      });
    }

    append({ event_type: "execution.completed", status: "succeeded", stage: null, source: "pipeline-orchestrator" });

    return {
      success: true,
      executionId,
      finishedCarousel: context.finishedCarousel,
      warnings: context.warnings,
      error: null,
      duration: elapsedMs(runStartedAt, clock()),
    };
  }

  return { run };
}

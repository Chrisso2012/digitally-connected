// DC-003-I020.1 — Live-bound stage factories: the ONLY place a live
// Anthropic provider or a live Templated transport is bound into the
// Pipeline Orchestrator's declarative stage list. Structurally mirror
// GenerateCarouselStage/RenderStage (pipeline-stages.mjs, DC-003-I009,
// unmodified) exactly — same StageResult shape, same execution-record
// event types and data fields, same error handling. The only difference
// is WHERE the provider/transport comes from: a closure captured once, at
// stage-construction time, here — never `context.configuration?.provider`/
// `.transport`, which pipeline-stages.mjs's own stages still read for the
// mock/default pipeline, unchanged.
//
// Why this module exists (architecture review, see README "Live
// Production Run — Architectural Correction (DC-003-I020.1)"):
// normalizeInvocationRequest() (DC-003-I010) hardcodes its returned
// configuration to `{ topicPackageSource }` only, and
// invocation-request.schema.json has `additionalProperties: false` — an
// executable provider/transport object can never cross that boundary
// without a genuine schema change, out of scope for this milestone.
// Binding the live dependency into the STAGE LIST at construction time
// instead means `context.configuration` never needs to carry it, so
// nothing about I010's schema, I011's n8n Adapter, or I012's Production
// Workflow needs to change at all — this module, plus how
// production-run-service.mjs assembles the stage list, is the entire
// correction.
//
// `maxAttempts` is ALSO bound via closure here, not read from the
// orchestrator's own runOptions — DC-003-I016's own
// content-request-service.mjs calls `productionWorkflow.run(workflowInput)`
// with no second (options) argument at all, so there is no
// options-propagation path this module could rely on even if it wanted
// to. Hardcoding the live attempt ceiling at construction time,
// independent of anything upstream, mirrors the same "hardcoded-safe, not
// options-dependent" discipline resolveLlmLiveMaxAttempts()/
// resolveLiveMaxAttempts() (DC-003-I019/I006) already established after
// their own live-verification incidents.

import { generateCarouselFromTopicPackage } from "./carousel-generator.mjs";
import { renderTemplatedPayload } from "./renderer.mjs";
import { toSafeStageError } from "./pipeline-errors.mjs";

function ok(updatedContext, executionRecords, warnings = []) {
  return { success: true, updatedContext, executionRecords, warnings, error: null };
}

function fail(stageName, error, executionRecords = []) {
  return { success: false, updatedContext: null, executionRecords, warnings: [], error: toSafeStageError(stageName, error) };
}

/**
 * Builds a live-bound replacement for GenerateCarouselStage.
 *
 * provider — required, { name, generateCarousel(prompt, context) }. The
 *   real Anthropic provider (createAnthropicProvider()) for a live run, or
 *   the mock provider for a mock run — this stage is provider-agnostic;
 *   only production-run-service.mjs decides which one to bind.
 * fields.maxAttempts — the attempt ceiling bound once, here, at
 *   construction time — see the module header for why this can't be
 *   sourced from the orchestrator's runOptions in this call path.
 * fields.onGenerated — optional `(carouselContent) => void`, called after
 *   a successful generation, before this stage returns. The one hook
 *   production-run-service.mjs uses to observe `carousel_content_id`
 *   without content-request-service.mjs's own Content Request Result
 *   shape needing to change — I016 stays completely unmodified.
 */
export function createLiveGenerateCarouselStage(provider, fields = {}) {
  return {
    name: "generate-carousel",
    async execute(context, options = {}) {
      try {
        const carouselContent = await generateCarouselFromTopicPackage(context.topicPackage, {
          ...options,
          now: options.clock,
          provider,
          maxAttempts: fields.maxAttempts,
        });

        fields.onGenerated?.(carouselContent);

        return ok({ carouselContent }, [
          {
            event_type: "content.generated",
            status: "succeeded",
            stage: "generate-carousel",
            source: "pipeline-orchestrator",
            data: { carousel_content_id: carouselContent.carousel_content_id, llm_model: provider.name },
          },
        ]);
      } catch (error) {
        return fail("generate-carousel", error);
      }
    },
  };
}

/**
 * Builds a live-bound replacement for RenderStage.
 *
 * transport — required, { name, send(request, options) }. The real
 *   Templated transport (createHttpTransport()) for a live run, or the
 *   mock transport for a mock run — provider-agnostic, same as above.
 * fields.maxAttempts — the attempt ceiling bound once, here.
 * fields.onSlideRendered — optional `(renderResult, index) => void`,
 *   called after each successful render, in slide order — the hook
 *   production-run-service.mjs uses to observe `renderedSlideCount`
 *   without I016's result shape needing to change.
 *
 * Stops at the first failing slide, exactly like RenderStage already
 * does: the for-loop's own thrown error propagates immediately out of
 * this function's try block, so no later slide is ever requested.
 */
export function createLiveRenderStage(transport, fields = {}) {
  return {
    name: "render",
    async execute(context, options = {}) {
      const startedRecord = {
        event_type: "render.started",
        status: "started",
        stage: "render",
        source: "pipeline-orchestrator",
        data: { payload_count: context.templatedPayloads?.length ?? 0 },
      };

      try {
        const renderResults = [];
        for (const payload of context.templatedPayloads) {
          const renderResult = await renderTemplatedPayload(payload, {
            ...options,
            now: options.clock,
            transport,
            maxAttempts: fields.maxAttempts,
          });
          renderResults.push(renderResult);
          fields.onSlideRendered?.(renderResult, renderResults.length - 1);
        }

        return ok({ renderResults }, [
          startedRecord,
          {
            event_type: "render.completed",
            status: "succeeded",
            stage: "render",
            source: "pipeline-orchestrator",
            data: { rendered_count: renderResults.length, provider: transport.name },
          },
        ]);
      } catch (error) {
        return fail(
          "render",
          error,
          [
            startedRecord,
            {
              event_type: "render.failed",
              status: "failed",
              stage: "render",
              source: "pipeline-orchestrator",
              diagnostics: {
                error_category: "renderer",
                error_code: error?.name ?? "UnknownError",
                safe_message: error?.message ?? "Render failed with no further detail",
              },
            },
          ]
        );
      }
    },
  };
}

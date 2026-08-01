// DC-003-I009 — the five pipeline stages, each implementing the shared
// Stage interface: execute(context, options) => StageResult. The
// orchestrator (pipeline-orchestrator.mjs) never inspects which stage
// produced a StageResult, or what any individual stage does internally —
// every stage below returns the exact same shape:
//
//   { success, updatedContext, executionRecords, warnings, error }
//
// `updatedContext` is a plain object of FIELDS to overlay onto the current
// PipelineContext (via withContext()) — not a full context itself; a stage
// never needs to know the other fields already on the context it received.
//
// `executionRecords` are PARTIAL ExecutionRecord field sets (event_type,
// status required; stage/source/data/diagnostics optional) — execution_id,
// sequence, record_id, and occurred_at are all orchestrator/ledger-owned
// (see pipeline-orchestrator.mjs), never a stage's own concern.
//
// Every stage defaults to a mock provider/transport — this milestone makes
// no live call of any kind (topic loading and payload mapping never call
// anything external in the first place). A future milestone can inject a
// real provider/transport via context.configuration without changing any
// stage's own code — see README "Pipeline Orchestrator" for how
// context.configuration.provider/transport are read.
//
// No stage calls another stage, and no stage writes to the Execution
// Ledger directly — both are the orchestrator's job alone, per the I009
// brief's "Fundamental Principle."

import { loadTopicPackage, prepareTopicPackage } from "./topic-package-loader.mjs";
import { generateCarouselFromTopicPackage } from "./carousel-generator.mjs";
import { createMockProvider } from "./carousel-mock-provider.mjs";
import { mapCarouselToTemplatedPayload } from "./carousel-payload-mapper.mjs";
import { renderTemplatedPayload } from "./renderer.mjs";
import { createMockTransport } from "./renderer-transport-mock.mjs";
import { createFinishedCarousel } from "./finished-carousel-builder.mjs";
import { createExecutionMetadata } from "./execution-metadata.mjs";
import { toSafeStageError, PipelineConfigurationError } from "./pipeline-errors.mjs";

function ok(updatedContext, executionRecords, warnings = []) {
  return { success: true, updatedContext, executionRecords, warnings, error: null };
}

function fail(stageName, error, executionRecords = []) {
  return { success: false, updatedContext: null, executionRecords, warnings: [], error: toSafeStageError(stageName, error) };
}

export const LoadTopicStage = {
  name: "load-topic",
  async execute(context, options = {}) {
    try {
      const source = context.configuration?.topicPackageSource;
      let topicPackage;
      if (source?.filePath) {
        topicPackage = loadTopicPackage(source.filePath, options);
      } else if (source?.data) {
        topicPackage = prepareTopicPackage(source.data, options);
      } else {
        throw new PipelineConfigurationError(
          "load-topic requires context.configuration.topicPackageSource: { filePath } or { data }"
        );
      }

      return ok({ topicPackage }, [
        {
          event_type: "topic.loaded",
          status: "succeeded",
          stage: "load-topic",
          source: "pipeline-orchestrator",
          data: { topic_id: topicPackage.topic_id },
        },
      ]);
    } catch (error) {
      return fail("load-topic", error);
    }
  },
};

export const GenerateCarouselStage = {
  name: "generate-carousel",
  async execute(context, options = {}) {
    try {
      const provider = context.configuration?.provider ?? createMockProvider();
      const carouselContent = await generateCarouselFromTopicPackage(context.topicPackage, {
        ...options,
        now: options.clock,
        provider,
      });

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

export const MapPayloadStage = {
  name: "map-payload",
  async execute(context, options = {}) {
    try {
      const templatedPayloads = mapCarouselToTemplatedPayload(context.carouselContent, {
        ...options,
        now: options.clock,
      });

      return ok({ templatedPayloads }, [
        {
          event_type: "payload.mapped",
          status: "succeeded",
          stage: "map-payload",
          source: "pipeline-orchestrator",
          data: { payload_count: templatedPayloads.length },
        },
      ]);
    } catch (error) {
      return fail("map-payload", error);
    }
  },
};

export const RenderStage = {
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
      const transport = context.configuration?.transport ?? createMockTransport();
      const renderResults = [];
      for (const payload of context.templatedPayloads) {
        const renderResult = await renderTemplatedPayload(payload, {
          ...options,
          now: options.clock,
          transport,
        });
        renderResults.push(renderResult);
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

export const BuildFinishedCarouselStage = {
  name: "build-finished-carousel",
  async execute(context, options = {}) {
    try {
      const slideRenders = context.templatedPayloads.map((templatedPayload, index) => ({
        templatedPayload,
        renderResult: context.renderResults[index],
      }));

      const clock = options.clock ?? (() => new Date().toISOString());
      const totalDurationMs = context.renderResults.reduce((sum, r) => sum + r.durationMs, 0);
      // createExecutionMetadata's `now` option returns a Date, unlike every
      // other DC-003-I009-touched module (which returns an ISO string) —
      // see pipeline-orchestrator.mjs's header comment for why this one
      // adapter exists.
      const executionMetadata = createExecutionMetadata(
        {
          executionId: context.executionId,
          provider: context.renderResults[0]?.provider,
          renderDurationMs: totalDurationMs,
        },
        { now: () => new Date(clock()) }
      );

      const finishedCarousel = createFinishedCarousel(
        { carouselContent: context.carouselContent, slideRenders, executionMetadata },
        { ...options, now: clock }
      );

      return ok({ finishedCarousel }, [
        {
          event_type: "finished_carousel.created",
          status: "succeeded",
          stage: "build-finished-carousel",
          source: "pipeline-orchestrator",
          data: { carousel_id: finishedCarousel.carousel_id },
        },
      ]);
    } catch (error) {
      return fail("build-finished-carousel", error);
    }
  },
};

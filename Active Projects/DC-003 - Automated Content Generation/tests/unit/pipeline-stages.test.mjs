import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPipelineContext } from "../../src/pipeline-context.mjs";
import {
  LoadTopicStage,
  GenerateCarouselStage,
  MapPayloadStage,
  RenderStage,
  BuildFinishedCarouselStage,
} from "../../src/pipeline-stages.mjs";
import { mapCarouselToTemplatedPayload } from "../../src/carousel-payload-mapper.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const TOPIC_PACKAGE_FIXTURE = path.join(FIXTURES_DIR, "topic-package.example.json");
const CAROUSEL_CONTENT_FIXTURE = path.join(FIXTURES_DIR, "carousel-content.example.json");

const FIXED_CLOCK = () => "2026-08-01T00:00:00.000Z";

function loadCarouselContent() {
  return JSON.parse(readFileSync(CAROUSEL_CONTENT_FIXTURE, "utf-8"));
}

// --- LoadTopicStage -------------------------------------------------------

test("LoadTopicStage: loads from a file path and emits topic.loaded", async () => {
  const context = createPipelineContext({ configuration: { topicPackageSource: { filePath: TOPIC_PACKAGE_FIXTURE } } });
  const result = await LoadTopicStage.execute(context, {});

  assert.equal(result.success, true);
  assert.equal(typeof result.updatedContext.topicPackage.topic_id, "string");
  assert.deepEqual(
    result.executionRecords.map((r) => r.event_type),
    ["topic.loaded"]
  );
  assert.equal(result.executionRecords[0].status, "succeeded");
});

test("LoadTopicStage: loads from in-memory data", async () => {
  const data = JSON.parse(readFileSync(TOPIC_PACKAGE_FIXTURE, "utf-8"));
  const context = createPipelineContext({ configuration: { topicPackageSource: { data } } });
  const result = await LoadTopicStage.execute(context, {});
  assert.equal(result.success, true);
  assert.equal(result.updatedContext.topicPackage.topic_id, data.topic_id);
});

test("LoadTopicStage: fails safely when configuration is missing", async () => {
  const context = createPipelineContext();
  const result = await LoadTopicStage.execute(context, {});
  assert.equal(result.success, false);
  assert.equal(result.error.stage, "load-topic");
  assert.equal(result.error.code, "PipelineConfigurationError");
});

test("LoadTopicStage: fails safely for a nonexistent file, naming the real error", async () => {
  const context = createPipelineContext({ configuration: { topicPackageSource: { filePath: path.join(FIXTURES_DIR, "does-not-exist.json") } } });
  const result = await LoadTopicStage.execute(context, {});
  assert.equal(result.success, false);
  assert.equal(result.error.code, "TopicPackageNotFoundError");
});

// --- GenerateCarouselStage -------------------------------------------------

test("GenerateCarouselStage: succeeds with the default mock provider and emits content.generated", async () => {
  const topicPackage = JSON.parse(readFileSync(TOPIC_PACKAGE_FIXTURE, "utf-8"));
  const context = createPipelineContext({ topicPackage });
  const result = await GenerateCarouselStage.execute(context, { clock: FIXED_CLOCK });

  assert.equal(result.success, true);
  assert.equal(result.updatedContext.carouselContent.slides.length, 6);
  assert.deepEqual(
    result.executionRecords.map((r) => r.event_type),
    ["content.generated"]
  );
  assert.equal(result.executionRecords[0].data.llm_model, "mock-provider-v1");
});

// --- MapPayloadStage --------------------------------------------------------

test("MapPayloadStage: succeeds and emits payload.mapped with the right count", async () => {
  const context = createPipelineContext({ carouselContent: loadCarouselContent() });
  const result = await MapPayloadStage.execute(context, { clock: FIXED_CLOCK });

  assert.equal(result.success, true);
  assert.equal(result.updatedContext.templatedPayloads.length, 6);
  assert.equal(result.executionRecords[0].event_type, "payload.mapped");
  assert.equal(result.executionRecords[0].data.payload_count, 6);
});

// --- RenderStage ------------------------------------------------------------

test("RenderStage: succeeds with the default mock transport and emits started+completed", async () => {
  const templatedPayloads = mapCarouselToTemplatedPayload(loadCarouselContent());
  const context = createPipelineContext({ templatedPayloads });
  const result = await RenderStage.execute(context, { clock: FIXED_CLOCK });

  assert.equal(result.success, true);
  assert.equal(result.updatedContext.renderResults.length, 6);
  assert.deepEqual(
    result.executionRecords.map((r) => r.event_type),
    ["render.started", "render.completed"]
  );
});

test("RenderStage: a failing transport fails the stage safely and emits render.started+render.failed", async () => {
  const templatedPayloads = mapCarouselToTemplatedPayload(loadCarouselContent());
  const failingTransport = createMockTransport({ mode: "timeout" });
  const context = createPipelineContext({ templatedPayloads, configuration: { transport: failingTransport } });
  const result = await RenderStage.execute(context, { clock: FIXED_CLOCK, maxAttempts: 1 });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.executionRecords.map((r) => r.event_type),
    ["render.started", "render.failed"]
  );
  assert.equal(result.executionRecords[1].status, "failed");
  assert.equal(result.executionRecords[1].diagnostics.error_code, "RetryLimitExceeded");
  assert.equal(result.error.stage, "render");
});

// --- BuildFinishedCarouselStage ---------------------------------------------

test("BuildFinishedCarouselStage: composes a Finished Carousel and ties execution_metadata.execution_id to the pipeline's own executionId", async () => {
  const carouselContent = loadCarouselContent();
  const templatedPayloads = mapCarouselToTemplatedPayload(carouselContent);
  const transport = createMockTransport();
  const { renderTemplatedPayload } = await import("../../src/renderer.mjs");
  const renderResults = [];
  for (const payload of templatedPayloads) {
    renderResults.push(await renderTemplatedPayload(payload, { transport }));
  }

  const executionId = "exec_20260801_9f3a2e1c8b4d";
  const context = createPipelineContext({ executionId, carouselContent, templatedPayloads, renderResults });
  const result = await BuildFinishedCarouselStage.execute(context, { clock: FIXED_CLOCK });

  assert.equal(result.success, true);
  assert.equal(result.updatedContext.finishedCarousel.execution_metadata.execution_id, executionId);
  assert.equal(result.executionRecords[0].event_type, "finished_carousel.created");
  assert.equal(result.executionRecords[0].data.carousel_id, result.updatedContext.finishedCarousel.carousel_id);
});

test("BuildFinishedCarouselStage: fails safely for inconsistent inputs (wrong slide order)", async () => {
  const carouselContent = loadCarouselContent();
  const templatedPayloads = mapCarouselToTemplatedPayload(carouselContent);
  const transport = createMockTransport();
  const { renderTemplatedPayload } = await import("../../src/renderer.mjs");
  const renderResults = [];
  for (const payload of templatedPayloads) {
    renderResults.push(await renderTemplatedPayload(payload, { transport }));
  }
  // Deliberately mismatch payloads/results order against carouselContent.
  const shuffledPayloads = [templatedPayloads[1], templatedPayloads[0], ...templatedPayloads.slice(2)];

  const context = createPipelineContext({
    executionId: "exec_20260801_9f3a2e1c8b4d",
    carouselContent,
    templatedPayloads: shuffledPayloads,
    renderResults,
  });
  const result = await BuildFinishedCarouselStage.execute(context, { clock: FIXED_CLOCK });

  assert.equal(result.success, false);
  assert.equal(result.error.stage, "build-finished-carousel");
  assert.equal(result.error.code, "FinishedCarouselCompositionError");
});

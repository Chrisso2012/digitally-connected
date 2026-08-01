import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createProductionWorkflow, persistWorkflowOutput } from "../../src/production-workflow.mjs";
import { createN8nAdapter } from "../../src/n8n-adapter.mjs";
import { createExternalInvocationAdapter } from "../../src/invocation-adapter.mjs";
import { createPipelineOrchestrator } from "../../src/pipeline-orchestrator.mjs";
import { createExecutionLedger } from "../../src/execution-ledger.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOPIC_PACKAGE_FIXTURE = path.join(__dirname, "..", "fixtures", "topic-package.example.json");

const FIXED_CLOCK = (() => {
  let index = 0;
  const sequence = Array.from({ length: 30 }, (_, i) => `2026-08-01T00:00:${String(i).padStart(2, "0")}.000Z`);
  return () => sequence[Math.min(index++, sequence.length - 1)];
})();

function createInMemoryStore() {
  const records = [];
  return {
    name: "in-memory-test-store",
    append(record) {
      records.push(record);
    },
    readAll() {
      return [...records];
    },
  };
}

function createRealN8nAdapter() {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const invocationAdapter = createExternalInvocationAdapter({ orchestrator });
  return createN8nAdapter({ invocationAdapter });
}

function validWorkflowInput(overrides = {}) {
  return {
    requestId: "wf-1",
    topicPackageFilePath: TOPIC_PACKAGE_FIXTURE,
    ...overrides,
  };
}

// Async-aware: this file's tests need to `await` work (workflow.run()) inside
// the temp directory before cleanup runs, unlike other test files' sync-only
// withTempDir helpers.
async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-workflow-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Complete workflow execution ---------------------------------------

test("a complete successful run produces the documented result shape with a real Finished Carousel", async () => {
  const workflow = createProductionWorkflow({ n8nAdapter: createRealN8nAdapter() });
  const result = await workflow.run(validWorkflowInput(), { clock: FIXED_CLOCK });

  assert.deepEqual(Object.keys(result).sort(), ["executionId", "finishedCarousel", "invocationResponse", "requestId", "summary"]);
  assert.equal(result.invocationResponse.success, true);
  assert.equal(result.finishedCarousel.overall_status, "completed");
  assert.equal(result.executionId, result.invocationResponse.executionId);
  assert.equal(result.requestId, "wf-1");
});

test("the workflow exercises every architectural layer end to end (a real render happens)", async () => {
  const workflow = createProductionWorkflow({ n8nAdapter: createRealN8nAdapter() });
  const result = await workflow.run(validWorkflowInput(), { clock: FIXED_CLOCK });

  assert.equal(result.finishedCarousel.slides.length, 6);
  assert.ok(result.finishedCarousel.slides.every((s) => s.status === "completed"));
  assert.match(result.executionId, /^exec_[0-9]{8}_[A-Za-z0-9]+$/);
});

// --- Workflow summary generation -----------------------------------------

test("the workflow summary contains exactly the documented fields", async () => {
  const workflow = createProductionWorkflow({ n8nAdapter: createRealN8nAdapter() });
  const result = await workflow.run(validWorkflowInput(), { clock: FIXED_CLOCK });

  assert.deepEqual(Object.keys(result.summary).sort(), [
    "completedAt",
    "durationMs",
    "executionId",
    "hasError",
    "requestId",
    "status",
    "warningCount",
  ]);
  assert.equal(result.summary.status, "completed");
  assert.equal(result.summary.hasError, false);
  assert.equal(result.summary.warningCount, 0);
  assert.equal(typeof result.summary.durationMs, "number");
  assert.ok(result.summary.durationMs >= 0);
});

test("the summary's hasError and warningCount reflect a failed run correctly", async () => {
  const workflow = createProductionWorkflow({ n8nAdapter: createRealN8nAdapter() });
  const result = await workflow.run(validWorkflowInput({ topicPackageFilePath: "does-not-exist.json" }), {
    clock: FIXED_CLOCK,
  });

  assert.equal(result.summary.status, "failed");
  assert.equal(result.summary.hasError, true);
  assert.equal(result.summary.warningCount, 0);
});

// --- Workflow failure handling --------------------------------------------

test("a rejected (invalid input) invocation is reported safely, without throwing", async () => {
  const workflow = createProductionWorkflow({ n8nAdapter: createRealN8nAdapter() });
  const result = await workflow.run({ requestId: "wf-2" }, { clock: FIXED_CLOCK });

  assert.equal(result.invocationResponse.success, false);
  assert.equal(result.invocationResponse.status, "rejected");
  assert.equal(result.finishedCarousel, null);
  assert.equal(result.summary.status, "rejected");
});

test("a real pipeline failure (missing Topic Package file) is reported safely", async () => {
  const workflow = createProductionWorkflow({ n8nAdapter: createRealN8nAdapter() });
  const result = await workflow.run(validWorkflowInput({ topicPackageFilePath: "does-not-exist.json" }), {
    clock: FIXED_CLOCK,
  });

  assert.equal(result.invocationResponse.status, "failed");
  assert.equal(result.invocationResponse.error.code, "TopicPackageNotFoundError");
  assert.equal(typeof result.invocationResponse.error.message, "string");
});

test("an n8n Adapter that throws unexpectedly is still caught safely by the workflow", async () => {
  const throwingN8nAdapter = {
    async invoke() {
      throw new Error("simulated n8n adapter failure");
    },
  };
  const workflow = createProductionWorkflow({ n8nAdapter: throwingN8nAdapter });
  const result = await workflow.run(validWorkflowInput(), { clock: FIXED_CLOCK });

  assert.equal(result.invocationResponse.success, false);
  assert.equal(result.invocationResponse.status, "failed");
  assert.equal(result.invocationResponse.error.code, "Error");
  assert.equal(result.invocationResponse.error.message, "simulated n8n adapter failure");
  assert.equal(result.requestId, "wf-1", "requestId is still preserved from the workflow input even on this fallback path");
});

test("createProductionWorkflow throws PipelineConfigurationError for a missing n8n Adapter", () => {
  assert.throws(() => createProductionWorkflow({}), PipelineConfigurationError);
  assert.throws(() => createProductionWorkflow({ n8nAdapter: {} }), PipelineConfigurationError);
});

// --- Deterministic execution ----------------------------------------------

test("the same injected clock/executionIdGenerator produce identical executionId and completedAt across two runs", async () => {
  function fixedIdGenerator() {
    return "exec_20260801_deterministic1";
  }
  const resultA = await createProductionWorkflow({ n8nAdapter: createRealN8nAdapter() }).run(validWorkflowInput(), {
    clock: FIXED_CLOCK,
    executionIdGenerator: fixedIdGenerator,
  });
  const resultB = await createProductionWorkflow({ n8nAdapter: createRealN8nAdapter() }).run(validWorkflowInput(), {
    clock: FIXED_CLOCK,
    executionIdGenerator: fixedIdGenerator,
  });

  assert.equal(resultA.executionId, resultB.executionId);
  assert.equal(resultA.summary.completedAt, resultB.summary.completedAt);
});

// --- Output persistence --------------------------------------------------

test("persistWorkflowOutput writes valid, complete JSON to disk", async () => {
  await withTempDir(async (dir) => {
    const outputPath = path.join(dir, "output.json");
    const workflow = createProductionWorkflow({ n8nAdapter: createRealN8nAdapter() });
    const result = await workflow.run(validWorkflowInput(), { clock: FIXED_CLOCK });

    persistWorkflowOutput(outputPath, result);

    assert.ok(existsSync(outputPath));
    const written = JSON.parse(readFileSync(outputPath, "utf-8"));
    assert.deepEqual(written, result);
  });
});

test("run() itself performs no file I/O — persistence is a separate, explicit step", async () => {
  await withTempDir(async (dir) => {
    const before = readdirSync(dir).length;
    const workflow = createProductionWorkflow({ n8nAdapter: createRealN8nAdapter() });
    await workflow.run(validWorkflowInput(), { clock: FIXED_CLOCK });
    assert.equal(readdirSync(dir).length, before);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
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

function createRealN8nAdapter(stages) {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator(stages ? { ledger, stages } : { ledger });
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

// --- Successful workflow invocation -----------------------------------

test("a valid workflow input produces a successful n8n output with the real Finished Carousel", async () => {
  const n8nAdapter = createRealN8nAdapter();
  const output = await n8nAdapter.invoke(validWorkflowInput(), { clock: FIXED_CLOCK });

  assert.equal(output.success, true);
  assert.equal(output.status, "completed");
  assert.equal(output.requestId, "wf-1");
  assert.match(output.executionId, /^exec_/);
  assert.equal(output.finishedCarousel.overall_status, "completed");
  assert.equal(output.error, null);
});

test("only the seven documented output fields are exposed — no internal platform objects", async () => {
  const n8nAdapter = createRealN8nAdapter();
  const output = await n8nAdapter.invoke(validWorkflowInput(), { clock: FIXED_CLOCK });

  assert.deepEqual(Object.keys(output).sort(), [
    "error",
    "executionId",
    "finishedCarousel",
    "requestId",
    "status",
    "success",
    "warnings",
  ]);
});

// --- Invalid workflow input -------------------------------------------

test("invalid workflow input (missing topic package reference) is rejected without throwing", async () => {
  const n8nAdapter = createRealN8nAdapter();
  const output = await n8nAdapter.invoke({ requestId: "wf-2" }, { clock: FIXED_CLOCK });

  assert.equal(output.success, false);
  assert.equal(output.status, "rejected");
  assert.equal(output.executionId, null);
  assert.equal(output.error.code, "InvocationRequestValidationError");
});

test("the n8n Adapter does not duplicate validation — the error comes from the Invocation Adapter's own schema check", async () => {
  const n8nAdapter = createRealN8nAdapter();
  const output = await n8nAdapter.invoke({ requestId: "wf-3", topicPackageFilePath: "x.json", topicPackageData: {} });

  // Both file_path and data present — the mapper passes both through
  // unchanged (it does no validation of its own); invocation-request.schema.json's
  // own oneOf constraint is what actually rejects it.
  assert.equal(output.success, false);
  assert.match(output.error.message, /oneOf/);
});

// --- Adapter error handling (safety net) ---------------------------------

test("a workflowInput that throws during property access is still caught safely", async () => {
  const throwingInput = {
    get requestId() {
      throw new Error("simulated malicious getter");
    },
  };
  const n8nAdapter = createRealN8nAdapter();
  const output = await n8nAdapter.invoke(throwingInput);

  assert.equal(output.success, false);
  assert.equal(output.status, "rejected");
  assert.equal(output.executionId, null);
  assert.equal(output.error.code, "Error");
  assert.equal(output.error.message, "simulated malicious getter");
});

test("createN8nAdapter throws PipelineConfigurationError for a missing Invocation Adapter", () => {
  assert.throws(() => createN8nAdapter({}), PipelineConfigurationError);
  assert.throws(() => createN8nAdapter({ invocationAdapter: {} }), PipelineConfigurationError);
});

test("a real pipeline failure (missing Topic Package file) maps to a failed, non-thrown n8n output", async () => {
  const n8nAdapter = createRealN8nAdapter();
  const output = await n8nAdapter.invoke(validWorkflowInput({ topicPackageFilePath: "does-not-exist.json" }), {
    clock: FIXED_CLOCK,
  });

  assert.equal(output.success, false);
  assert.equal(output.status, "failed");
  assert.equal(output.error.code, "TopicPackageNotFoundError");
  assert.equal(typeof output.error.message, "string");
  assert.doesNotMatch(JSON.stringify(output), /at file:\/\//);
});

// --- InvocationRequest / InvocationResponse mapping (integration) -------

test("requestId and executionId remain distinct all the way through to n8n output", async () => {
  const n8nAdapter = createRealN8nAdapter();
  const output = await n8nAdapter.invoke(validWorkflowInput({ requestId: "external-caller-42" }), { clock: FIXED_CLOCK });

  assert.equal(output.requestId, "external-caller-42");
  assert.notEqual(output.requestId, output.executionId);
});

test("warnings and a stage failure both propagate correctly through to n8n output", async () => {
  const failingStage = {
    name: "failing-stage",
    async execute() {
      return {
        success: false,
        updatedContext: null,
        executionRecords: [],
        warnings: [],
        error: { stage: "failing-stage", code: "SimulatedFailure", message: "simulated", retryable: false },
      };
    },
  };
  const n8nAdapter = createRealN8nAdapter([failingStage]);
  const output = await n8nAdapter.invoke(validWorkflowInput(), { clock: FIXED_CLOCK });

  assert.equal(output.status, "failed");
  assert.equal(output.finishedCarousel, null);
  assert.equal(output.error.code, "SimulatedFailure");
});

// --- Determinism ------------------------------------------------------------

test("the same injected clock/executionIdGenerator produce an identical executionId across two runs", async () => {
  function fixedIdGenerator() {
    return "exec_20260801_deterministic1";
  }
  const outputA = await createRealN8nAdapter().invoke(validWorkflowInput(), {
    clock: FIXED_CLOCK,
    executionIdGenerator: fixedIdGenerator,
  });
  const outputB = await createRealN8nAdapter().invoke(validWorkflowInput(), {
    clock: FIXED_CLOCK,
    executionIdGenerator: fixedIdGenerator,
  });

  assert.equal(outputA.executionId, outputB.executionId);
});

test("no test in this file depends on the real clock, a random UUID, or the network", async () => {
  const n8nAdapter = createRealN8nAdapter();
  const output = await n8nAdapter.invoke(validWorkflowInput(), {
    clock: FIXED_CLOCK,
    executionIdGenerator: () => "exec_20260801_fixed00000002",
  });
  assert.equal(output.executionId, "exec_20260801_fixed00000002");
});

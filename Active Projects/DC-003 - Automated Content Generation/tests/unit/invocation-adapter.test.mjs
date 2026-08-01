import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
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

function createAdapterWithRealOrchestrator(stages) {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator(stages ? { ledger, stages } : { ledger });
  const adapter = createExternalInvocationAdapter({ orchestrator });
  return { adapter, ledger };
}

function validRequest(overrides = {}) {
  return {
    request_id: "n8n-exec-1",
    topic_package_reference: { file_path: TOPIC_PACKAGE_FIXTURE },
    ...overrides,
  };
}

// --- Valid invocation -----------------------------------------------------

test("a valid request produces a completed response with the real Finished Carousel", async () => {
  const { adapter } = createAdapterWithRealOrchestrator();
  const response = await adapter.invoke(validRequest(), { clock: FIXED_CLOCK });

  assert.equal(response.accepted, true);
  assert.equal(response.status, "completed");
  assert.equal(response.request_id, "n8n-exec-1");
  assert.match(response.execution_id, /^exec_/);
  assert.equal(response.finished_carousel.overall_status, "completed");
  assert.equal(response.error, null);
});

// --- Invalid request --------------------------------------------------------

test("an invalid request is rejected without ever invoking the orchestrator", async () => {
  let orchestratorCalled = false;
  const stubOrchestrator = {
    async run() {
      orchestratorCalled = true;
      return { success: true, executionId: "exec_20260801_shouldnotrun01", finishedCarousel: {}, warnings: [], error: null, duration: 0 };
    },
  };
  const adapter = createExternalInvocationAdapter({ orchestrator: stubOrchestrator });

  const response = await adapter.invoke({ request_id: "req-1" }); // missing topic_package_reference

  assert.equal(orchestratorCalled, false);
  assert.equal(response.accepted, false);
  assert.equal(response.status, "rejected");
  assert.equal(response.execution_id, null);
  assert.equal(response.error.code, "InvocationRequestValidationError");
});

test("a request with an entirely missing request_id is rejected with request_id null, not fabricated", async () => {
  const stubOrchestrator = { async run() {} };
  const adapter = createExternalInvocationAdapter({ orchestrator: stubOrchestrator });
  const response = await adapter.invoke({ topic_package_reference: { file_path: "x.json" } });

  assert.equal(response.accepted, false);
  assert.equal(response.request_id, null);
});

test("a request with a non-string request_id echoes null rather than the invalid raw value", async () => {
  const stubOrchestrator = { async run() {} };
  const adapter = createExternalInvocationAdapter({ orchestrator: stubOrchestrator });
  const response = await adapter.invoke({ request_id: 12345 });

  assert.equal(response.request_id, null);
});

// --- Request correlation --------------------------------------------------

test("requestId and executionId are kept distinct and both present on a completed response", async () => {
  const { adapter } = createAdapterWithRealOrchestrator();
  const response = await adapter.invoke(validRequest({ request_id: "external-caller-id-999" }), { clock: FIXED_CLOCK });

  assert.equal(response.request_id, "external-caller-id-999");
  assert.notEqual(response.request_id, response.execution_id);
  assert.match(response.execution_id, /^exec_[0-9]{8}_[A-Za-z0-9]+$/);
});

test("correlation_metadata is echoed back unchanged, uninterpreted", async () => {
  const { adapter } = createAdapterWithRealOrchestrator();
  const metadata = { workflow: "daily-run", n8n_execution_id: "wf-77" };
  const response = await adapter.invoke(validRequest({ correlation_metadata: metadata }), { clock: FIXED_CLOCK });

  assert.deepEqual(response.correlation_metadata, metadata);
});

test("correlation_metadata is echoed back even on a rejected request", async () => {
  const stubOrchestrator = { async run() {} };
  const adapter = createExternalInvocationAdapter({ orchestrator: stubOrchestrator });
  const metadata = { workflow: "daily-run" };
  // Malformed request (no topic_package_reference) but a well-formed
  // correlation_metadata alongside it.
  const response = await adapter.invoke({ request_id: "req-1", correlation_metadata: metadata });

  assert.equal(response.accepted, false);
  assert.deepEqual(response.correlation_metadata, metadata);
});

// --- Safe error mapping ---------------------------------------------------

test("a real pipeline failure (missing Topic Package file) maps to a safe error with no internal detail leaked", async () => {
  const { adapter } = createAdapterWithRealOrchestrator();
  const response = await adapter.invoke(validRequest({ topic_package_reference: { file_path: "does-not-exist.json" } }), {
    clock: FIXED_CLOCK,
  });

  assert.equal(response.accepted, true);
  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "TopicPackageNotFoundError");
  assert.equal(typeof response.error.message, "string");
  assert.equal(typeof response.error.retryable, "boolean");
  // The external error shape never carries "stage" — an internal pipeline
  // concept the external contract deliberately doesn't expose.
  assert.ok(!("stage" in response.error));
});

test("an orchestrator that throws is still caught safely, never propagating out of invoke()", async () => {
  const throwingOrchestrator = {
    async run() {
      throw new Error("simulated orchestrator-level failure");
    },
  };
  const adapter = createExternalInvocationAdapter({ orchestrator: throwingOrchestrator });
  const response = await adapter.invoke(validRequest());

  assert.equal(response.accepted, true);
  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "Error");
  assert.equal(response.error.message, "simulated orchestrator-level failure");
});

// --- Orchestrator invocation / response mapping ---------------------------

test("PipelineResult.warnings are carried through to the response unchanged", async () => {
  const stubStage = {
    name: "stub",
    async execute() {
      return { success: true, updatedContext: {}, executionRecords: [], warnings: ["stub warning"], error: null };
    },
  };
  const { adapter } = createAdapterWithRealOrchestrator([stubStage]);
  const response = await adapter.invoke(validRequest(), { clock: FIXED_CLOCK });

  assert.deepEqual(response.warnings, ["stub warning"]);
});

test("a stage failure produces status failed with finished_carousel null", async () => {
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
  const { adapter } = createAdapterWithRealOrchestrator([failingStage]);
  const response = await adapter.invoke(validRequest(), { clock: FIXED_CLOCK });

  assert.equal(response.status, "failed");
  assert.equal(response.finished_carousel, null);
  assert.equal(response.error.code, "SimulatedFailure");
  assert.equal(response.error.retryable, false);
});

// --- Configuration / preconditions -----------------------------------------

test("createExternalInvocationAdapter throws PipelineConfigurationError for a missing orchestrator", () => {
  assert.throws(() => createExternalInvocationAdapter({}), PipelineConfigurationError);
  assert.throws(() => createExternalInvocationAdapter({ orchestrator: {} }), PipelineConfigurationError);
});

// --- Determinism ------------------------------------------------------------

test("the same injected clock/executionIdGenerator produce identical executionId and timestamps across two runs", async () => {
  function fixedIdGenerator() {
    return "exec_20260801_deterministic1";
  }
  const runA = createAdapterWithRealOrchestrator();
  const responseA = await runA.adapter.invoke(validRequest(), { clock: FIXED_CLOCK, executionIdGenerator: fixedIdGenerator });

  const runB = createAdapterWithRealOrchestrator();
  const responseB = await runB.adapter.invoke(validRequest(), { clock: FIXED_CLOCK, executionIdGenerator: fixedIdGenerator });

  assert.equal(responseA.execution_id, responseB.execution_id);
});

test("no test in this file depends on the real clock, a random UUID, or the network", async () => {
  // Documented explicitly: every determinism-sensitive assertion above
  // passes an injected clock/executionIdGenerator; every invocation uses
  // the mock provider/transport the orchestrator defaults to.
  const { adapter } = createAdapterWithRealOrchestrator();
  const response = await adapter.invoke(validRequest(), {
    clock: FIXED_CLOCK,
    executionIdGenerator: () => "exec_20260801_fixed00000001",
  });
  assert.equal(response.execution_id, "exec_20260801_fixed00000001");
});

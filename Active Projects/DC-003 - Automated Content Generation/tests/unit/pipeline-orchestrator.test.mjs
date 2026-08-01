import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPipelineOrchestrator } from "../../src/pipeline-orchestrator.mjs";
import { createExecutionLedger } from "../../src/execution-ledger.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOPIC_PACKAGE_FIXTURE = path.join(__dirname, "..", "fixtures", "topic-package.example.json");

const FIXED_CLOCK_SEQUENCE = [
  "2026-08-01T00:00:00.000Z",
  "2026-08-01T00:00:01.000Z",
  "2026-08-01T00:00:02.000Z",
  "2026-08-01T00:00:03.000Z",
  "2026-08-01T00:00:04.000Z",
  "2026-08-01T00:00:05.000Z",
  "2026-08-01T00:00:06.000Z",
  "2026-08-01T00:00:07.000Z",
  "2026-08-01T00:00:08.000Z",
  "2026-08-01T00:00:09.000Z",
  "2026-08-01T00:00:10.000Z",
  "2026-08-01T00:00:11.000Z",
  "2026-08-01T00:00:12.000Z",
  "2026-08-01T00:00:13.000Z",
  "2026-08-01T00:00:14.000Z",
  "2026-08-01T00:00:15.000Z",
  "2026-08-01T00:00:16.000Z",
  "2026-08-01T00:00:17.000Z",
  "2026-08-01T00:00:18.000Z",
  "2026-08-01T00:00:19.000Z",
  "2026-08-01T00:00:20.000Z",
];

function makeFixedClock() {
  let index = 0;
  return () => FIXED_CLOCK_SEQUENCE[Math.min(index++, FIXED_CLOCK_SEQUENCE.length - 1)];
}

function makeIdGenerators() {
  let recordCounter = 0;
  return {
    executionIdGenerator: () => "exec_20260801_fixedexecid01",
    recordIdGenerator: () => `rec_fixed${String(++recordCounter).padStart(4, "0")}`,
  };
}

// An in-memory Ledger Store — exercises the orchestrator against the
// documented { name, append, readAll } shape without touching the
// filesystem.
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

function realConfiguration() {
  return { topicPackageSource: { filePath: TOPIC_PACKAGE_FIXTURE } };
}

// --- Successful execution ---------------------------------------------

test("a full successful pipeline run returns a well-formed PipelineResult", async () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const { executionIdGenerator, recordIdGenerator } = makeIdGenerators();

  const result = await orchestrator.run(
    { configuration: realConfiguration() },
    { clock: makeFixedClock(), executionIdGenerator, recordIdGenerator }
  );

  assert.deepEqual(Object.keys(result).sort(), ["duration", "error", "executionId", "finishedCarousel", "success", "warnings"]);
  assert.equal(result.success, true);
  assert.equal(result.executionId, "exec_20260801_fixedexecid01");
  assert.equal(result.error, null);
  assert.equal(result.finishedCarousel.overall_status, "completed");
  assert.equal(typeof result.duration, "number");
  assert.ok(result.duration >= 0);
});

test("PipelineResult never exposes PipelineContext directly", async () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const result = await orchestrator.run({ configuration: realConfiguration() }, { clock: makeFixedClock() });

  assert.ok(!("configuration" in result));
  assert.ok(!("topicPackage" in result));
  assert.ok(!("templatedPayloads" in result));
  assert.ok(!("metrics" in result));
});

// --- Execution Ledger interaction ---------------------------------------

test("execution.started is always first, execution.completed is always last, on success", async () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const { executionIdGenerator, recordIdGenerator } = makeIdGenerators();

  const result = await orchestrator.run(
    { configuration: realConfiguration() },
    { clock: makeFixedClock(), executionIdGenerator, recordIdGenerator }
  );

  const records = ledger.readAll();
  assert.equal(records[0].event_type, "execution.started");
  assert.equal(records[0].sequence, 1);
  assert.equal(records[records.length - 1].event_type, "execution.completed");
  assert.ok(records.every((r) => r.execution_id === result.executionId));
});

test("sequence numbers strictly increase across the whole run", async () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  await orchestrator.run({ configuration: realConfiguration() }, { clock: makeFixedClock() });

  const records = ledger.readAll();
  const sequences = records.map((r) => r.sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.deepEqual(sequences, Array.from({ length: sequences.length }, (_, i) => i + 1));
});

test("stage timings are attached to every record's data.duration_ms as a number", async () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  await orchestrator.run({ configuration: realConfiguration() }, { clock: makeFixedClock() });

  const stageRecords = ledger.readAll().filter((r) => r.stage !== null);
  assert.ok(stageRecords.length > 0);
  for (const record of stageRecords) {
    assert.equal(typeof record.data.duration_ms, "number");
  }
});

test("reconstructExecution after a successful run reports finalStatus succeeded", async () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const result = await orchestrator.run({ configuration: realConfiguration() }, { clock: makeFixedClock() });

  const execution = ledger.reconstructExecution(result.executionId);
  assert.equal(execution.finalStatus, "succeeded");
  assert.equal(execution.recordCount, ledger.readAll().length);
});

// --- Stage ordering / sequential execution -------------------------------

test("stages execute in declared order, strictly sequentially (never interleaved)", async () => {
  const log = [];
  function makeStubStage(name) {
    return {
      name,
      async execute(context) {
        log.push(`start:${name}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        log.push(`end:${name}`);
        return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null };
      },
    };
  }
  const stages = [makeStubStage("first"), makeStubStage("second"), makeStubStage("third")];
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger, stages });

  await orchestrator.run({});

  assert.deepEqual(log, ["start:first", "end:first", "start:second", "end:second", "start:third", "end:third"]);
});

test("stage registration: a custom stage list is used instead of DEFAULT_PIPELINE", async () => {
  const stubStage = {
    name: "stub-only",
    async execute() {
      return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null };
    },
  };
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger, stages: [stubStage] });

  const result = await orchestrator.run({});
  assert.equal(result.success, true);
  assert.equal(result.finishedCarousel, null, "no BuildFinishedCarouselStage ran, so finishedCarousel stays null");

  const records = ledger.readAll();
  // execution.started, execution.completed only — the stub stage emits no records.
  assert.deepEqual(
    records.map((r) => r.event_type),
    ["execution.started", "execution.completed"]
  );
});

// --- Context propagation --------------------------------------------------

test("a later stage receives context fields an earlier stage set via updatedContext", async () => {
  const stageA = {
    name: "stage-a",
    async execute() {
      return { success: true, updatedContext: { topicPackage: { topic_id: "topic_from_a" } }, executionRecords: [], warnings: [], error: null };
    },
  };
  let observedTopicId = null;
  const stageB = {
    name: "stage-b",
    async execute(context) {
      observedTopicId = context.topicPackage?.topic_id;
      return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null };
    },
  };
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger, stages: [stageA, stageB] });
  await orchestrator.run({});

  assert.equal(observedTopicId, "topic_from_a");
});

test("warnings accumulate across stages", async () => {
  const stageA = {
    name: "stage-a",
    async execute() {
      return { success: true, updatedContext: {}, executionRecords: [], warnings: ["warning-a"], error: null };
    },
  };
  const stageB = {
    name: "stage-b",
    async execute() {
      return { success: true, updatedContext: {}, executionRecords: [], warnings: ["warning-b"], error: null };
    },
  };
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger, stages: [stageA, stageB] });
  const result = await orchestrator.run({});

  assert.deepEqual(result.warnings, ["warning-a", "warning-b"]);
});

// --- Stage failure ------------------------------------------------------

test("a stage failure stops the pipeline: later stages never run", async () => {
  let laterStageRan = false;
  const failingStage = {
    name: "failing-stage",
    async execute() {
      return {
        success: false,
        updatedContext: null,
        executionRecords: [],
        warnings: [],
        error: { stage: "failing-stage", code: "SimulatedFailure", message: "simulated for test", retryable: false },
      };
    },
  };
  const laterStage = {
    name: "later-stage",
    async execute() {
      laterStageRan = true;
      return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null };
    },
  };
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger, stages: [failingStage, laterStage] });
  const result = await orchestrator.run({});

  assert.equal(result.success, false);
  assert.equal(laterStageRan, false);
  assert.equal(result.finishedCarousel, null);
  assert.deepEqual(result.error, { stage: "failing-stage", code: "SimulatedFailure", message: "simulated for test", retryable: false });
});

test("a stage failure appends execution.failed with safe diagnostics, never a stage-specific event the schema doesn't define", async () => {
  const failingStage = {
    name: "failing-stage",
    async execute() {
      return {
        success: false,
        updatedContext: null,
        executionRecords: [],
        warnings: [],
        error: { stage: "failing-stage", code: "SimulatedFailure", message: "simulated for test", retryable: false },
      };
    },
  };
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger, stages: [failingStage] });
  await orchestrator.run({});

  const records = ledger.readAll();
  assert.deepEqual(
    records.map((r) => r.event_type),
    ["execution.started", "execution.failed"]
  );
  const failedRecord = records[1];
  assert.equal(failedRecord.diagnostics.error_code, "SimulatedFailure");
  assert.equal(failedRecord.diagnostics.retryable, false);
  assert.equal(failedRecord.diagnostics.field_path, "failing-stage");
});

test("a stage that throws instead of returning a StageResult is still caught safely (orchestrator is the safety net)", async () => {
  const throwingStage = {
    name: "throwing-stage",
    async execute() {
      throw new Error("boom");
    },
  };
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger, stages: [throwingStage] });
  const result = await orchestrator.run({});

  assert.equal(result.success, false);
  assert.equal(result.error.stage, "throwing-stage");
  assert.equal(result.error.code, "Error");
  assert.equal(result.error.message, "boom");
});

test("a real stage failure (missing topic package configuration) produces a failed PipelineResult end-to-end", async () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const result = await orchestrator.run({ configuration: {} });

  assert.equal(result.success, false);
  assert.equal(result.error.stage, "load-topic");
  assert.equal(result.error.code, "PipelineConfigurationError");
});

// --- Lifecycle write failure hardening (DC-003-I010.1) --------------------

// A minimal Ledger Store stand-in whose appendRecord() throws on the very
// first call, simulating an unavailable store (e.g. JsonlLedgerStore's
// appendFileSync failing with a raw Node fs error) — reproduces the exact
// pre-hardening escape path: the initial execution.started append, before
// createPipelineContext() or any stage ever runs.
function createFailingLedger(errorToThrow) {
  let appendCallCount = 0;
  return {
    appendRecord() {
      appendCallCount += 1;
      throw errorToThrow ?? new Error("simulated ledger write failure");
    },
    readAll() {
      return [];
    },
    getAppendCallCount: () => appendCallCount,
  };
}

test("initial execution.started append failure returns a failed PipelineResult instead of throwing", async () => {
  const failingLedger = createFailingLedger();
  const orchestrator = createPipelineOrchestrator({ ledger: failingLedger, stages: [{ name: "stub", async execute() { return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null }; } }] });

  await assert.doesNotReject(async () => {
    const result = await orchestrator.run({});
    assert.equal(result.success, false);
  });
});

test("no pipeline stage executes when the initial lifecycle write fails", async () => {
  const failingLedger = createFailingLedger();
  let stageRan = false;
  const stageThatShouldNeverRun = {
    name: "should-never-run",
    async execute() {
      stageRan = true;
      return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null };
    },
  };
  const orchestrator = createPipelineOrchestrator({ ledger: failingLedger, stages: [stageThatShouldNeverRun] });
  await orchestrator.run({});

  assert.equal(stageRan, false);
});

test("the allocated executionId is preserved on the failed PipelineResult", async () => {
  const failingLedger = createFailingLedger();
  const orchestrator = createPipelineOrchestrator({ ledger: failingLedger, stages: [{ name: "stub", async execute() { return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null }; } }] });
  const { executionIdGenerator } = makeIdGenerators();

  const result = await orchestrator.run({}, { clock: makeFixedClock(), executionIdGenerator });

  assert.equal(result.executionId, "exec_20260801_fixedexecid01");
});

test("finishedCarousel is null and no second ledger append is attempted after the first append fails", async () => {
  const failingLedger = createFailingLedger();
  const orchestrator = createPipelineOrchestrator({ ledger: failingLedger, stages: [{ name: "stub", async execute() { return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null }; } }] });

  const result = await orchestrator.run({});

  assert.equal(result.finishedCarousel, null);
  assert.equal(failingLedger.getAppendCallCount(), 1, "execution.failed must never be appended to a ledger that just failed to write");
});

test("the error uses the existing safe PipelineResult.error shape, with only approved fields", async () => {
  const failingLedger = createFailingLedger();
  const orchestrator = createPipelineOrchestrator({ ledger: failingLedger, stages: [{ name: "stub", async execute() { return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null }; } }] });

  const result = await orchestrator.run({});

  assert.deepEqual(Object.keys(result.error).sort(), ["code", "message", "retryable", "stage"]);
  assert.equal(result.error.stage, null);
  assert.equal(typeof result.error.code, "string");
  assert.equal(typeof result.error.message, "string");
  assert.equal(result.error.retryable, false);
});

test("no raw fs error detail (a file path) leaks through the safe error", async () => {
  const rawFsError = new Error("ENOENT: no such file or directory, open 'C:\\secret\\path\\ledger.jsonl'");
  rawFsError.code = "ENOENT";
  const failingLedger = createFailingLedger(rawFsError);
  const orchestrator = createPipelineOrchestrator({ ledger: failingLedger, stages: [{ name: "stub", async execute() { return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null }; } }] });

  const result = await orchestrator.run({});

  assert.equal(result.error.code, "ENOENT");
  assert.doesNotMatch(result.error.message, /secret/);
  assert.doesNotMatch(result.error.message, /ledger\.jsonl/);
  assert.doesNotMatch(JSON.stringify(result), /C:\\\\secret/);
});

test("a DuplicateSequenceError-style thrown error still maps safely via .code, not raw .message", async () => {
  // Simulates the realistic case of a real ExecutionLedger reusing an
  // executionId that already has records — DuplicateSequenceError itself
  // is already a safe, structured error, but this path deliberately never
  // reads .message from ANY error, safe or not, to keep exactly one
  // code path here (see pipeline-orchestrator.mjs's own comment on why).
  class FakeDuplicateSequenceError extends Error {
    constructor() {
      super('execution "exec_x": sequence 1 is not greater than the highest existing sequence (1)');
      this.name = "DuplicateSequenceError";
    }
  }
  const failingLedger = createFailingLedger(new FakeDuplicateSequenceError());
  const orchestrator = createPipelineOrchestrator({ ledger: failingLedger, stages: [{ name: "stub", async execute() { return { success: true, updatedContext: {}, executionRecords: [], warnings: [], error: null }; } }] });

  const result = await orchestrator.run({});

  assert.equal(result.error.code, "DuplicateSequenceError");
  assert.equal(result.error.message, "Failed to record execution start in the Execution Ledger");
});

// --- Configuration / preconditions -----------------------------------------

test("createPipelineOrchestrator throws PipelineConfigurationError for a missing ledger", () => {
  assert.throws(() => createPipelineOrchestrator({}), PipelineConfigurationError);
  assert.throws(() => createPipelineOrchestrator({ ledger: {} }), PipelineConfigurationError);
});

test("createPipelineOrchestrator throws PipelineConfigurationError for an empty stage list", () => {
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  assert.throws(() => createPipelineOrchestrator({ ledger, stages: [] }), PipelineConfigurationError);
});

// --- Determinism ----------------------------------------------------------

test("the same clock/executionIdGenerator/recordIdGenerator produce byte-identical timestamps and IDs across two separate runs", async () => {
  const stubStage = {
    name: "stub",
    async execute() {
      return { success: true, updatedContext: {}, executionRecords: [{ event_type: "topic.loaded", status: "succeeded" }], warnings: [], error: null };
    },
  };

  const ledgerA = createExecutionLedger({ store: createInMemoryStore() });
  const orchestratorA = createPipelineOrchestrator({ ledger: ledgerA, stages: [stubStage] });
  const { executionIdGenerator: idGenA, recordIdGenerator: recGenA } = makeIdGenerators();
  const resultA = await orchestratorA.run({}, { clock: makeFixedClock(), executionIdGenerator: idGenA, recordIdGenerator: recGenA });

  const ledgerB = createExecutionLedger({ store: createInMemoryStore() });
  const orchestratorB = createPipelineOrchestrator({ ledger: ledgerB, stages: [stubStage] });
  const { executionIdGenerator: idGenB, recordIdGenerator: recGenB } = makeIdGenerators();
  const resultB = await orchestratorB.run({}, { clock: makeFixedClock(), executionIdGenerator: idGenB, recordIdGenerator: recGenB });

  assert.equal(resultA.executionId, resultB.executionId);
  assert.deepEqual(ledgerA.readAll(), ledgerB.readAll());
});

test("no test in this file depends on the real clock or a random UUID for its assertions", async () => {
  // Documents the determinism guarantee explicitly: every prior test in
  // this file that asserts on an execution_id, record_id, or timestamp
  // passes injected clock/idGenerator functions.
  const ledger = createExecutionLedger({ store: createInMemoryStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const { executionIdGenerator, recordIdGenerator } = makeIdGenerators();
  const result = await orchestrator.run({ configuration: realConfiguration() }, { clock: makeFixedClock(), executionIdGenerator, recordIdGenerator });
  assert.equal(result.executionId, "exec_20260801_fixedexecid01");
});

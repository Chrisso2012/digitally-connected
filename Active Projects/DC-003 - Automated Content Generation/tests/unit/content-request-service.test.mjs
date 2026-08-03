import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { executeContentRequest } from "../../src/content-request-service.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { createExecutionLedger } from "../../src/execution-ledger.mjs";
import { createPipelineOrchestrator } from "../../src/pipeline-orchestrator.mjs";
import { createExternalInvocationAdapter } from "../../src/invocation-adapter.mjs";
import { createN8nAdapter } from "../../src/n8n-adapter.mjs";
import { createProductionWorkflow } from "../../src/production-workflow.mjs";
import {
  AmbiguousContentRequestError,
  UnsupportedDesignCountError,
  ContentRequestValidationError,
  UnknownSourceReferenceError,
} from "../../src/content-request-errors.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINISHED_CAROUSEL_FIXTURE = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");
const TOPIC_PACKAGE_FIXTURE = path.join(__dirname, "..", "fixtures", "topic-package.example.json");

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-content-request-service-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeMatchingTopicPackage(dir, sourceReference) {
  const topicPackage = JSON.parse(readFileSync(TOPIC_PACKAGE_FIXTURE, "utf-8"));
  topicPackage.source = "backlog";
  topicPackage.backlog_reference_id = sourceReference;
  writeFileSync(path.join(dir, "source.json"), JSON.stringify(topicPackage), "utf-8");
}

function buildFinishedCarousel(overrides = {}) {
  const carousel = JSON.parse(readFileSync(FINISHED_CAROUSEL_FIXTURE, "utf-8"));
  return { ...carousel, ...overrides };
}

function buildWorkflowResult({ status = "completed", carouselId = "car_fakecarousel01", executionId = "exec_fake0001", requestId = "req_fake", warnings = [], error = null } = {}) {
  const finishedCarousel = buildFinishedCarousel({ carousel_id: carouselId });
  const success = status === "completed";
  return {
    invocationResponse: { success, executionId: success ? executionId : null, requestId, status, finishedCarousel: success ? finishedCarousel : null, warnings, error },
    finishedCarousel: success ? finishedCarousel : null,
    executionId: success ? executionId : null,
    requestId,
    summary: { status, executionId: success ? executionId : null, requestId, durationMs: 42, completedAt: "2026-08-04T00:00:01.000Z", warningCount: warnings.length, hasError: error !== null },
  };
}

function createFakeProductionWorkflow(resultOrFn) {
  const calls = [];
  return {
    calls,
    async run(workflowInput) {
      calls.push(workflowInput);
      return typeof resultOrFn === "function" ? resultOrFn(workflowInput) : resultOrFn;
    },
  };
}

function createInMemoryStorageAdapter() {
  const files = new Map();
  return {
    name: "in-memory-test-adapter",
    write(identifier, content) {
      files.set(identifier, content);
    },
    read(identifier) {
      if (!files.has(identifier)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return files.get(identifier);
    },
    list() {
      return [...files.keys()];
    },
    exists(identifier) {
      return files.has(identifier);
    },
  };
}

function createBrokenWriteAdapter() {
  const base = createInMemoryStorageAdapter();
  return {
    ...base,
    write() {
      throw new Error("EACCES: permission denied, open '/very/secret/host/path/car_x.json'");
    },
  };
}

// --- dependency contract guards -----------------------------------------

test("throws PipelineConfigurationError when productionWorkflow is missing", async () => {
  const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });
  await assert.rejects(
    () => executeContentRequest("Create 6 designs based on article GS01", { carouselStore }),
    PipelineConfigurationError
  );
});

test("throws PipelineConfigurationError when carouselStore is missing", async () => {
  const productionWorkflow = createFakeProductionWorkflow(buildWorkflowResult());
  await assert.rejects(
    () => executeContentRequest("Create 6 designs based on article GS01", { productionWorkflow }),
    PipelineConfigurationError
  );
});

// --- request-shape validation (throws immediately) ----------------------

test("throws AmbiguousContentRequestError for an unrecognized command, before touching any dependency", async () => {
  const productionWorkflow = createFakeProductionWorkflow(buildWorkflowResult());
  const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

  await assert.rejects(
    () => executeContentRequest("Please make me some designs", { productionWorkflow, carouselStore }),
    AmbiguousContentRequestError
  );
  assert.equal(productionWorkflow.calls.length, 0);
});

test("throws UnsupportedDesignCountError for a command requesting a count other than 6", async () => {
  const productionWorkflow = createFakeProductionWorkflow(buildWorkflowResult());
  const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

  await assert.rejects(
    () => executeContentRequest("Create 3 designs based on article GS01", { productionWorkflow, carouselStore }),
    UnsupportedDesignCountError
  );
  assert.equal(productionWorkflow.calls.length, 0);
});

test("throws UnsupportedDesignCountError for a structured request with an unsupported count", async () => {
  const productionWorkflow = createFakeProductionWorkflow(buildWorkflowResult());
  const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

  await assert.rejects(
    () =>
      executeContentRequest(
        { action: "create", designCount: 1, sourceType: "article", sourceReference: "GS01" },
        { productionWorkflow, carouselStore }
      ),
    UnsupportedDesignCountError
  );
});

test("throws ContentRequestValidationError for a structured request with an unsupported source type", async () => {
  const productionWorkflow = createFakeProductionWorkflow(buildWorkflowResult());
  const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

  await assert.rejects(
    () =>
      executeContentRequest(
        { action: "create", designCount: 6, sourceType: "video", sourceReference: "GS01" },
        { productionWorkflow, carouselStore }
      ),
    ContentRequestValidationError
  );
});

// --- successful end-to-end request (fake production workflow) ----------

test("a successful request resolves the source, invokes production, persists, and returns a complete result", async () => {
  await withTempDir(async (dir) => {
    writeMatchingTopicPackage(dir, "GS01");
    const productionWorkflow = createFakeProductionWorkflow((input) => buildWorkflowResult({ carouselId: "car_success0001", requestId: input.requestId }));
    const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

    const result = await executeContentRequest("Create 6 designs based on article GS01", {
      productionWorkflow,
      carouselStore,
      topicPackagesDir: dir,
      now: () => "2026-08-04T00:00:00.000Z",
      idGenerator: () => "req_deterministic0001",
    });

    assert.equal(result.success, true);
    assert.equal(result.requestId, "req_deterministic0001");
    assert.equal(result.sourceReference, "GS01");
    assert.equal(result.executionId, "exec_fake0001");
    assert.equal(result.carouselId, "car_success0001");
    assert.equal(result.status, "completed");
    assert.equal(result.stored, true);
    assert.equal(result.storeReference, "in-memory-test-adapter:car_success0001");
    assert.deepEqual(result.warnings, []);
    assert.equal(result.error, null);

    // the workflow was actually invoked with the resolved source and the
    // content request's own request_id as the production requestId
    assert.equal(productionWorkflow.calls.length, 1);
    assert.equal(productionWorkflow.calls[0].requestId, "req_deterministic0001");
    assert.equal(productionWorkflow.calls[0].topicPackageData.backlog_reference_id, "GS01");
  });
});

test("the stored carousel is retrievable and has exactly six slides", async () => {
  await withTempDir(async (dir) => {
    writeMatchingTopicPackage(dir, "GS01");
    const productionWorkflow = createFakeProductionWorkflow((input) => buildWorkflowResult({ carouselId: "car_sixslides01", requestId: input.requestId }));
    const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

    const result = await executeContentRequest("Create 6 designs based on article GS01", {
      productionWorkflow,
      carouselStore,
      topicPackagesDir: dir,
    });

    const stored = carouselStore.get(result.carouselId);
    assert.equal(stored.slides.length, 6);
  });
});

test("requestId, executionId, and carouselId are all distinct from each other and from the source reference", async () => {
  await withTempDir(async (dir) => {
    writeMatchingTopicPackage(dir, "GS01");
    const productionWorkflow = createFakeProductionWorkflow((input) => buildWorkflowResult({ carouselId: "car_distinctids1", executionId: "exec_distinctids1", requestId: input.requestId }));
    const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

    const result = await executeContentRequest("Create 6 designs based on article GS01", {
      productionWorkflow,
      carouselStore,
      topicPackagesDir: dir,
      idGenerator: () => "req_distinctids0",
    });

    const ids = [result.requestId, result.executionId, result.carouselId, result.sourceReference];
    assert.equal(new Set(ids).size, ids.length, `expected all distinct, got ${JSON.stringify(ids)}`);
  });
});

test("result object is deeply frozen", async () => {
  await withTempDir(async (dir) => {
    writeMatchingTopicPackage(dir, "GS01");
    const productionWorkflow = createFakeProductionWorkflow(buildWorkflowResult());
    const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

    const result = await executeContentRequest("Create 6 designs based on article GS01", { productionWorkflow, carouselStore, topicPackagesDir: dir });
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.warnings));
    assert.throws(() => {
      result.success = false;
    }, TypeError);
  });
});

test("never returns PipelineContext, raw provider responses, credentials, or the full finished carousel", async () => {
  await withTempDir(async (dir) => {
    writeMatchingTopicPackage(dir, "GS01");
    const productionWorkflow = createFakeProductionWorkflow(buildWorkflowResult());
    const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

    const result = await executeContentRequest("Create 6 designs based on article GS01", { productionWorkflow, carouselStore, topicPackagesDir: dir });
    assert.deepEqual(
      Object.keys(result).sort(),
      ["carouselId", "error", "executionId", "requestId", "sourceReference", "status", "storeReference", "stored", "success", "warnings"]
    );
  });
});

// --- unknown source (no production, no persistence) ---------------------

test("an unknown source reference resolves to a safe failed result without ever invoking production", async () => {
  await withTempDir(async (dir) => {
    const productionWorkflow = createFakeProductionWorkflow(buildWorkflowResult());
    const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

    const result = await executeContentRequest("Create 6 designs based on article DOES_NOT_EXIST", {
      productionWorkflow,
      carouselStore,
      topicPackagesDir: dir,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, "rejected");
    assert.equal(result.stored, false);
    assert.equal(result.storeReference, null);
    assert.equal(result.carouselId, null);
    assert.equal(result.error.code, "UnknownSourceReferenceError");
    assert.equal(productionWorkflow.calls.length, 0);
    assert.deepEqual(carouselStore.list(), []);
  });
});

// --- production failure (no persistence) --------------------------------

test("a failed production execution returns a safe failed result and never persists anything", async () => {
  await withTempDir(async (dir) => {
    writeMatchingTopicPackage(dir, "GS01");
    const productionWorkflow = createFakeProductionWorkflow(
      buildWorkflowResult({ status: "failed", error: { code: "RenderFailed", message: "mock render failure", retryable: false } })
    );
    const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

    const result = await executeContentRequest("Create 6 designs based on article GS01", { productionWorkflow, carouselStore, topicPackagesDir: dir });

    assert.equal(result.success, false);
    assert.equal(result.status, "failed");
    assert.equal(result.stored, false);
    assert.equal(result.storeReference, null);
    assert.equal(result.error.code, "RenderFailed");
    assert.equal(result.error.message, "mock render failure");
    assert.deepEqual(carouselStore.list(), []);
  });
});

// --- persistence: duplicate --------------------------------------------

test("a duplicate stored carousel is reported as DuplicateStoredCarouselError, production is still reported as completed", async () => {
  await withTempDir(async (dir) => {
    writeMatchingTopicPackage(dir, "GS01");
    const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });
    // Pre-seed the store with a carousel sharing the exact carousel_id the
    // fake production workflow is about to "produce" — the deterministic
    // way to trigger a genuine duplicate, since I012's own builder
    // normally assigns a fresh random ID on every real run.
    carouselStore.save(buildFinishedCarousel({ carousel_id: "car_alreadystored" }));

    const productionWorkflow = createFakeProductionWorkflow((input) => buildWorkflowResult({ carouselId: "car_alreadystored", requestId: input.requestId }));

    const result = await executeContentRequest("Create 6 designs based on article GS01", { productionWorkflow, carouselStore, topicPackagesDir: dir });

    assert.equal(result.success, false);
    assert.equal(result.status, "completed");
    assert.equal(result.executionId, "exec_fake0001");
    assert.equal(result.carouselId, "car_alreadystored");
    assert.equal(result.stored, false);
    assert.equal(result.storeReference, null);
    assert.equal(result.error.code, "DuplicateStoredCarouselError");
  });
});

// --- persistence: generic failure ---------------------------------------

test("a generic persistence failure is reported as ContentRequestPersistenceFailedError without leaking the raw cause", async () => {
  await withTempDir(async (dir) => {
    writeMatchingTopicPackage(dir, "GS01");
    const carouselStore = createFinishedCarouselStore({ adapter: createBrokenWriteAdapter() });
    const productionWorkflow = createFakeProductionWorkflow((input) => buildWorkflowResult({ carouselId: "car_brokenwrite01", requestId: input.requestId }));

    const result = await executeContentRequest("Create 6 designs based on article GS01", { productionWorkflow, carouselStore, topicPackagesDir: dir });

    assert.equal(result.success, false);
    assert.equal(result.stored, false);
    assert.equal(result.error.code, "ContentRequestPersistenceFailedError");
    assert.doesNotMatch(result.error.message, /\/very\/secret\/host\/path/);
    assert.doesNotMatch(result.error.message, /permission denied/);
  });
});

// --- safe error mapping, generally ---------------------------------------

test("no result.error ever contains a stack trace marker", async () => {
  await withTempDir(async (dir) => {
    const productionWorkflow = createFakeProductionWorkflow(buildWorkflowResult());
    const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

    const result = await executeContentRequest("Create 6 designs based on article DOES_NOT_EXIST", { productionWorkflow, carouselStore, topicPackagesDir: dir });
    assert.doesNotMatch(result.error.message, /at file:\/\//);
  });
});

// --- real end-to-end composition (the real I012 stack, not a fake) ------

function createInMemoryLedgerStore() {
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

function buildRealProductionWorkflow() {
  const ledger = createExecutionLedger({ store: createInMemoryLedgerStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const invocationAdapter = createExternalInvocationAdapter({ orchestrator });
  const n8nAdapter = createN8nAdapter({ invocationAdapter });
  return createProductionWorkflow({ n8nAdapter });
}

test("composes the real, unmodified I003-I012 stack end to end (not a fake) and produces a stored, six-slide, mock-only carousel", async () => {
  await withTempDir(async (dir) => {
    writeMatchingTopicPackage(dir, "GS01");
    const productionWorkflow = buildRealProductionWorkflow();
    const carouselStore = createFinishedCarouselStore({ adapter: createInMemoryStorageAdapter() });

    const result = await executeContentRequest("Create 6 designs based on article GS01", {
      productionWorkflow,
      carouselStore,
      topicPackagesDir: dir,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, "completed");
    assert.equal(result.stored, true);
    assert.match(result.carouselId, /^car_[A-Za-z0-9]+$/);
    assert.match(result.executionId, /^exec_[A-Za-z0-9_]+$/);

    const stored = carouselStore.get(result.carouselId);
    assert.equal(stored.slides.length, 6);
    assert.equal(stored.overall_status, "completed");
    assert.equal(stored.execution_metadata.provider, "mock-transport");
  });
});

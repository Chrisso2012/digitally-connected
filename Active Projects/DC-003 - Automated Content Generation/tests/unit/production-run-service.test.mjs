// Unit tests for production-run-service.mjs (DC-003-I020.1). Every test
// uses the mock provider/mock transport, or small local fakes wrapping
// them — no network, no real credentials. Unlike the original DC-003-I020
// implementation, this service now routes every run through the real
// Execution Ledger, Pipeline Orchestrator, External Invocation Adapter,
// n8n Adapter, Production Workflow, and I016 Content Request Service — so
// these tests assert on the LEDGER's own recorded lifecycle, not just the
// service's own return value, to prove that routing actually happens.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeProductionRun } from "../../src/production-run-service.mjs";
import { createMockProvider } from "../../src/carousel-mock-provider.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { TransportError } from "../../src/renderer-errors.mjs";
import { LlmAuthenticationError } from "../../src/llm-provider-errors.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-production-run-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeAsset(dir, assetId) {
  const topicPackage = {
    topic_id: "topic_01J9PRLIVE0001",
    working_title: "Production Run test topic",
    audience: "Owner-operators",
    primary_goal: "Book a call",
    funnel_stage: "consideration",
    core_message: "Core message",
    supporting_points: ["Point one", "Point two"],
    cta: "Book now",
    keywords: [],
    brand_voice: "confident-direct",
    status: "approved",
    created_date: "2026-08-01T00:00:00Z",
    updated_date: "2026-08-01T00:00:00Z",
    version: 1,
    schema_version: "1.0",
    source: "backlog",
    backlog_reference_id: assetId,
    content_pillar: null,
    tags: [],
    priority: null,
    related_topic_ids: [],
    locale: "en",
    owner: "chris@digitallyconnected.net",
    notes: null,
  };
  const asset = {
    asset_id: assetId,
    title: "Production Run Test Asset",
    summary: "A production-run-service test content asset.",
    topic_package: topicPackage,
    status: "approved",
    created_at: "2026-08-01T00:00:00Z",
    metadata: null,
  };
  writeFileSync(path.join(dir, `${assetId}.json`), JSON.stringify(asset), "utf-8");
}

function createStore(storageDir) {
  return createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir }) });
}

// A minimal Ledger Store double — { name, append, readAll } — that tests
// can inspect afterward to prove the real Execution Ledger/Pipeline
// Orchestrator actually ran, not just that a result object came back.
function createSpyLedgerStore() {
  const records = [];
  return {
    name: "spy-ledger-store",
    append(record) {
      records.push(record);
    },
    readAll() {
      return [...records];
    },
  };
}

// A transport that succeeds like createMockTransport(), but throws on one
// specific call number — for "stops immediately after the failing slide"
// tests. Delegates every non-failing call to a real createMockTransport()
// so the render results it returns are otherwise realistic.
function createFailAtNthCallTransport(failAtCall) {
  const inner = createMockTransport();
  let calls = 0;
  return {
    name: "fail-at-nth-call-transport",
    callCount: () => calls,
    async send(request, sendOptions) {
      calls += 1;
      if (calls === failAtCall) {
        throw new TransportError(`simulated failure at call ${calls}`, null);
      }
      return inner.send(request, sendOptions);
    },
  };
}

// --- Dependency preconditions -----------------------------------------

test("executeProductionRun requires dependencies.provider", async () => {
  await assert.rejects(
    () =>
      executeProductionRun(
        { assetId: "X", contentAssetsDir: "." },
        { renderTransport: createMockTransport(), carouselStore: createSpyLedgerStore() }
      ),
    PipelineConfigurationError
  );
});

test("executeProductionRun requires dependencies.renderTransport", async () => {
  await assert.rejects(
    () =>
      executeProductionRun(
        { assetId: "X", contentAssetsDir: "." },
        { provider: createMockProvider(), carouselStore: createSpyLedgerStore() }
      ),
    PipelineConfigurationError
  );
});

test("executeProductionRun requires dependencies.carouselStore", async () => {
  await assert.rejects(
    () => executeProductionRun({ assetId: "X", contentAssetsDir: "." }, { provider: createMockProvider(), renderTransport: createMockTransport() }),
    PipelineConfigurationError
  );
});

// --- Execution flows through the real Pipeline Orchestrator + ledger ----

test("a successful run writes a full lifecycle to the Execution Ledger, in stage order", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR01");
    return withTempDir(async (storeDir) => {
      const ledgerStore = createSpyLedgerStore();
      const result = await executeProductionRun(
        { assetId: "PR01", contentAssetsDir: dir },
        { provider: createMockProvider(), renderTransport: createMockTransport(), carouselStore: createStore(storeDir), ledgerStore }
      );

      assert.equal(result.success, true);
      const records = ledgerStore.readAll();
      assert.ok(records.length > 0, "the real Execution Ledger must have recorded something — proves the Pipeline Orchestrator actually ran");

      const eventTypes = records.map((r) => r.event_type);
      assert.deepEqual(eventTypes, [
        "execution.started",
        "topic.loaded",
        "content.generated",
        "payload.mapped",
        "render.started",
        "render.completed",
        "finished_carousel.created",
        "execution.completed",
      ]);

      // Every record belongs to the one executionId the result reports,
      // and sequence numbers are strictly increasing — the orchestrator's
      // own invariant, not something this service enforces itself.
      for (const record of records) {
        assert.equal(record.execution_id, result.executionId);
      }
      const sequences = records.map((r) => r.sequence);
      assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
      assert.equal(new Set(sequences).size, sequences.length, "sequence numbers must be unique");
    });
  }));

test("stage ordering is preserved: slides are generated/rendered in cover, content, statistic, quote, infographic, cta order", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR02");
    return withTempDir(async (storeDir) => {
      const renderTransport = createMockTransport();
      const carouselStore = createStore(storeDir);
      const result = await executeProductionRun(
        { assetId: "PR02", contentAssetsDir: dir },
        { provider: createMockProvider(), renderTransport, carouselStore }
      );
      const stored = carouselStore.get(result.carouselId);
      assert.deepEqual(
        stored.slides.map((s) => s.slide_type),
        ["cover", "content", "statistic", "quote", "infographic", "cta"]
      );
    });
  }));

// --- Successful six-render completion, persistence through I015, safe
// result mapping ----------------------------------------------------------

test("a full successful run persists exactly one Finished Carousel and returns a safe, fully-populated result", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR03");
    return withTempDir(async (storeDir) => {
      const renderTransport = createMockTransport();
      const carouselStore = createStore(storeDir);

      const result = await executeProductionRun(
        { assetId: "PR03", contentAssetsDir: dir },
        { provider: createMockProvider(), renderTransport, carouselStore }
      );

      assert.equal(result.success, true);
      assert.equal(result.sourceReference, "PR03");
      assert.match(result.requestId, /^req_[A-Za-z0-9]+$/, "requestId now comes from I016's own Content Request, not a separately invented ID");
      assert.match(result.executionId, /^exec_\d{8}_[A-Za-z0-9]+$/);
      assert.match(result.carouselContentId, /^cc_[A-Za-z0-9]+$/);
      assert.match(result.carouselId, /^car_[A-Za-z0-9]+$/);
      assert.equal(result.status, "completed");
      assert.equal(result.slideCount, 6);
      assert.equal(result.renderedSlideCount, 6);
      assert.equal(result.stored, true);
      assert.equal(result.storeReference, `local-json-carousel-store:${result.carouselId}`);
      assert.equal(result.error, null);
      assert.equal(typeof result.duration, "number");
      assert.ok(result.duration >= 0);
      assert.equal(renderTransport.callCount(), 6, "exactly 6 Templated requests for a full run");

      const stored = carouselStore.get(result.carouselId);
      assert.equal(stored.overall_status, "completed");
      assert.equal(stored.slides.length, 6);
    });
  }));

// --- Anthropic failure causes zero renders -------------------------------

test("an Anthropic generation failure returns before any Templated request is made, and persists nothing", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR04");
    return withTempDir(async (storeDir) => {
      const failingProvider = {
        name: "always-fails-auth",
        async generateCarousel() {
          throw new LlmAuthenticationError("simulated auth failure (401)");
        },
      };
      const renderTransport = createMockTransport();
      const carouselStore = createStore(storeDir);

      const result = await executeProductionRun(
        { assetId: "PR04", contentAssetsDir: dir },
        { provider: failingProvider, renderTransport, carouselStore, maxAttempts: 1 }
      );

      assert.equal(result.success, false);
      assert.equal(result.slideCount, 0);
      assert.equal(result.renderedSlideCount, 0);
      assert.equal(result.stored, false);
      assert.equal(result.storeReference, null);
      assert.equal(result.error.code, "LlmAuthenticationError");
      assert.equal(renderTransport.callCount(), 0, "zero Templated requests when generation fails");
      assert.equal(carouselStore.list().length, 0, "no carousel persisted when generation fails");
    });
  }));

// --- Slide render failure stops later renders, no persistence -----------

test("a render failure on slide 3 stops before slides 4-6 are ever requested, and persists nothing", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR05");
    return withTempDir(async (storeDir) => {
      const renderTransport = createFailAtNthCallTransport(3);
      const carouselStore = createStore(storeDir);

      const result = await executeProductionRun(
        { assetId: "PR05", contentAssetsDir: dir },
        { provider: createMockProvider(), renderTransport, carouselStore, maxAttempts: 1 }
      );

      assert.equal(result.success, false);
      assert.equal(result.slideCount, 6, "6 is the total the carousel was supposed to have, even though rendering stopped early");
      assert.equal(result.renderedSlideCount, 2, "only the first 2 slides completed before the 3rd failed");
      assert.equal(result.stored, false);
      assert.equal(result.storeReference, null);
      assert.equal(renderTransport.callCount(), 3, "no request for slides 4, 5, or 6 after the 3rd fails");
      assert.equal(carouselStore.list().length, 0, "no carousel persisted after a partial render failure");
    });
  }));

// --- Asset-resolution failure --------------------------------------------

test("an unknown asset ID is reported safely as a rejected run, no provider or transport call made", () =>
  withTempDir((dir) =>
    withTempDir(async (storeDir) => {
      let providerCalled = false;
      let transportCalled = false;
      const provider = { name: "should-not-be-called", async generateCarousel() { providerCalled = true; return "{}"; } };
      const renderTransport = { name: "should-not-be-called", async send() { transportCalled = true; return {}; } };

      const result = await executeProductionRun(
        { assetId: "DOES_NOT_EXIST", contentAssetsDir: dir },
        { provider, renderTransport, carouselStore: createStore(storeDir) }
      );

      assert.equal(result.success, false);
      assert.equal(result.status, "rejected");
      // I016's Content Asset Resolver (unmodified) surfaces its own
      // UnknownSourceReferenceError — see production-run-live-cli.test.mjs
      // for the equivalent CLI-level assertion and its own note.
      assert.equal(result.error.code, "UnknownSourceReferenceError");
      assert.equal(providerCalled, false);
      assert.equal(transportCalled, false);
    })
  ));

// --- Safe result mapping (no throw, no stack trace) ----------------------

test("a generic (non-Llm, no .retryable field) provider failure produces a safe { code, message } error, never a stack trace in the result", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR06");
    return withTempDir(async (storeDir) => {
      // A plain Error carries no `.retryable` field, so carousel-generator.mjs's
      // own retry loop (unmodified) treats it as retryable-by-default —
      // with maxAttempts: 1 it still exhausts after one attempt and wraps
      // as CarouselGenerationFailedError, exactly as it already does for
      // the mock provider path; this is existing, correct I004 behaviour,
      // not something this service changes.
      const provider = { name: "plain-error", async generateCarousel() { throw new Error("plain failure"); } };
      const result = await executeProductionRun(
        { assetId: "PR06", contentAssetsDir: dir },
        { provider, renderTransport: createMockTransport(), carouselStore: createStore(storeDir), maxAttempts: 1 }
      );
      assert.equal(result.error.code, "CarouselGenerationFailedError");
      assert.doesNotMatch(JSON.stringify(result), /at file:\/\//);
    });
  }));

// --- Determinism / injectable overrides ----------------------------------

test("now/idGenerator are injectable for deterministic tests, forwarded through to I016", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR07");
    return withTempDir(async (storeDir) => {
      const result = await executeProductionRun(
        { assetId: "PR07", contentAssetsDir: dir },
        {
          provider: createMockProvider(),
          renderTransport: createMockTransport(),
          carouselStore: createStore(storeDir),
          idGenerator: () => "req_deterministic00001",
          now: () => "2026-01-01T00:00:00.000Z",
        }
      );
      assert.equal(result.requestId, "req_deterministic00001");
    });
  }));

// --- One Anthropic request maximum, six Templated requests maximum ------

test("exactly one generateCarousel() call is made per run", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR08");
    return withTempDir(async (storeDir) => {
      let calls = 0;
      const provider = {
        name: "counting-provider",
        async generateCarousel(prompt, context) {
          calls += 1;
          return createMockProvider().generateCarousel(prompt, context);
        },
      };
      await executeProductionRun(
        { assetId: "PR08", contentAssetsDir: dir },
        { provider, renderTransport: createMockTransport(), carouselStore: createStore(storeDir), maxAttempts: 1 }
      );
      assert.equal(calls, 1);
    });
  }));

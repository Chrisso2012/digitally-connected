// Unit tests for production-run-service.mjs (DC-003-I020). Every test uses
// the mock provider/mock transport, or small local fakes wrapping them —
// no network, no real credentials, matching this codebase's own "automated
// tests use mock transports only" rule. A real provider/transport is only
// ever constructed by tests/validation/production-run-live.mjs's own
// --live path, never here.

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
import { LlmAuthenticationError, LlmClientError } from "../../src/llm-provider-errors.mjs";
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

function createFakeStore({ throwOnSave } = {}) {
  const saved = [];
  return {
    name: "fake-carousel-store",
    saved: () => saved,
    save(finishedCarousel) {
      if (throwOnSave) throw throwOnSave;
      saved.push(finishedCarousel);
      return finishedCarousel;
    },
  };
}

// --- Dependency preconditions -----------------------------------------

test("executeProductionRun requires dependencies.provider", async () => {
  await assert.rejects(
    () => executeProductionRun({ assetId: "X", contentAssetsDir: "." }, { renderTransport: createMockTransport(), carouselStore: createFakeStore() }),
    PipelineConfigurationError
  );
});

test("executeProductionRun requires dependencies.renderTransport", async () => {
  await assert.rejects(
    () => executeProductionRun({ assetId: "X", contentAssetsDir: "." }, { provider: createMockProvider(), carouselStore: createFakeStore() }),
    PipelineConfigurationError
  );
});

test("executeProductionRun requires dependencies.carouselStore", async () => {
  await assert.rejects(
    () => executeProductionRun({ assetId: "X", contentAssetsDir: "." }, { provider: createMockProvider(), renderTransport: createMockTransport() }),
    PipelineConfigurationError
  );
});

// --- Successful six-render completion, Finished Carousel construction,
// persistence through I015, safe result mapping --------------------------

test("a full successful run generates, renders all 6 slides in order, builds and persists one Finished Carousel", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR01");
    return withTempDir(async (storeDir) => {
      const renderTransport = createMockTransport();
      const carouselStore = createStore(storeDir);

      const result = await executeProductionRun(
        { assetId: "PR01", contentAssetsDir: dir },
        { provider: createMockProvider(), renderTransport, carouselStore }
      );

      assert.equal(result.success, true);
      assert.equal(result.sourceReference, "PR01");
      assert.match(result.requestId, /^prod_[A-Za-z0-9]+$/);
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

      // Persisted through I015 for real — get() re-validates against the schema.
      const stored = carouselStore.get(result.carouselId);
      assert.equal(stored.overall_status, "completed");
      assert.equal(stored.slides.length, 6);
      assert.deepEqual(
        stored.slides.map((s) => s.slide_type),
        ["cover", "content", "statistic", "quote", "infographic", "cta"]
      );
    });
  }));

// --- One Anthropic request maximum, six Templated requests maximum ------

test("exactly one generateCarousel() call is made per run (no internal retry beyond the provided maxAttempts)", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR02");
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
        { assetId: "PR02", contentAssetsDir: dir },
        { provider, renderTransport: createMockTransport(), carouselStore: createStore(storeDir), llmMaxAttempts: 1 }
      );
      assert.equal(calls, 1);
    });
  }));

// --- Anthropic failure causes zero renders -------------------------------

test("an Anthropic generation failure returns before any Templated request is made", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR03");
    return withTempDir(async (storeDir) => {
      const failingProvider = {
        name: "always-fails-auth",
        async generateCarousel() {
          throw new LlmAuthenticationError("simulated auth failure (401)");
        },
      };
      const renderTransport = createMockTransport();
      const carouselStore = createFakeStore();

      const result = await executeProductionRun(
        { assetId: "PR03", contentAssetsDir: dir },
        { provider: failingProvider, renderTransport, carouselStore, llmMaxAttempts: 1 }
      );

      assert.equal(result.success, false);
      assert.equal(result.status, "failed");
      assert.equal(result.slideCount, 0);
      assert.equal(result.renderedSlideCount, 0);
      assert.equal(result.stored, false);
      assert.equal(result.storeReference, null);
      assert.equal(result.error.stage, "generation");
      assert.equal(result.error.code, "LlmAuthenticationError");
      assert.equal(renderTransport.callCount(), 0, "zero Templated requests when generation fails");
      assert.equal(carouselStore.saved().length, 0, "no carousel persisted when generation fails");
    });
  }));

// --- Slide render failure stops later renders, no persistence -----------

test("a render failure on slide 3 stops before slides 4-6 are ever requested, and persists nothing", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR04");
    return withTempDir(async (storeDir) => {
      const renderTransport = createFailAtNthCallTransport(3);
      const carouselStore = createFakeStore();

      const result = await executeProductionRun(
        { assetId: "PR04", contentAssetsDir: dir },
        { provider: createMockProvider(), renderTransport, carouselStore, renderMaxAttempts: 1 }
      );

      assert.equal(result.success, false);
      assert.equal(result.status, "failed");
      assert.equal(result.slideCount, 6);
      assert.equal(result.renderedSlideCount, 2, "only the first 2 slides completed before the 3rd failed");
      assert.equal(result.stored, false);
      assert.equal(result.storeReference, null);
      assert.equal(result.error.stage, "rendering");
      // Slide order is cover, content, statistic, quote, infographic, cta —
      // the 3rd is "statistic".
      assert.equal(result.error.slideType, "statistic");
      assert.equal(renderTransport.callCount(), 3, "no request for slides 4, 5, or 6 after the 3rd fails");
      assert.equal(carouselStore.saved().length, 0, "no carousel persisted after a partial render failure");
    });
  }));

// --- No persistence after partial failure (Finished Carousel build side) -

test("a persistence failure is reported safely without throwing, and does not report success", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR05");
    return withTempDir(async () => {
      const carouselStore = createFakeStore({ throwOnSave: new Error("simulated storage adapter failure") });
      const result = await executeProductionRun(
        { assetId: "PR05", contentAssetsDir: dir },
        { provider: createMockProvider(), renderTransport: createMockTransport(), carouselStore }
      );
      assert.equal(result.success, false);
      assert.equal(result.stored, false);
      assert.equal(result.storeReference, null);
      assert.equal(result.error.stage, "persistence");
      assert.equal(carouselStore.saved().length, 0);
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
      assert.equal(result.error.stage, "asset-resolution");
      assert.equal(result.error.code, "UnknownContentAssetError");
      assert.equal(providerCalled, false);
      assert.equal(transportCalled, false);
    })
  ));

// --- Secret-safe diagnostics ---------------------------------------------

test("an LlmClientError's safe diagnostic passes through to the result, never the raw response body or API key", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR06");
    return withTempDir(async (storeDir) => {
      const diagnostic = { status: 400, errorType: "invalid_request_error", requestId: "req_test_diag", message: "simulated safe message" };
      const provider = {
        name: "throws-client-error",
        async generateCarousel() {
          throw new LlmClientError("Anthropic rejected the request (HTTP 400)", diagnostic);
        },
      };

      const result = await executeProductionRun(
        { assetId: "PR06", contentAssetsDir: dir },
        { provider, renderTransport: createMockTransport(), carouselStore: createStore(storeDir), llmMaxAttempts: 1 }
      );

      assert.equal(result.error.stage, "generation");
      assert.deepEqual(result.error.diagnostic, diagnostic);
      assert.doesNotMatch(JSON.stringify(result), /sk-[A-Za-z0-9_-]{10,}/);
    });
  }));

test("a generic (non-LlmClientError) failure has diagnostic: null, never a stack trace in the result", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR07");
    return withTempDir(async (storeDir) => {
      const provider = { name: "plain-error", async generateCarousel() { throw new Error("plain failure, no diagnostic field"); } };
      const result = await executeProductionRun(
        { assetId: "PR07", contentAssetsDir: dir },
        { provider, renderTransport: createMockTransport(), carouselStore: createStore(storeDir), llmMaxAttempts: 1 }
      );
      assert.equal(result.error.diagnostic, null);
      assert.doesNotMatch(JSON.stringify(result), /at file:\/\//);
    });
  }));

// --- Determinism / injectable overrides ----------------------------------

test("requestId/executionId/now are all injectable for deterministic tests", () =>
  withTempDir((dir) => {
    writeAsset(dir, "PR08");
    return withTempDir(async (storeDir) => {
      const result = await executeProductionRun(
        { assetId: "PR08", contentAssetsDir: dir },
        {
          provider: createMockProvider(),
          renderTransport: createMockTransport(),
          carouselStore: createStore(storeDir),
          requestIdGenerator: () => "prod_deterministic0001",
          executionIdGenerator: () => "exec_20260101_deadbeefcafe",
          now: () => "2026-01-01T00:00:00.000Z",
        }
      );
      assert.equal(result.requestId, "prod_deterministic0001");
      assert.equal(result.executionId, "exec_20260101_deadbeefcafe");
    });
  }));

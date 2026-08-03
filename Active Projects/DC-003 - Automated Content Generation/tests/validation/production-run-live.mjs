// DC-003-I020 (corrected in DC-003-I020.1) — CLI for the Production Run
// Service: the one entry point in this repository that can select LIVE
// Anthropic generation AND LIVE Templated rendering for one complete, real
// production run, routed through the platform's existing production
// architecture (Execution Ledger -> Pipeline Orchestrator -> External
// Invocation Adapter -> n8n Adapter -> Production Workflow -> I016 Content
// Request Service -> I015 persistence) — see
// src/production-run-service.mjs's own header comment for the full
// composition, and README "Live Production Run — Architectural Correction
// (DC-003-I020.1)" for why. Mock by default (both generation and
// rendering) — safe to run anytime, no credentials needed, no network call
// of any kind without --live.
//
// Usage:
//   node tests/validation/production-run-live.mjs <assetId> <storeDirectory> [--live] [contentAssetsDir]
//   or: npm run production:live -- <assetId> <storeDirectory> [--live] [contentAssetsDir]
//
// contentAssetsDir defaults to the repository's own content-assets/
// directory (DC-003-I018, unchanged).
//
// --live requires BOTH LLM_API_KEY and TEMPLATED_API_KEY to be set in the
// environment — checked before either transport is constructed, before any
// request of any kind is made. If either is missing, this CLI fails fast
// and makes zero requests.
//
// Live-call budget: exactly 1 Anthropic request, plus up to 6 Templated
// requests (one per slide, stopping immediately on the first render
// failure) — 7 requests maximum, per run. No retry is permitted: --live
// always resolves to exactly 1 attempt for BOTH providers, via the SAME
// resolveLlmLiveMaxAttempts()/resolveLiveMaxAttempts() safety primitives
// DC-003-I019/I006 already established for their own --live CLIs —
// completely independent of LLM_MAX_ATTEMPTS/TEMPLATED_RENDER_MAX_ATTEMPTS.
// Both resolve to 1, and this CLI passes a single shared maxAttempts into
// production-run-service.mjs (bound into both live stages via closure —
// see pipeline-stages-live.mjs). There is no --live-max-attempts override
// at all — the DC-003-I020 brief disallows any retry during the initial
// production run, with no override escape hatch, so none is offered here.
//
// Failure behaviour (enforced by production-run-service.mjs, via the
// reused, unmodified I016 Content Request Service): an Anthropic failure
// stops before any Templated request is made; a Templated failure stops
// immediately after the failing slide, with no later slide requested;
// neither ever builds or persists a Finished Carousel from a partial
// result.
//
// Known trade-off of routing through the existing architecture (see
// production-run-service.mjs's header comment for the full explanation):
// a failure's safe diagnostic here is only ever { code, message } — I016's
// own error-shaping (content-request-service.mjs, reused unchanged) never
// carries an LlmClientError's richer .diagnostic (DC-003-I019.1) or a
// stage name through to its own Content Request Result, and this CLI does
// not work around that.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMockProvider } from "../../src/carousel-mock-provider.mjs";
import { createAnthropicProvider } from "../../src/llm-provider-anthropic.mjs";
import { createHttpTransport as createLlmHttpTransport } from "../../src/llm-transport-http.mjs";
import { loadLlmProviderConfig, resolveLiveMaxAttempts as resolveLlmLiveMaxAttempts } from "../../src/llm-provider-config.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { createHttpTransport as createRendererHttpTransport } from "../../src/renderer-transport-http.mjs";
import { loadRendererConfig, resolveLiveMaxAttempts as resolveRenderLiveMaxAttempts } from "../../src/renderer-config.mjs";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { executeProductionRun } from "../../src/production-run-service.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTENT_ASSETS_DIR = path.join(__dirname, "..", "..", "content-assets");

const rawArgs = process.argv.slice(2);
const isLive = rawArgs.includes("--live");
const [assetId, storeDirectory, contentAssetsDirArg] = rawArgs.filter((arg) => !arg.startsWith("--"));

function usageAndExit() {
  console.error("Usage: node tests/validation/production-run-live.mjs <assetId> <storeDirectory> [--live] [contentAssetsDir]");
  console.error("Example (mock, safe anytime):   node tests/validation/production-run-live.mjs GS01 ./output/finished-carousels");
  console.error("Example (LIVE, 1 Anthropic + up to 6 Templated requests): node tests/validation/production-run-live.mjs GS01 ./output/finished-carousels --live");
  process.exit(1);
}

if (!assetId || !storeDirectory) usageAndExit();

try {
  const contentAssetsDir = contentAssetsDirArg ?? DEFAULT_CONTENT_ASSETS_DIR;
  const carouselStoreAdapter = createLocalJsonCarouselStoreAdapter({ storageDir: storeDirectory });
  const carouselStore = createFinishedCarouselStore({ adapter: carouselStoreAdapter });

  let provider;
  let renderTransport;
  let maxAttempts;

  if (isLive) {
    const llmConfig = loadLlmProviderConfig();
    const rendererConfig = loadRendererConfig();

    // Both credentials required before ANY request — checked here, before
    // either transport is constructed, per the I020 brief's own "both
    // credentials required before any request" rule.
    const missing = [];
    if (!llmConfig.apiKey) missing.push("LLM_API_KEY");
    if (!rendererConfig.apiKey) missing.push("TEMPLATED_API_KEY");
    if (missing.length > 0) {
      console.error(`FAIL  --live requires ${missing.join(" and ")} to be set in the environment`);
      process.exit(1);
    }

    // Both existing safety primitives resolve to 1 with no override
    // argument — a single shared ceiling is passed through, since the
    // I020 brief requires the same "1 attempt, no retry" rule for both
    // providers.
    const llmMaxAttempts = resolveLlmLiveMaxAttempts();
    const renderMaxAttempts = resolveRenderLiveMaxAttempts();
    maxAttempts = Math.min(llmMaxAttempts, renderMaxAttempts);

    console.log(`Running LIVE production run — Anthropic (${llmConfig.baseUrl}, model: ${llmConfig.model}) + Templated (${rendererConfig.baseUrl}).`);
    console.log(`  live-call budget: 1 Anthropic request maximum, 6 Templated requests maximum (stops on first render failure)`);
    console.log(`  maxAttempts: ${maxAttempts} for both providers (safe one-shot default, no retry, no override)`);

    provider = createAnthropicProvider({ transport: createLlmHttpTransport(llmConfig), model: llmConfig.model, timeoutMs: llmConfig.requestTimeoutMs });
    renderTransport = createRendererHttpTransport(rendererConfig);
  } else {
    provider = createMockProvider();
    renderTransport = createMockTransport();
    // maxAttempts left undefined — production-run-service.mjs's own (and
    // generateCarouselFromTopicPackage's/renderTemplatedPayload's own)
    // normal defaults apply, exactly as every other mock CLI in this
    // repository already relies on.
  }

  const result = await executeProductionRun({ assetId, contentAssetsDir }, { provider, renderTransport, carouselStore, maxAttempts });

  console.log(result.success ? "Production Run complete" : "Production Run did not complete successfully");
  console.log(`  request ID:          ${result.requestId}`);
  console.log(`  source:              ${result.sourceReference}`);
  console.log(`  execution ID:        ${result.executionId}`);
  console.log(`  carousel content ID: ${result.carouselContentId}`);
  console.log(`  carousel ID:         ${result.carouselId}`);
  console.log(`  status:              ${result.status}`);
  console.log(`  slide count:         ${result.slideCount}`);
  console.log(`  rendered slides:     ${result.renderedSlideCount}`);
  console.log(`  stored:              ${result.stored}`);
  console.log(`  store reference:     ${result.storeReference}`);
  console.log(`  duration:            ${result.duration}ms`);
  if (result.warnings.length > 0) {
    console.log(`  warnings:            ${result.warnings.length}`);
    for (const warning of result.warnings) console.log(`    - ${warning}`);
  }
  if (result.error) {
    // I016's own safe error shape (content-request-service.mjs, reused
    // unchanged): { code, message } only — see this file's header comment
    // for why a richer diagnostic isn't available here.
    console.log(`  error code:          ${result.error.code}`);
    console.log(`  error:               ${result.error.message}`);
  }

  process.exit(result.success ? 0 : 1);
} catch (error) {
  if (error instanceof PipelineConfigurationError) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

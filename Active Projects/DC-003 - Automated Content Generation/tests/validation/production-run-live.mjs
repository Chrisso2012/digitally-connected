// DC-003-I020 — CLI for the Production Run Service: the one entry point in
// this repository that can select LIVE Anthropic generation AND LIVE
// Templated rendering for one complete, real production run, persisted
// through I015. Mock by default (both generation and rendering) — safe to
// run anytime, no credentials needed, no network call of any kind without
// --live.
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
// always resolves to exactly 1 attempt per external request, via the SAME
// resolveLlmLiveMaxAttempts()/resolveLiveMaxAttempts() safety primitives
// DC-003-I019/I006 already established for their own --live CLIs —
// completely independent of LLM_MAX_ATTEMPTS/TEMPLATED_RENDER_MAX_ATTEMPTS.
// Unlike those two CLIs, this one has no --live-max-attempts override at
// all — the DC-003-I020 brief disallows any retry during the initial
// production run, with no override escape hatch, so none is offered here.
//
// Failure behaviour (enforced by production-run-service.mjs, not this
// CLI): an Anthropic failure stops before any Templated request is made; a
// Templated failure stops immediately after the failing slide, with no
// later slide requested; neither ever builds or persists a Finished
// Carousel from a partial result. See src/production-run-service.mjs's
// header comment for the full composition and README "Live Production Run
// (DC-003-I020)" for the architecture.

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
  let llmMaxAttempts;
  let renderMaxAttempts;

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

    llmMaxAttempts = resolveLlmLiveMaxAttempts(); // always 1 — no override flag on this CLI
    renderMaxAttempts = resolveRenderLiveMaxAttempts(); // always 1 — no override flag on this CLI

    console.log(`Running LIVE production run — Anthropic (${llmConfig.baseUrl}, model: ${llmConfig.model}) + Templated (${rendererConfig.baseUrl}).`);
    console.log(`  live-call budget: 1 Anthropic request maximum, 6 Templated requests maximum (stops on first render failure)`);
    console.log(`  maxAttempts: Anthropic=${llmMaxAttempts}, Templated=${renderMaxAttempts} (safe one-shot defaults, no retry, no override)`);

    provider = createAnthropicProvider({ transport: createLlmHttpTransport(llmConfig), model: llmConfig.model, timeoutMs: llmConfig.requestTimeoutMs });
    renderTransport = createRendererHttpTransport(rendererConfig);
  } else {
    provider = createMockProvider();
    renderTransport = createMockTransport();
    // llmMaxAttempts/renderMaxAttempts left undefined — the service's own
    // (and generateCarouselFromTopicPackage's/renderTemplatedPayload's own)
    // normal defaults apply, exactly as every other mock CLI in this
    // repository already relies on.
  }

  const result = await executeProductionRun({ assetId, contentAssetsDir }, { provider, renderTransport, carouselStore, llmMaxAttempts, renderMaxAttempts });

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
    console.log(`  error stage:         ${result.error.stage}`);
    console.log(`  error code:          ${result.error.code}`);
    console.log(`  error:               ${result.error.message}`);
    if (result.error.slideType) console.log(`  failed slide type:   ${result.error.slideType}`);
    if (result.error.diagnostic) {
      // DC-003-I019.1's safe diagnostic, surfaced one level higher —
      // status/errorType/requestId/sanitised message only.
      console.log(`  diagnostic status:    ${result.error.diagnostic.status ?? "unknown"}`);
      console.log(`  diagnostic errorType: ${result.error.diagnostic.errorType ?? "(none reported)"}`);
      console.log(`  diagnostic requestId: ${result.error.diagnostic.requestId ?? "(none reported)"}`);
      console.log(`  diagnostic message:   ${result.error.diagnostic.message ?? "(none reported)"}`);
    }
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

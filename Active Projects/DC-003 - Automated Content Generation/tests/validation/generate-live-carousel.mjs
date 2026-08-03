// DC-003-I019 — CLI demonstrating the real-provider generation path:
//
//   Content Asset (default GS01) -> topic_package -> Carousel Content
//   Generator (mock provider by default, real Anthropic provider only
//   with --live) -> validated Carousel Content -> Payload Mapper (I005,
//   unchanged) -> Renderer (ALWAYS the mock transport, regardless of
//   --live) -> printed summary.
//
// Rendering remains mock-only in this milestone, always — per the
// approved I019 brief's own closing instruction ("do not combine real
// LLM generation and real Templated rendering in the same milestone").
// There is no --live-render flag; none should ever be added to this
// file.
//
// Without --live, this CLI makes no network call of any kind — safe to
// run anytime, no credentials needed. --live requires LLM_API_KEY and
// performs a real, credentialed Anthropic API call — only use --live
// after the explicit Live Verification Gate the I019 brief describes
// (all tests green, fixture validation green, configuration confirmed
// locally without displaying secrets, exact model/endpoint/max-request-
// count reported, fresh Strategy Office + CEO approval) — never as part
// of automated testing.
//
// Live-verification safety rule (same pattern DC-003-I006 already
// established for --live Templated renders): --live ALWAYS defaults to
// exactly one attempt, completely independent of the normal production
// retry default (LLM_MAX_ATTEMPTS). Raising it requires an explicit
// --live-max-attempts=N flag on that specific invocation.
//
// Usage:
//   node tests/validation/generate-live-carousel.mjs [assetId] [--live] [--live-max-attempts=N] [contentAssetsDir]
//   or: npm run generate:live -- [assetId] [--live] [--live-max-attempts=N]
//
// assetId defaults to "GS01". contentAssetsDir defaults to the
// repository's own content-assets/ (DC-003-I018, unchanged).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContentAssetRepository } from "../../src/content-asset-repository.mjs";
import { generateCarouselFromTopicPackage } from "../../src/carousel-generator.mjs";
import { createMockProvider } from "../../src/carousel-mock-provider.mjs";
import { createAnthropicProvider } from "../../src/llm-provider-anthropic.mjs";
import { createHttpTransport } from "../../src/llm-transport-http.mjs";
import { loadLlmProviderConfig, resolveLiveMaxAttempts } from "../../src/llm-provider-config.mjs";
import { mapCarouselToTemplatedPayload } from "../../src/carousel-payload-mapper.mjs";
import { renderTemplatedPayload } from "../../src/renderer.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { PromptBuilderError, CarouselGenerationFailedError } from "../../src/carousel-generator-errors.mjs";
import { LlmProviderError, LlmClientError } from "../../src/llm-provider-errors.mjs";
import { UnknownContentAssetError, ContentAssetSchemaError, ContentAssetReadFailureError, InvalidContentAssetError } from "../../src/content-asset-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTENT_ASSETS_DIR = path.join(__dirname, "..", "..", "content-assets");

const args = process.argv.slice(2);
const isLive = args.includes("--live");
const liveMaxAttemptsArg = args.find((arg) => arg.startsWith("--live-max-attempts="));
const liveMaxAttemptsValue = liveMaxAttemptsArg ? liveMaxAttemptsArg.split("=")[1] : undefined;
const positional = args.filter((arg) => !arg.startsWith("--"));
const [assetIdArg, contentAssetsDirArg] = positional;
const assetId = assetIdArg ?? "GS01";

try {
  const contentAssetsDir = contentAssetsDirArg ?? DEFAULT_CONTENT_ASSETS_DIR;
  const repository = createContentAssetRepository({ assetsDir: contentAssetsDir });
  const asset = repository.get(assetId);
  const topicPackage = asset.topic_package;

  const config = loadLlmProviderConfig();
  let provider;
  let maxAttempts;

  if (isLive) {
    if (!config.apiKey) {
      console.error("FAIL  --live requires LLM_API_KEY to be set in the environment");
      process.exit(1);
    }
    maxAttempts = resolveLiveMaxAttempts(liveMaxAttemptsValue); // throws RangeError on a bad override
    console.log(`Generating LIVE via Anthropic (${config.baseUrl}, model: ${config.model}) — this performs a real API call.`);
    console.log(
      `  maxAttempts: ${maxAttempts}${liveMaxAttemptsValue ? " (explicit --live-max-attempts override)" : " (safe default, independent of LLM_MAX_ATTEMPTS)"}`
    );
    const transport = createHttpTransport(config);
    provider = createAnthropicProvider({ transport, model: config.model, timeoutMs: config.requestTimeoutMs });
  } else {
    maxAttempts = config.maxAttempts;
    provider = createMockProvider();
  }

  const carouselContent = await generateCarouselFromTopicPackage(topicPackage, { provider, maxAttempts });

  console.log("Carousel Content generated OK");
  console.log(`  carousel_content_id: ${carouselContent.carousel_content_id}`);
  console.log(`  topic_id:            ${carouselContent.topic_id}`);
  console.log(`  llm_model:           ${carouselContent.llm_model}`);
  console.log(`  prompt_version:      ${carouselContent.prompt_version}`);
  console.log(`  slides:              ${carouselContent.slides.length}`);

  // Rendering is ALWAYS mock, regardless of --live — see file header.
  const templatedPayloads = mapCarouselToTemplatedPayload(carouselContent);
  const transport = createMockTransport();
  const renderResults = [];
  for (const payload of templatedPayloads) {
    renderResults.push(await renderTemplatedPayload(payload, { transport }));
  }

  console.log("Mock payload/render path complete OK");
  console.log(`  payloads mapped:  ${templatedPayloads.length}`);
  console.log(`  slides rendered:  ${renderResults.length}`);
  console.log(`  render provider:  ${transport.name} (always mock in this milestone)`);
  for (const renderResult of renderResults) {
    console.log(`    [${renderResult.slideType}] ${renderResult.status} — ${renderResult.imageUrl}`);
  }

  process.exit(0);
} catch (error) {
  if (error instanceof RangeError) {
    console.error(`FAIL  ${error.message}`);
  } else if (
    error instanceof UnknownContentAssetError ||
    error instanceof ContentAssetSchemaError ||
    error instanceof ContentAssetReadFailureError ||
    error instanceof InvalidContentAssetError
  ) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else if (error instanceof PromptBuilderError) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else if (error instanceof CarouselGenerationFailedError) {
    console.error(`FAIL  CarouselGenerationFailedError — ${error.attempts.length}/${error.maxAttempts} attempts failed`);
    error.attempts.forEach((attempt, index) => {
      console.error(`  attempt ${index + 1}: [${attempt.stage}] ${attempt.message}`);
    });
  } else if (error instanceof LlmClientError) {
    // DC-003-I019.1: the one place this CLI can surface the safe
    // diagnostic buildSafeDiagnostic() builds — status/errorType/
    // requestId/sanitised message only. Fields may individually be null
    // when the provider's error body didn't match the expected shape;
    // never the raw response body, headers, API key, or prompt.
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
    const diagnostic = error.diagnostic ?? {};
    console.error(`  status:    ${diagnostic.status ?? "unknown"}`);
    console.error(`  errorType: ${diagnostic.errorType ?? "(none reported)"}`);
    console.error(`  requestId: ${diagnostic.requestId ?? "(none reported)"}`);
    console.error(`  message:   ${diagnostic.message ?? "(none reported)"}`);
  } else if (error instanceof LlmProviderError) {
    // Safe, structured diagnostics only — never the raw response body,
    // never headers, never the API key, never the full prompt.
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

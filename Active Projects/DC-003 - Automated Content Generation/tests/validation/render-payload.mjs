// DC-003-I006 — CLI entry point for local renderer verification.
//
// By default renders through the MOCK transport — safe to run anytime, no
// credentials needed, no network call made. Pass --live to render through
// the real Templated HTTP transport instead; this requires
// TEMPLATED_API_KEY and performs a real, credentialed API call — only use
// --live after the explicit live-verification confirmation described in
// the README, never as part of automated testing.
//
// Live-verification safety rule (added after an incident where a --live
// run fired three real requests instead of one): --live ALWAYS defaults to
// exactly one attempt, completely independent of the normal production
// retry default (TEMPLATED_RENDER_MAX_ATTEMPTS). Raising it requires an
// explicit --live-max-attempts=N flag on that specific invocation — never
// picked up implicitly from environment/config.
//
// Usage: node tests/validation/render-payload.mjs <path-to-templated-payload.json> [--live] [--live-max-attempts=N]
//    or: npm run render:mock -- <path>
//    or: npm run render:live -- <path>
//    or: npm run render:live -- <path> --live-max-attempts=2   (explicit opt-in only)

import { readFileSync } from "node:fs";
import { renderTemplatedPayload } from "../../src/renderer.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { createHttpTransport } from "../../src/renderer-transport-http.mjs";
import { loadRendererConfig, resolveLiveMaxAttempts } from "../../src/renderer-config.mjs";
import {
  RendererError,
  AuthenticationError,
  TransportError,
  TimeoutError,
  ValidationError,
  RetryLimitExceeded,
  RenderRejected,
} from "../../src/renderer-errors.mjs";

const args = process.argv.slice(2);
const isLive = args.includes("--live");
const liveMaxAttemptsArg = args.find((arg) => arg.startsWith("--live-max-attempts="));
const liveMaxAttemptsValue = liveMaxAttemptsArg ? liveMaxAttemptsArg.split("=")[1] : undefined;
const filePath = args.find((arg) => !arg.startsWith("--"));

if (!filePath) {
  console.error("Usage: node tests/validation/render-payload.mjs <path-to-templated-payload.json> [--live] [--live-max-attempts=N]");
  process.exit(1);
}

try {
  const payload = JSON.parse(readFileSync(filePath, "utf-8"));
  const config = loadRendererConfig();

  let transport;
  let maxAttempts;

  if (isLive) {
    if (!config.apiKey) {
      console.error("FAIL  --live requires TEMPLATED_API_KEY to be set in the environment");
      process.exit(1);
    }
    maxAttempts = resolveLiveMaxAttempts(liveMaxAttemptsValue); // throws RangeError on a bad override
    console.log(`Rendering LIVE via Templated (${config.baseUrl}) — this performs a real API call.`);
    console.log(
      `  maxAttempts: ${maxAttempts}${liveMaxAttemptsValue ? " (explicit --live-max-attempts override)" : " (safe default, independent of TEMPLATED_RENDER_MAX_ATTEMPTS)"}`
    );
    transport = createHttpTransport(config);
  } else {
    maxAttempts = config.maxAttempts;
    transport = createMockTransport();
  }

  const result = await renderTemplatedPayload(payload, {
    transport,
    maxAttempts,
    timeoutMs: config.requestTimeoutMs,
  });

  console.log("Render OK");
  console.log(`  render ID:    ${result.renderId}`);
  console.log(`  status:       ${result.status}`);
  console.log(`  image URL:    ${result.imageUrl ?? "(pending — no polling implemented in this milestone)"}`);
  console.log(`  template ID:  ${result.templateId}`);
  console.log(`  slide type:   ${result.slideType}`);
  console.log(`  provider:     ${result.provider}`);
  console.log(`  duration:     ${result.durationMs}ms`);
  process.exit(0);
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`FAIL  File not found: ${filePath}`);
  } else if (error instanceof SyntaxError) {
    console.error(`FAIL  Malformed JSON in ${filePath}: ${error.message}`);
  } else if (error instanceof RangeError) {
    console.error(`FAIL  ${error.message}`);
  } else if (error instanceof RetryLimitExceeded) {
    console.error(`FAIL  RetryLimitExceeded — ${error.attempts.length}/${error.maxAttempts} attempts failed`);
    error.attempts.forEach((attempt, index) => {
      console.error(`  attempt ${index + 1}: [${attempt.error?.name}] ${attempt.error?.message}`);
    });
  } else if (error instanceof ValidationError) {
    // Safe, structured diagnostics only — field path + expected/received
    // descriptor. Never the raw response body, never headers, never the API key.
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
    for (const detail of error.details) {
      console.error(`  - ${detail.field}: expected ${detail.expected}, received ${detail.received}`);
    }
  } else if (
    error instanceof AuthenticationError ||
    error instanceof TransportError ||
    error instanceof TimeoutError ||
    error instanceof RenderRejected ||
    error instanceof RendererError
  ) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

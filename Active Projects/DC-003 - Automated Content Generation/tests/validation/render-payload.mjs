// DC-003-I006 — CLI entry point for local renderer verification.
//
// By default renders through the MOCK transport — safe to run anytime, no
// credentials needed, no network call made. Pass --live to render through
// the real Templated HTTP transport instead; this requires
// TEMPLATED_API_KEY and performs a real, credentialed API call — only use
// --live after the explicit live-verification confirmation described in
// the README, never as part of automated testing.
//
// Usage: node tests/validation/render-payload.mjs <path-to-templated-payload.json> [--live]
//    or: npm run render:mock -- <path>
//    or: npm run render:live -- <path>

import { readFileSync } from "node:fs";
import { renderTemplatedPayload } from "../../src/renderer.mjs";
import { createMockTransport } from "../../src/renderer-transport-mock.mjs";
import { createHttpTransport } from "../../src/renderer-transport-http.mjs";
import { loadRendererConfig } from "../../src/renderer-config.mjs";
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
const filePath = args.find((arg) => !arg.startsWith("--"));

if (!filePath) {
  console.error("Usage: node tests/validation/render-payload.mjs <path-to-templated-payload.json> [--live]");
  process.exit(1);
}

try {
  const payload = JSON.parse(readFileSync(filePath, "utf-8"));
  const config = loadRendererConfig();

  let transport;
  if (isLive) {
    if (!config.apiKey) {
      console.error("FAIL  --live requires TEMPLATED_API_KEY to be set in the environment");
      process.exit(1);
    }
    console.log(`Rendering LIVE via Templated (${config.baseUrl}) — this performs a real API call.`);
    transport = createHttpTransport(config);
  } else {
    transport = createMockTransport();
  }

  const result = await renderTemplatedPayload(payload, {
    transport,
    maxAttempts: config.maxAttempts,
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
  } else if (error instanceof RetryLimitExceeded) {
    console.error(`FAIL  RetryLimitExceeded — ${error.attempts.length}/${error.maxAttempts} attempts failed`);
    error.attempts.forEach((attempt, index) => {
      console.error(`  attempt ${index + 1}: [${attempt.error?.name}] ${attempt.error?.message}`);
    });
  } else if (
    error instanceof AuthenticationError ||
    error instanceof TransportError ||
    error instanceof TimeoutError ||
    error instanceof ValidationError ||
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

// DC-003-I016 — CLI for the Content Request Command: parses one narrow
// command, executes the complete mock production path, and persists the
// resulting Finished Carousel via DC-003-I015. No live Templated call —
// mock rendering only, matching every other CLI in this codebase.
//
// Usage:
//   node tests/validation/content-request.mjs "<command>" <storeDirectory> [contentAssetsDir] [--json]
//
//   or: npm run content:request -- "<command>" <storeDirectory> [contentAssetsDir] [--json]
//
// contentAssetsDir defaults to the repository's own content-assets/
// directory (DC-003-I018's Content Asset Repository — see README
// "Content Asset Repository"). Was topicPackagesDir, defaulting to a
// test fixture directory, under DC-003-I016's original resolver; I018
// replaced that fixture-backed resolution with this repository-backed
// one, without changing this CLI's command syntax or result shape at
// all. Pass an explicit third argument to resolve against a different
// directory.
//
// --json (DC-003-I017 addition): prints exactly one line — the Content
// Request Result as JSON — instead of the human-readable summary below,
// and does the same for a thrown request-validation error (a JSON object
// in the same shape, `success: false`, `error: { code, message }`, every
// other field null/empty). Purely a stdout-formatting choice for a
// downstream parser (e.g. an n8n workflow's own Set node doing
// `JSON.parse($json.stdout)`, the same convention DC-003-I013 already
// established) — it calls no different code path, and changes no
// existing default-mode behavior; every DC-003-I016 test still exercises
// the unchanged human-readable mode.
//
// This CLI builds the same ledger -> orchestrator -> invocation adapter
// -> n8n adapter -> production workflow stack every other production-path
// CLI in this repo already builds (see production-workflow.mjs) — using
// an in-memory Ledger Store scoped to this one invocation, since the
// Execution Ledger's durable audit trail is a separate I008 concern this
// narrow command does not expose or manage.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutionLedger } from "../../src/execution-ledger.mjs";
import { createPipelineOrchestrator } from "../../src/pipeline-orchestrator.mjs";
import { createExternalInvocationAdapter } from "../../src/invocation-adapter.mjs";
import { createN8nAdapter } from "../../src/n8n-adapter.mjs";
import { createProductionWorkflow } from "../../src/production-workflow.mjs";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import { executeContentRequest } from "../../src/content-request-service.mjs";
import {
  AmbiguousContentRequestError,
  UnsupportedDesignCountError,
  ContentRequestValidationError,
} from "../../src/content-request-errors.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTENT_ASSETS_DIR = path.join(__dirname, "..", "..", "content-assets");

const rawArgs = process.argv.slice(2);
const jsonMode = rawArgs.includes("--json");
const [command, storeDirectory, contentAssetsDirArg] = rawArgs.filter((arg) => arg !== "--json");

function usageAndExit() {
  console.error('Usage: node tests/validation/content-request.mjs "<command>" <storeDirectory> [contentAssetsDir] [--json]');
  console.error('Example: node tests/validation/content-request.mjs "Create 6 designs based on article GS01" ./output/finished-carousels');
  process.exit(1);
}

if (!command || !storeDirectory) usageAndExit();

function safeErrorShape(error) {
  return { code: error.name, message: error.message };
}

function jsonFailureResult(error) {
  return {
    success: false,
    requestId: null,
    sourceReference: null,
    executionId: null,
    carouselId: null,
    status: "rejected",
    stored: false,
    storeReference: null,
    warnings: [],
    error: safeErrorShape(error),
  };
}

// A minimal, ephemeral Ledger Store scoped to this one CLI invocation —
// see the file header for why this command doesn't manage a durable
// ledger file itself.
function createInMemoryLedgerStore() {
  const records = [];
  return {
    name: "in-memory-content-request-cli-store",
    append(record) {
      records.push(record);
    },
    readAll() {
      return [...records];
    },
  };
}

function buildProductionWorkflow() {
  const ledger = createExecutionLedger({ store: createInMemoryLedgerStore() });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const invocationAdapter = createExternalInvocationAdapter({ orchestrator });
  const n8nAdapter = createN8nAdapter({ invocationAdapter });
  return createProductionWorkflow({ n8nAdapter });
}

try {
  const productionWorkflow = buildProductionWorkflow();
  const carouselStoreAdapter = createLocalJsonCarouselStoreAdapter({ storageDir: storeDirectory });
  const carouselStore = createFinishedCarouselStore({ adapter: carouselStoreAdapter });
  const contentAssetsDir = contentAssetsDirArg ?? DEFAULT_CONTENT_ASSETS_DIR;

  const result = await executeContentRequest(command, {
    productionWorkflow,
    carouselStore,
    contentAssetsDir,
  });

  if (jsonMode) {
    console.log(JSON.stringify(result));
  } else {
    console.log(result.success ? "Content Request complete" : "Content Request did not complete successfully");
    console.log(`  request ID:      ${result.requestId}`);
    console.log(`  source:          ${result.sourceReference}`);
    console.log(`  execution ID:    ${result.executionId}`);
    console.log(`  carousel ID:     ${result.carouselId}`);
    console.log(`  status:          ${result.status}`);
    console.log(`  stored:          ${result.stored}`);
    console.log(`  store reference: ${result.storeReference}`);
    if (result.warnings.length > 0) {
      console.log(`  warnings:        ${result.warnings.length}`);
      for (const warning of result.warnings) console.log(`    - ${warning}`);
    }
    if (result.error) {
      console.log(`  error code:      ${result.error.code}`);
      console.log(`  error:           ${result.error.message}`);
    }
  }

  process.exit(result.success ? 0 : 1);
} catch (error) {
  if (
    error instanceof AmbiguousContentRequestError ||
    error instanceof UnsupportedDesignCountError ||
    error instanceof ContentRequestValidationError ||
    error instanceof PipelineConfigurationError
  ) {
    if (jsonMode) {
      console.log(JSON.stringify(jsonFailureResult(error)));
    } else {
      console.error(`FAIL  ${error.name}`);
      console.error(`  ${error.message}`);
    }
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

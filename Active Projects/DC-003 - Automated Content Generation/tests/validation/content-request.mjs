// DC-003-I016 — CLI for the Content Request Command: parses one narrow
// command, executes the complete mock production path, and persists the
// resulting Finished Carousel via DC-003-I015. No live Templated call —
// mock rendering only, matching every other CLI in this codebase.
//
// Usage:
//   node tests/validation/content-request.mjs "<command>" <storeDirectory> [topicPackagesDir]
//
//   or: npm run content:request -- "<command>" <storeDirectory> [topicPackagesDir]
//
// topicPackagesDir defaults to tests/fixtures/topic-packages/ — this
// repository has no real article/source registry yet (see README
// "Content Request Command — current limitations"), so the default
// resolves against the same approved fixture Topic Packages this
// milestone's own tests use. Pass an explicit third argument to resolve
// against a different directory.
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
const DEFAULT_TOPIC_PACKAGES_DIR = path.join(__dirname, "..", "fixtures", "topic-packages");

const [command, storeDirectory, topicPackagesDirArg] = process.argv.slice(2);

function usageAndExit() {
  console.error('Usage: node tests/validation/content-request.mjs "<command>" <storeDirectory> [topicPackagesDir]');
  console.error('Example: node tests/validation/content-request.mjs "Create 6 designs based on article GS01" ./output/finished-carousels');
  process.exit(1);
}

if (!command || !storeDirectory) usageAndExit();

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
  const topicPackagesDir = topicPackagesDirArg ?? DEFAULT_TOPIC_PACKAGES_DIR;

  const result = await executeContentRequest(command, {
    productionWorkflow,
    carouselStore,
    topicPackagesDir,
  });

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

  process.exit(result.success ? 0 : 1);
} catch (error) {
  if (
    error instanceof AmbiguousContentRequestError ||
    error instanceof UnsupportedDesignCountError ||
    error instanceof ContentRequestValidationError ||
    error instanceof PipelineConfigurationError
  ) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

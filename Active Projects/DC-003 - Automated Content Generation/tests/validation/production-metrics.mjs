// DC-003-I023 — CLI for the Production Metrics Collector + Store: records
// one Production Metrics Record from already-completed result files, and
// reads them back. No provider calls of any kind — this CLI never talks
// to Anthropic, Templated, or Google Drive; it only reads JSON files
// already written by earlier CLIs (I020's production:live, I021's
// export:assets, I022's publish:assets) and the local metrics store.
//
// Usage:
//   node tests/validation/production-metrics.mjs record <productionResultPath> <metricsStoreDirectory> [--export=<exportResultPath>] [--publish=<publishResultPath>] [--anthropic-input-tokens=N] [--anthropic-output-tokens=N]
//   node tests/validation/production-metrics.mjs get <metricsId> <metricsStoreDirectory>
//   node tests/validation/production-metrics.mjs list <metricsStoreDirectory>
//   node tests/validation/production-metrics.mjs find-execution <executionId> <metricsStoreDirectory>
//
//   or: npm run metrics -- record <productionResultPath> <metricsStoreDirectory>
//   or: npm run metrics -- get <metricsId> <metricsStoreDirectory>
//   or: npm run metrics -- list <metricsStoreDirectory>
//   or: npm run metrics -- find-execution <executionId> <metricsStoreDirectory>
//
// `<productionResultPath>` is a JSON file shaped like I020's own
// Production Run Result (the CLI does not run a production run itself —
// I023 observes, it does not orchestrate, per the brief's own
// "Integration Boundaries"). `--export`/`--publish` are optional
// additional evidence files (I021's/I022's own result shapes).
// `--anthropic-input-tokens`/`--anthropic-output-tokens`: I020's own live
// CLI does not yet persist Anthropic token usage into its Production Run
// Result file (see README "Anthropic usage capture" for why this is a
// documented, narrowly-scoped gap, not an oversight) — supply real token
// counts here by hand (or from a future automated integration) when you
// have them; omitted means the Anthropic cost line is honestly reported
// as "unavailable", never guessed.
//
// `metricsStoreDirectory` is always an explicit, required argument — no
// default, no env var — matching every other storage-directory-taking
// CLI in this repository.

import { readFileSync } from "node:fs";
import { createLocalJsonProductionMetricsStoreAdapter } from "../../src/local-json-production-metrics-store-adapter.mjs";
import { createProductionMetricsStore } from "../../src/production-metrics-store.mjs";
import { collectProductionMetrics } from "../../src/production-metrics-collector.mjs";
import { loadProductionCostConfig } from "../../src/production-cost-config.mjs";
import {
  InvalidMetricsStoreAdapterError,
  InvalidMetricsIdentifierError,
  MetricsRecordAlreadyExistsError,
  MetricsRecordNotFoundError,
  CorruptedMetricsRecordError,
  MetricsPersistenceError,
} from "../../src/production-metrics-errors.mjs";
import { InvalidProductionMetricsInputError, ProductionMetricsValidationError } from "../../src/production-metrics-errors.mjs";

const KNOWN_ERRORS = [
  InvalidMetricsStoreAdapterError,
  InvalidMetricsIdentifierError,
  MetricsRecordAlreadyExistsError,
  MetricsRecordNotFoundError,
  CorruptedMetricsRecordError,
  MetricsPersistenceError,
  InvalidProductionMetricsInputError,
  ProductionMetricsValidationError,
];

function usageAndExit() {
  console.error("Usage: node tests/validation/production-metrics.mjs <record|get|list|find-execution> ...");
  console.error('  record <productionResultPath> <metricsStoreDirectory> [--export=<path>] [--publish=<path>] [--anthropic-input-tokens=N] [--anthropic-output-tokens=N]');
  console.error("  get <metricsId> <metricsStoreDirectory>");
  console.error("  list <metricsStoreDirectory>");
  console.error("  find-execution <executionId> <metricsStoreDirectory>");
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function flagValue(args, name) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

function printRecord(record) {
  console.log(`  metrics ID:      ${record.metrics_id}`);
  console.log(`  request ID:      ${record.request_id}`);
  console.log(`  execution ID:    ${record.execution_id}`);
  console.log(`  carousel ID:     ${record.carousel_id}`);
  console.log(`  status:          ${record.status}`);
  console.log(`  recorded at:     ${record.recorded_at}`);
  console.log(`  requests:        anthropic=${record.requests.anthropic}, templated=${record.requests.templated}, google_drive=${record.requests.google_drive}`);
  console.log(`  outputs:         generated=${record.outputs.slides_generated}, rendered=${record.outputs.slides_rendered}, exported=${record.outputs.files_exported}, published=${record.outputs.files_published}`);
  console.log(`  durations (ms):  generation=${record.durations_ms.generation}, render=${record.durations_ms.render}, export=${record.durations_ms.export}, publish=${record.durations_ms.publish}, total=${record.durations_ms.total}`);
  console.log(
    `  costs (${record.costs.currency}):     anthropic=${record.costs.anthropic.amount} (${record.costs.anthropic.calculation_type}), templated=${record.costs.templated.amount} (${record.costs.templated.calculation_type}), google_drive=${record.costs.google_drive.amount} (${record.costs.google_drive.calculation_type}), total=${record.costs.total}`
  );
}

const [command, ...rest] = process.argv.slice(2);
if (!command) usageAndExit();

try {
  if (command === "record") {
    const positional = rest.filter((arg) => !arg.startsWith("--"));
    const [productionResultPath, metricsStoreDirectory] = positional;
    if (!productionResultPath || !metricsStoreDirectory) usageAndExit();

    const exportPath = flagValue(rest, "export");
    const publishPath = flagValue(rest, "publish");
    const inputTokensArg = flagValue(rest, "anthropic-input-tokens");
    const outputTokensArg = flagValue(rest, "anthropic-output-tokens");

    const productionResult = readJson(productionResultPath);
    const exportResult = exportPath ? readJson(exportPath) : null;
    const publishResult = publishPath ? readJson(publishPath) : null;
    const anthropicUsage =
      inputTokensArg !== undefined && outputTokensArg !== undefined
        ? { inputTokens: Number(inputTokensArg), outputTokens: Number(outputTokensArg) }
        : null;

    const costConfig = loadProductionCostConfig();
    const metricsStore = createProductionMetricsStore({ adapter: createLocalJsonProductionMetricsStoreAdapter({ storageDir: metricsStoreDirectory }) });

    const record = collectProductionMetrics({ productionResult, exportResult, publishResult, anthropicUsage }, { costConfig });
    metricsStore.save(record);

    console.log("Metrics recorded");
    printRecord(record);
    process.exit(0);
  }

  if (command === "get") {
    const [metricsId, metricsStoreDirectory] = rest;
    if (!metricsId || !metricsStoreDirectory) usageAndExit();
    const metricsStore = createProductionMetricsStore({ adapter: createLocalJsonProductionMetricsStoreAdapter({ storageDir: metricsStoreDirectory }) });
    const record = metricsStore.get(metricsId);
    console.log("Metrics record found");
    printRecord(record);
    process.exit(0);
  }

  if (command === "list") {
    const [metricsStoreDirectory] = rest;
    if (!metricsStoreDirectory) usageAndExit();
    const metricsStore = createProductionMetricsStore({ adapter: createLocalJsonProductionMetricsStoreAdapter({ storageDir: metricsStoreDirectory }) });
    const summaries = metricsStore.list();
    console.log(`${summaries.length} metrics record(s)`);
    for (const summary of summaries) {
      console.log(`  [${summary.metrics_id}] execution=${summary.execution_id} status=${summary.status} total_cost=${summary.total_cost} ${summary.currency} recorded_at=${summary.recorded_at}`);
    }
    process.exit(0);
  }

  if (command === "find-execution") {
    const [executionId, metricsStoreDirectory] = rest;
    if (!executionId || !metricsStoreDirectory) usageAndExit();
    const metricsStore = createProductionMetricsStore({ adapter: createLocalJsonProductionMetricsStoreAdapter({ storageDir: metricsStoreDirectory }) });
    const records = metricsStore.findByExecutionId(executionId);
    console.log(`${records.length} matching metrics record(s) for execution "${executionId}"`);
    for (const record of records) {
      printRecord(record);
      console.log("  ---");
    }
    process.exit(0);
  }

  usageAndExit();
} catch (error) {
  if (KNOWN_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else if (error.code === "ENOENT") {
    console.error(`FAIL  File not found`);
  } else if (error instanceof SyntaxError) {
    console.error(`FAIL  Malformed JSON input: ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

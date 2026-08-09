// DC-003-I031 — CLI for the Editorial Package Generator: create, inspect,
// status, and list Editorial Package records. Mock Editorial Analysis
// Provider by default (no network, deterministic) — the ONLY mode
// automated tests use; pass --live to use the real Anthropic-backed
// provider instead (requires LLM_API_KEY — see README "Live mode").
// Consumes ONLY an Ingested Content record by ID — never reads a source
// article, never touches a Content Source Adapter — per the explicit
// architectural boundary set before this milestone began.
//
// Usage:
//   node tests/validation/editorial-package.mjs create <ingestedContentId> <ingestedContentStoreDirectory> <editorialPackageStoreDirectory> [--live] [--live-max-attempts=N] [--live-timeout-ms=N]
//   node tests/validation/editorial-package.mjs inspect <editorialPackageId> <editorialPackageStoreDirectory>
//   node tests/validation/editorial-package.mjs status <editorialPackageStoreDirectory>
//   node tests/validation/editorial-package.mjs list <editorialPackageStoreDirectory>
//
//   or: npm run editorial-package -- <subcommand> ...
//
// DC-003-I006/I019's own Live Verification Gate safety rule applies
// identically here: --live defaults to exactly one attempt, independent
// of LLM_MAX_ATTEMPTS, unless --live-max-attempts=N is explicitly given.
//
// DC-003-I031.1 — the --live per-request timeout defaults to 60000ms
// (resolveLiveRequestTimeoutMs(), llm-provider-config.mjs), independent
// of the shared loadLlmProviderConfig().requestTimeoutMs (still 15000ms,
// still what I032's own --live path uses, deliberately unchanged) —
// raised here only, after two independent genuine live Anthropic
// requests timed out at the old shared 15000ms default. Override with
// --live-timeout-ms=N for a one-off run.

import { createLocalJsonIngestedContentStoreAdapter } from "../../src/local-json-ingested-content-store-adapter.mjs";
import { createIngestedContentStore } from "../../src/ingested-content-store.mjs";
import { createLocalJsonEditorialPackageStoreAdapter } from "../../src/local-json-editorial-package-store-adapter.mjs";
import { createEditorialPackageStore } from "../../src/editorial-package-store.mjs";
import { generateEditorialPackage } from "../../src/editorial-package-generator.mjs";
import { createEditorialAnalysisMockProvider } from "../../src/editorial-analysis-mock-provider.mjs";
import { createAnthropicEditorialAnalysisProvider } from "../../src/editorial-analysis-anthropic-provider.mjs";
import { createEditorialAnalysisHttpTransport } from "../../src/editorial-analysis-transport-http.mjs";
import { loadLlmProviderConfig, resolveLiveMaxAttempts, resolveLiveRequestTimeoutMs } from "../../src/llm-provider-config.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { DuplicateEditorialPackageError, EditorialPackageGenerationFailedError } from "../../src/editorial-package-errors.mjs";
import {
  InvalidEditorialPackageStoreAdapterError,
  InvalidEditorialPackageIdentifierError,
  EditorialPackageAlreadyExistsError,
  EditorialPackageNotFoundError,
  CorruptedEditorialPackageError,
  EditorialPackagePersistenceError,
  InvalidEditorialPackageInputError,
  EditorialPackageValidationError,
} from "../../src/editorial-package-errors.mjs";
import {
  InvalidIngestedContentStoreAdapterError,
  InvalidIngestedContentIdentifierError,
  IngestedContentNotFoundError,
  CorruptedIngestedContentError,
  IngestedContentPersistenceError,
} from "../../src/ingested-content-errors.mjs";
import { InvalidEditorialAnalysisProviderError, MalformedEditorialAnalysisResultError, EditorialPromptBuilderError } from "../../src/editorial-analysis-errors.mjs";
import { LlmProviderError } from "../../src/llm-provider-errors.mjs";

const KNOWN_ERRORS = [
  PipelineConfigurationError,
  DuplicateEditorialPackageError,
  EditorialPackageGenerationFailedError,
  InvalidEditorialPackageStoreAdapterError,
  InvalidEditorialPackageIdentifierError,
  EditorialPackageAlreadyExistsError,
  EditorialPackageNotFoundError,
  CorruptedEditorialPackageError,
  EditorialPackagePersistenceError,
  InvalidEditorialPackageInputError,
  EditorialPackageValidationError,
  InvalidIngestedContentStoreAdapterError,
  InvalidIngestedContentIdentifierError,
  IngestedContentNotFoundError,
  CorruptedIngestedContentError,
  IngestedContentPersistenceError,
  InvalidEditorialAnalysisProviderError,
  MalformedEditorialAnalysisResultError,
  EditorialPromptBuilderError,
  LlmProviderError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error(
    "  node tests/validation/editorial-package.mjs create <ingestedContentId> <ingestedContentStoreDirectory> <editorialPackageStoreDirectory> [--live] [--live-max-attempts=N]"
  );
  console.error("  node tests/validation/editorial-package.mjs inspect <editorialPackageId> <editorialPackageStoreDirectory>");
  console.error("  node tests/validation/editorial-package.mjs status <editorialPackageStoreDirectory>");
  console.error("  node tests/validation/editorial-package.mjs list <editorialPackageStoreDirectory>");
  process.exit(1);
}

function buildIngestedContentStore(storeDirectory) {
  return createIngestedContentStore({ adapter: createLocalJsonIngestedContentStoreAdapter({ storageDir: storeDirectory }) });
}

function buildEditorialPackageStore(storeDirectory) {
  return createEditorialPackageStore({ adapter: createLocalJsonEditorialPackageStoreAdapter({ storageDir: storeDirectory }) });
}

function printSummaryLine(summary) {
  console.log(`  [${summary.editorial_package_id}] ingested=${summary.ingested_content_id} status=${summary.status.padEnd(9)} "${summary.primary_headline}"`);
}

function printFullRecord(record) {
  console.log(`  editorial_package_id: ${record.editorial_package_id}`);
  console.log(`  ingested_content_id:  ${record.ingested_content_id}`);
  console.log(`  status:               ${record.status}`);
  console.log(`  primary_headline:     ${record.primary_headline}`);
  console.log(`  supporting_headline:  ${record.supporting_headline}`);
  console.log(`  executive_summary:    ${record.executive_summary}`);
  console.log(`  core_message:         ${record.core_message}`);
  console.log(`  primary_audience:     ${record.primary_audience}`);
  console.log(`  primary_problem:      ${record.primary_problem}`);
  console.log(`  desired_outcome:      ${record.desired_outcome}`);
  console.log(`  key_insights:         ${JSON.stringify(record.key_insights)}`);
  console.log(`  pull_quotes:          ${JSON.stringify(record.pull_quotes)}`);
  console.log(`  call_to_action:       ${record.call_to_action}`);
  console.log(`  keywords:             ${JSON.stringify(record.keywords)}`);
  console.log(`  seo_title:            ${record.seo_title}`);
  console.log(`  seo_description:      ${record.seo_description}`);
  console.log(`  suggested_hashtags:   ${JSON.stringify(record.suggested_hashtags)}`);
  console.log(`  editorial_themes:     ${JSON.stringify(record.editorial_themes)}`);
  console.log(`  content_categories:   ${JSON.stringify(record.content_categories)}`);
  console.log(`  generated_at:         ${record.generated_at}`);
  console.log(`  llm_model:            ${record.llm_model}`);
  console.log(`  prompt_version:       ${record.prompt_version}`);
  console.log(`  schema_version:       ${record.schema_version}`);
  console.log(`  checksum:             ${record.checksum}`);
}

const args = process.argv.slice(2);
const isLive = args.includes("--live");
const liveMaxAttemptsArg = args.find((arg) => arg.startsWith("--live-max-attempts="));
const liveMaxAttemptsValue = liveMaxAttemptsArg ? liveMaxAttemptsArg.split("=")[1] : undefined;
const liveTimeoutMsArg = args.find((arg) => arg.startsWith("--live-timeout-ms="));
const liveTimeoutMsValue = liveTimeoutMsArg ? liveTimeoutMsArg.split("=")[1] : undefined;
const positional = args.filter((arg) => !arg.startsWith("--"));
const [subcommand, ...rest] = positional;

if (!subcommand) usageAndExit();

try {
  if (subcommand === "create") {
    const [ingestedContentId, ingestedContentStoreDirectory, editorialPackageStoreDirectory] = rest;
    if (!ingestedContentId || !ingestedContentStoreDirectory || !editorialPackageStoreDirectory) usageAndExit();

    const ingestedContentStore = buildIngestedContentStore(ingestedContentStoreDirectory);
    const editorialPackageStore = buildEditorialPackageStore(editorialPackageStoreDirectory);

    const config = loadLlmProviderConfig();
    let provider;
    let maxAttempts;

    if (isLive) {
      if (!config.apiKey) {
        console.error("FAIL  --live requires LLM_API_KEY to be set in the environment");
        process.exit(1);
      }
      maxAttempts = resolveLiveMaxAttempts(liveMaxAttemptsValue); // throws RangeError on a bad override
      const liveTimeoutMs = resolveLiveRequestTimeoutMs(liveTimeoutMsValue); // throws RangeError on a bad override
      console.log(`Generating LIVE via Anthropic (${config.baseUrl}, model: ${config.model}) — this performs a real API call.`);
      console.log(
        `  maxAttempts: ${maxAttempts}${liveMaxAttemptsValue ? " (explicit --live-max-attempts override)" : " (safe default, independent of LLM_MAX_ATTEMPTS)"}`
      );
      console.log(
        `  timeoutMs:   ${liveTimeoutMs}${liveTimeoutMsValue ? " (explicit --live-timeout-ms override)" : " (I031.1 live default, independent of LLM_REQUEST_TIMEOUT_MS)"}`
      );
      const transport = createEditorialAnalysisHttpTransport(config);
      provider = createAnthropicEditorialAnalysisProvider({ transport, model: config.model, timeoutMs: liveTimeoutMs });
    } else {
      maxAttempts = config.maxAttempts;
      provider = createEditorialAnalysisMockProvider();
    }

    const record = await generateEditorialPackage(ingestedContentId, { ingestedContentStore, editorialPackageStore, provider, maxAttempts });

    console.log("Editorial Package generated OK");
    printFullRecord(record);
  } else if (subcommand === "inspect") {
    const [editorialPackageId, storeDirectory] = rest;
    if (!editorialPackageId || !storeDirectory) usageAndExit();

    const store = buildEditorialPackageStore(storeDirectory);
    const record = store.get(editorialPackageId);

    console.log("Editorial Package found OK");
    console.log(JSON.stringify(record, null, 2));
  } else if (subcommand === "status") {
    const [storeDirectory] = rest;
    if (!storeDirectory) usageAndExit();

    const store = buildEditorialPackageStore(storeDirectory);
    const summaries = store.list();
    const latest = summaries.length > 0 ? summaries[summaries.length - 1] : null;

    console.log("Editorial Package status");
    console.log(`  total_editorial_packages: ${summaries.length}`);
    console.log(`  latest_package:           ${latest ? `[${latest.editorial_package_id}] "${latest.primary_headline}"` : "(none)"}`);
    console.log(`  latest_status:            ${latest ? latest.status : "(none)"}`);
  } else if (subcommand === "list") {
    const [storeDirectory] = rest;
    if (!storeDirectory) usageAndExit();

    const store = buildEditorialPackageStore(storeDirectory);
    const summaries = store.list();

    console.log(`${summaries.length} editorial package(s)`);
    for (const summary of summaries) printSummaryLine(summary);
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (KNOWN_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
    // DC-003-I031.3/I031.5 — safe, content-free structural diagnostics
    // only for the --live path (see describeArrayFieldShape()'s own
    // header comment): shape/type/length/boolean facts about whichever
    // canonical array<string> field actually failed, before and after
    // provider-boundary normalisation — never the actual generated
    // strings.
    if (isLive && error instanceof EditorialPackageGenerationFailedError) {
      for (const attempt of error.attempts ?? []) {
        if (attempt.fieldDiagnostics) {
          console.error(`  field diagnostics: ${JSON.stringify(attempt.fieldDiagnostics)}`);
        }
      }
    }
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

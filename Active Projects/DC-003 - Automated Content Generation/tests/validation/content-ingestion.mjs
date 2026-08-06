// DC-003-I030 — CLI for the Content Ingestion Engine: create, inspect,
// status, and list Ingested Content records. Mock Content Source Adapter
// by default (no network, deterministic) — the ONLY mode automated tests
// use; pass --live to use the real Google Docs adapter instead (requires
// GOOGLE_SERVICE_ACCOUNT_JSON — see README "Live mode"). No design/
// package/publishing logic anywhere in this file — ingestion only.
//
// Usage:
//   node tests/validation/content-ingestion.mjs create <sourceReference> <storeDirectory> [--live] [--min-words=<n>] [--title=<t>] [--body=<b>]
//   node tests/validation/content-ingestion.mjs inspect <ingestedContentId> <storeDirectory>
//   node tests/validation/content-ingestion.mjs status <storeDirectory>
//   node tests/validation/content-ingestion.mjs list <storeDirectory>
//
//   or: npm run content-ingestion -- <subcommand> ...
//
// --title / --body (create only, mock mode only): override the mock
// adapter's default fixture content for this one call — used by this
// CLI's own smoke tests and manual exercises without editing source.

import { createLocalJsonIngestedContentStoreAdapter } from "../../src/local-json-ingested-content-store-adapter.mjs";
import { createIngestedContentStore } from "../../src/ingested-content-store.mjs";
import { ingestContent, DEFAULT_MIN_WORD_COUNT } from "../../src/content-ingestion-service.mjs";
import { createContentSourceMockAdapter } from "../../src/content-source-mock-adapter.mjs";
import { createGoogleDocsSourceAdapter } from "../../src/google-docs-source-adapter.mjs";
import { loadGoogleDocsSourceConfig } from "../../src/google-docs-config.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { ArticleTooShortError, DuplicateIngestionError } from "../../src/content-ingestion-errors.mjs";
import {
  InvalidIngestedContentStoreAdapterError,
  InvalidIngestedContentIdentifierError,
  IngestedContentAlreadyExistsError,
  IngestedContentNotFoundError,
  CorruptedIngestedContentError,
  IngestedContentPersistenceError,
  InvalidIngestedContentInputError,
  IngestedContentValidationError,
} from "../../src/ingested-content-errors.mjs";
import {
  InvalidContentSourceAdapterError,
  MalformedContentSourceResultError,
  ContentSourceNotFoundError,
  ContentSourceAuthenticationError,
  ContentSourceRateLimitError,
  ContentSourceTransportError,
  ContentSourceConfigurationError,
} from "../../src/content-source-errors.mjs";

const KNOWN_ERRORS = [
  PipelineConfigurationError,
  ArticleTooShortError,
  DuplicateIngestionError,
  InvalidIngestedContentStoreAdapterError,
  InvalidIngestedContentIdentifierError,
  IngestedContentAlreadyExistsError,
  IngestedContentNotFoundError,
  CorruptedIngestedContentError,
  IngestedContentPersistenceError,
  InvalidIngestedContentInputError,
  IngestedContentValidationError,
  InvalidContentSourceAdapterError,
  MalformedContentSourceResultError,
  ContentSourceNotFoundError,
  ContentSourceAuthenticationError,
  ContentSourceRateLimitError,
  ContentSourceTransportError,
  ContentSourceConfigurationError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/content-ingestion.mjs create <sourceReference> <storeDirectory> [--live] [--min-words=<n>] [--title=<t>] [--body=<b>]");
  console.error("  node tests/validation/content-ingestion.mjs inspect <ingestedContentId> <storeDirectory>");
  console.error("  node tests/validation/content-ingestion.mjs status <storeDirectory>");
  console.error("  node tests/validation/content-ingestion.mjs list <storeDirectory>");
  process.exit(1);
}

function extractFlags(args) {
  const flags = {};
  const rest = [];
  for (const arg of args) {
    if (arg === "--live") {
      flags.live = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) {
      flags[match[1]] = match[2];
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

function buildStore(storeDirectory) {
  return createIngestedContentStore({ adapter: createLocalJsonIngestedContentStoreAdapter({ storageDir: storeDirectory }) });
}

function buildAdapter(flags, sourceReference) {
  if (!flags.live) {
    const fixtures = flags.title || flags.body ? { [sourceReference]: { title: flags.title ?? "Untitled", body: flags.body ?? "" } } : {};
    return createContentSourceMockAdapter({ fixtures });
  }
  const config = loadGoogleDocsSourceConfig(process.env);
  return createGoogleDocsSourceAdapter(config);
}

function printSummaryLine(summary) {
  console.log(
    `  [${summary.ingested_content_id}] source=${summary.source_type.padEnd(11)} status=${summary.status.padEnd(9)} approval=${summary.approval_state.padEnd(9)} ` +
      `words=${String(summary.word_count).padStart(6)} "${summary.title}"`
  );
}

function printFullRecord(record) {
  console.log(`  ingested_content_id: ${record.ingested_content_id}`);
  console.log(`  source_type:         ${record.source_type}`);
  console.log(`  source_reference:    ${record.source_reference}`);
  console.log(`  source_fingerprint:  ${record.source_fingerprint}`);
  console.log(`  title:               ${record.title}`);
  console.log(`  status:              ${record.status}`);
  console.log(`  approval_state:      ${record.approval_state}`);
  console.log(`  word_count:          ${record.word_count}`);
  console.log(`  metadata:            ${JSON.stringify(record.metadata)}`);
  console.log(`  created_at:          ${record.created_at}`);
  console.log(`  updated_at:          ${record.updated_at}`);
  console.log(`  checksum:            ${record.checksum}`);
}

const [subcommand, ...rest] = process.argv.slice(2);
const { flags, rest: positional } = extractFlags(rest);

if (!subcommand) usageAndExit();

try {
  if (subcommand === "create") {
    const [sourceReference, storeDirectory] = positional;
    if (!sourceReference || !storeDirectory) usageAndExit();

    const store = buildStore(storeDirectory);
    const adapter = buildAdapter(flags, sourceReference);
    const minWordCount = flags["min-words"] !== undefined ? Number(flags["min-words"]) : DEFAULT_MIN_WORD_COUNT;

    const record = await ingestContent({ sourceType: "google_docs", sourceReference }, { adapter, store, minWordCount });

    console.log("Ingested Content created OK");
    printFullRecord(record);
  } else if (subcommand === "inspect") {
    const [ingestedContentId, storeDirectory] = positional;
    if (!ingestedContentId || !storeDirectory) usageAndExit();

    const store = buildStore(storeDirectory);
    const record = store.get(ingestedContentId);

    console.log("Ingested Content found OK");
    console.log(JSON.stringify(record, null, 2));
  } else if (subcommand === "status") {
    const [storeDirectory] = positional;
    if (!storeDirectory) usageAndExit();

    const store = buildStore(storeDirectory);
    const summaries = store.list();

    const bySourceType = {};
    const byApprovalState = {};
    for (const summary of summaries) {
      bySourceType[summary.source_type] = (bySourceType[summary.source_type] ?? 0) + 1;
      byApprovalState[summary.approval_state] = (byApprovalState[summary.approval_state] ?? 0) + 1;
    }
    const latest = summaries.length > 0 ? summaries[summaries.length - 1] : null;

    console.log("Content Ingestion status");
    console.log(`  total_ingested:  ${summaries.length}`);
    console.log(`  by_source_type:  ${JSON.stringify(bySourceType)}`);
    console.log(`  by_approval:     ${JSON.stringify(byApprovalState)}`);
    console.log(`  latest:          ${latest ? `[${latest.ingested_content_id}] "${latest.title}"` : "(none)"}`);
  } else if (subcommand === "list") {
    const [storeDirectory] = positional;
    if (!storeDirectory) usageAndExit();

    const store = buildStore(storeDirectory);
    const summaries = store.list();

    console.log(`${summaries.length} ingested content record(s)`);
    for (const summary of summaries) printSummaryLine(summary);
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (KNOWN_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

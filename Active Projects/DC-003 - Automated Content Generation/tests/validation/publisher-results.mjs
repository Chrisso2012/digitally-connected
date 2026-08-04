// DC-003-I025 — CLI for the Publisher Result Store: read-only lookups
// against the local Publisher Result records I022's publisher service
// (production-asset-publisher-service.mjs) writes after every successful
// publish. This CLI never publishes anything — the publisher remains
// solely responsible for publishing (see `npm run publish:assets`); this
// CLI only reads back evidence a publish already produced.
//
// Usage:
//   node tests/validation/publisher-results.mjs list <publisherResultStoreDirectory>
//   node tests/validation/publisher-results.mjs get <publisherResultId> <publisherResultStoreDirectory>
//   node tests/validation/publisher-results.mjs carousel <carouselId> <publisherResultStoreDirectory>
//   node tests/validation/publisher-results.mjs execution <executionId> <publisherResultStoreDirectory>
//
//   or: npm run publisher-results -- <subcommand> ...

import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import {
  InvalidPublisherResultStoreAdapterError,
  InvalidPublisherResultIdentifierError,
  PublisherResultNotFoundError,
  CorruptedPublisherResultError,
  PublisherResultPersistenceError,
} from "../../src/publisher-result-errors.mjs";

const KNOWN_ERRORS = [
  InvalidPublisherResultStoreAdapterError,
  InvalidPublisherResultIdentifierError,
  PublisherResultNotFoundError,
  CorruptedPublisherResultError,
  PublisherResultPersistenceError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/publisher-results.mjs list <publisherResultStoreDirectory>");
  console.error("  node tests/validation/publisher-results.mjs get <publisherResultId> <publisherResultStoreDirectory>");
  console.error("  node tests/validation/publisher-results.mjs carousel <carouselId> <publisherResultStoreDirectory>");
  console.error("  node tests/validation/publisher-results.mjs execution <executionId> <publisherResultStoreDirectory>");
  process.exit(1);
}

function printSummaryLine(summary) {
  console.log(
    `  [${summary.publisher_result_id}] carousel=${summary.carousel_id} execution=${summary.execution_id} ` +
      `package=${summary.asset_package_id} provider=${summary.provider} published_at=${summary.published_at}`
  );
}

function printFullResult(result) {
  console.log(`  publisher_result_id: ${result.publisher_result_id}`);
  console.log(`  carousel_id:         ${result.carousel_id}`);
  console.log(`  asset_package_id:    ${result.asset_package_id}`);
  console.log(`  execution_id:        ${result.execution_id}`);
  console.log(`  provider:            ${result.provider}`);
  console.log(`  destination:         ${result.destination}`);
  console.log(`  provider_reference:  ${result.provider_reference}`);
  console.log(`  published_at:        ${result.published_at}`);
  console.log(`  status:              ${result.status}`);
  console.log(`  metadata:            ${JSON.stringify(result.metadata)}`);
}

function buildStore(storeDirectory) {
  return createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: storeDirectory }) });
}

const [subcommand, ...rest] = process.argv.slice(2);
if (!subcommand) usageAndExit();

try {
  if (subcommand === "list") {
    const [storeDirectory] = rest;
    if (!storeDirectory) usageAndExit();
    const summaries = buildStore(storeDirectory).list();
    console.log(`${summaries.length} publisher result(s)`);
    for (const summary of summaries) printSummaryLine(summary);
  } else if (subcommand === "get") {
    const [publisherResultId, storeDirectory] = rest;
    if (!publisherResultId || !storeDirectory) usageAndExit();
    const result = buildStore(storeDirectory).get(publisherResultId);
    console.log("Publisher result found");
    printFullResult(result);
  } else if (subcommand === "carousel") {
    const [carouselId, storeDirectory] = rest;
    if (!carouselId || !storeDirectory) usageAndExit();
    const results = buildStore(storeDirectory).findByCarousel(carouselId);
    console.log(`${results.length} publisher result(s) for carousel "${carouselId}"`);
    for (const result of results) {
      printFullResult(result);
      console.log("  ---");
    }
  } else if (subcommand === "execution") {
    const [executionId, storeDirectory] = rest;
    if (!executionId || !storeDirectory) usageAndExit();
    const results = buildStore(storeDirectory).findByExecution(executionId);
    console.log(`${results.length} publisher result(s) for execution "${executionId}"`);
    for (const result of results) {
      printFullResult(result);
      console.log("  ---");
    }
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

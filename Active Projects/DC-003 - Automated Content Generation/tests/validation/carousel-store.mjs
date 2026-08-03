// DC-003-I015 — CLI for the Finished Carousel Store: save, retrieve, list,
// and replace stored Finished Carousel Objects against a local JSON
// storage directory. No network, no ledger writes, no approval logic —
// this CLI persists exactly what it's given.
//
// Usage:
//   node tests/validation/carousel-store.mjs save <finishedCarouselPath> <storeDirectory>
//   node tests/validation/carousel-store.mjs get <identifier> <storeDirectory>
//   node tests/validation/carousel-store.mjs list <storeDirectory>
//   node tests/validation/carousel-store.mjs replace <finishedCarouselPath> <storeDirectory>
//
//   or: npm run store -- <subcommand> ...

import { readFileSync } from "node:fs";
import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import {
  InvalidCarouselStoreAdapterError,
  InvalidFinishedCarouselError,
  InvalidCarouselIdentifierError,
  CarouselAlreadyExistsError,
  CarouselNotFoundError,
  CarouselIdentifierMismatchError,
  CorruptedCarouselError,
  CarouselPersistenceError,
} from "../../src/finished-carousel-store-errors.mjs";

const [subcommand, ...rest] = process.argv.slice(2);

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/carousel-store.mjs save <finishedCarouselPath> <storeDirectory>");
  console.error("  node tests/validation/carousel-store.mjs get <identifier> <storeDirectory>");
  console.error("  node tests/validation/carousel-store.mjs list <storeDirectory>");
  console.error("  node tests/validation/carousel-store.mjs replace <finishedCarouselPath> <storeDirectory>");
  process.exit(1);
}

function printSummaryLine(summary) {
  console.log(
    `  [${summary.carousel_id}] topic=${summary.topic_id} exec=${summary.execution_id} status=${summary.overall_status} ` +
      `slides=${summary.slide_count} approved=${summary.approved} rejected=${summary.rejected} published=${summary.published} ` +
      `generated_at=${summary.generated_at}`
  );
}

if (!subcommand) usageAndExit();

try {
  if (subcommand === "save" || subcommand === "replace") {
    const [finishedCarouselPath, storeDirectory] = rest;
    if (!finishedCarouselPath || !storeDirectory) usageAndExit();

    const finishedCarousel = JSON.parse(readFileSync(finishedCarouselPath, "utf-8"));
    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: storeDirectory });
    const store = createFinishedCarouselStore({ adapter });

    const stored =
      subcommand === "save"
        ? store.save(finishedCarousel)
        : store.replace({ identifier: finishedCarousel.carousel_id, finishedCarousel });

    console.log(`Carousel ${subcommand} OK`);
    console.log(`  carousel ID: ${stored.carousel_id}`);
    console.log(`  stored at:   ${storeDirectory}`);
  } else if (subcommand === "get") {
    const [identifier, storeDirectory] = rest;
    if (!identifier || !storeDirectory) usageAndExit();

    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: storeDirectory });
    const store = createFinishedCarouselStore({ adapter });
    const carousel = store.get(identifier);

    console.log("Carousel found OK");
    console.log(JSON.stringify(carousel, null, 2));
  } else if (subcommand === "list") {
    const [storeDirectory] = rest;
    if (!storeDirectory) usageAndExit();

    const adapter = createLocalJsonCarouselStoreAdapter({ storageDir: storeDirectory });
    const store = createFinishedCarouselStore({ adapter });
    const summaries = store.list();

    console.log(`${summaries.length} carousel(s)`);
    for (const summary of summaries) printSummaryLine(summary);
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`FAIL  File not found: ${error.path ?? rest[0]}`);
  } else if (error instanceof SyntaxError) {
    console.error(`FAIL  Malformed JSON: ${error.message}`);
  } else if (
    error instanceof InvalidCarouselStoreAdapterError ||
    error instanceof InvalidFinishedCarouselError ||
    error instanceof InvalidCarouselIdentifierError ||
    error instanceof CarouselAlreadyExistsError ||
    error instanceof CarouselNotFoundError ||
    error instanceof CarouselIdentifierMismatchError ||
    error instanceof CorruptedCarouselError ||
    error instanceof CarouselPersistenceError
  ) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

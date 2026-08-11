// DC-003-I032.10.1 — CLI for the Carousel Content Package Store: import,
// inspect, and list Carousel Content Package records. No network, no AI
// provider of any kind — this object is never AI-generated, it is
// authored entirely upstream (Claude Cowork) and CEO-approved before it
// ever reaches this CLI.
//
// Usage:
//   node tests/validation/carousel-content-package.mjs import <fieldsFilePath> <storeDirectory>
//   node tests/validation/carousel-content-package.mjs inspect <carouselContentPackageId> <storeDirectory>
//   node tests/validation/carousel-content-package.mjs list <storeDirectory>
//
//   or: npm run carousel-content-package -- <subcommand> ...
//
// `import` reads a FIELDS file — the same shape createCarouselContentPackage()
// itself accepts (camelCase top-level keys: sourceArticleTitle,
// sourceArticleReference, industryName, industrySeries, carouselTitle,
// slides, approvedBy, approvedAt — see src/carousel-content-package.mjs's
// own header comment) — NOT an already-fully-formed record. The factory
// computes carousel_content_package_id/created_at/checksum/schema_version/
// production_authority; nothing in the fields file can override them.

import { readFileSync } from "node:fs";
import { createCarouselContentPackage } from "../../src/carousel-content-package.mjs";
import { createCarouselContentPackageStore } from "../../src/carousel-content-package-store.mjs";
import { createLocalJsonCarouselContentPackageStoreAdapter } from "../../src/local-json-carousel-content-package-store-adapter.mjs";
import { loadVersions } from "../../src/config-loader.mjs";
import {
  InvalidCarouselContentPackageInputError,
  CarouselContentPackageValidationError,
  EmphasisPhraseNotFoundError,
  ConflictingEmphasisInstructionsError,
  InvalidCarouselContentPackageStoreAdapterError,
  InvalidCarouselContentPackageIdentifierError,
  CarouselContentPackageAlreadyExistsError,
  CarouselContentPackageNotFoundError,
  CorruptedCarouselContentPackageError,
  CarouselContentPackagePersistenceError,
} from "../../src/carousel-content-package-errors.mjs";

const KNOWN_ERRORS = [
  InvalidCarouselContentPackageInputError,
  CarouselContentPackageValidationError,
  EmphasisPhraseNotFoundError,
  ConflictingEmphasisInstructionsError,
  InvalidCarouselContentPackageStoreAdapterError,
  InvalidCarouselContentPackageIdentifierError,
  CarouselContentPackageAlreadyExistsError,
  CarouselContentPackageNotFoundError,
  CorruptedCarouselContentPackageError,
  CarouselContentPackagePersistenceError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/carousel-content-package.mjs import <fieldsFilePath> <storeDirectory>");
  console.error("  node tests/validation/carousel-content-package.mjs inspect <carouselContentPackageId> <storeDirectory>");
  console.error("  node tests/validation/carousel-content-package.mjs list <storeDirectory>");
  process.exit(1);
}

function buildStore(storeDirectory) {
  return createCarouselContentPackageStore({ adapter: createLocalJsonCarouselContentPackageStoreAdapter({ storageDir: storeDirectory }) });
}

function printSummaryLine(summary) {
  console.log(`  [${summary.carousel_content_package_id}] "${summary.carousel_title}" industry=${summary.industry_name} slides=${summary.total_slides}`);
}

function printFullRecord(record) {
  console.log(`  carousel_content_package_id: ${record.carousel_content_package_id}`);
  console.log(`  package_type:                ${record.package_type}`);
  console.log(`  package_version:              ${record.package_version}`);
  console.log(`  source_article_title:        ${record.source_article_title}`);
  console.log(`  source_article_reference:    ${record.source_article_reference}`);
  console.log(`  industry_name:               ${record.industry_name}`);
  console.log(`  industry_series:             ${record.industry_series}`);
  console.log(`  carousel_title:              ${record.carousel_title}`);
  console.log(`  total_slides:                ${record.total_slides}`);
  console.log(`  slides:                      ${JSON.stringify(record.slides, null, 2)}`);
  console.log(`  approval:                    ${JSON.stringify(record.approval)}`);
  console.log(`  production_authority:        ${JSON.stringify(record.production_authority)}`);
  console.log(`  created_at:                  ${record.created_at}`);
  console.log(`  schema_version:              ${record.schema_version}`);
  console.log(`  checksum:                    ${record.checksum}`);
}

const [subcommand, ...rest] = process.argv.slice(2);

if (!subcommand) usageAndExit();

try {
  if (subcommand === "import") {
    const [fieldsFilePath, storeDirectory] = rest;
    if (!fieldsFilePath || !storeDirectory) usageAndExit();

    const fields = JSON.parse(readFileSync(fieldsFilePath, "utf-8"));
    const schemaVersion = fields.schemaVersion ?? loadVersions().schema_versions?.carousel_content_package;

    const carouselContentPackage = createCarouselContentPackage({ ...fields, schemaVersion });
    const store = buildStore(storeDirectory);
    const record = store.save(carouselContentPackage);

    console.log("Carousel Content Package imported OK");
    printFullRecord(record);
  } else if (subcommand === "inspect") {
    const [carouselContentPackageId, storeDirectory] = rest;
    if (!carouselContentPackageId || !storeDirectory) usageAndExit();

    const store = buildStore(storeDirectory);
    const record = store.get(carouselContentPackageId);

    console.log("Carousel Content Package found OK");
    console.log(JSON.stringify(record, null, 2));
  } else if (subcommand === "list") {
    const [storeDirectory] = rest;
    if (!storeDirectory) usageAndExit();

    const store = buildStore(storeDirectory);
    const summaries = store.list();

    console.log(`${summaries.length} carousel content package(s)`);
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

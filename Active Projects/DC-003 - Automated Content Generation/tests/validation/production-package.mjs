// DC-003-I033 — CLI for the Production Package Generator: create,
// inspect, status, and list Production Package records. Templated
// Renderer Adapter by default (the only one implemented this
// milestone) — no network of any kind, no --live flag exists at all,
// since this milestone has no AI/LLM step and never calls a renderer's
// API (see README "Out of scope"). Consumes ONLY a Social Media Package
// record by ID — never reads Editorial Package, Ingested Content,
// Google Docs, any Content Source, or a raw article — per the explicit
// architectural boundary set before this milestone began.
//
// Usage:
//   node tests/validation/production-package.mjs create <socialMediaPackageId> <socialMediaPackageStoreDirectory> <productionPackageStoreDirectory> [--platform=<platform>]
//   node tests/validation/production-package.mjs inspect <productionPackageId> <productionPackageStoreDirectory>
//   node tests/validation/production-package.mjs status <productionPackageStoreDirectory>
//   node tests/validation/production-package.mjs list <productionPackageStoreDirectory>
//
//   or: npm run production-package -- <subcommand> ...

import { createLocalJsonSocialMediaPackageStoreAdapter } from "../../src/local-json-social-media-package-store-adapter.mjs";
import { createSocialMediaPackageStore } from "../../src/social-media-package-store.mjs";
import { createLocalJsonProductionPackageStoreAdapter } from "../../src/local-json-production-package-store-adapter.mjs";
import { createProductionPackageStore } from "../../src/production-package-store.mjs";
import { generateProductionPackage } from "../../src/production-package-generator.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { DuplicateProductionPackageError } from "../../src/production-package-errors.mjs";
import {
  InvalidProductionPackageStoreAdapterError,
  InvalidProductionPackageIdentifierError,
  ProductionPackageAlreadyExistsError,
  ProductionPackageNotFoundError,
  CorruptedProductionPackageError,
  ProductionPackagePersistenceError,
  InvalidProductionPackageInputError,
  ProductionPackageValidationError,
  InvalidRendererAdapterError,
  RequiredRendererMappingMissingError,
  InvalidTemplateMappingError,
} from "../../src/production-package-errors.mjs";
import {
  InvalidSocialMediaPackageStoreAdapterError,
  InvalidSocialMediaPackageIdentifierError,
  SocialMediaPackageNotFoundError,
  CorruptedSocialMediaPackageError,
  SocialMediaPackagePersistenceError,
} from "../../src/social-media-package-errors.mjs";

const KNOWN_ERRORS = [
  PipelineConfigurationError,
  DuplicateProductionPackageError,
  InvalidProductionPackageStoreAdapterError,
  InvalidProductionPackageIdentifierError,
  ProductionPackageAlreadyExistsError,
  ProductionPackageNotFoundError,
  CorruptedProductionPackageError,
  ProductionPackagePersistenceError,
  InvalidProductionPackageInputError,
  ProductionPackageValidationError,
  InvalidRendererAdapterError,
  RequiredRendererMappingMissingError,
  InvalidTemplateMappingError,
  InvalidSocialMediaPackageStoreAdapterError,
  InvalidSocialMediaPackageIdentifierError,
  SocialMediaPackageNotFoundError,
  CorruptedSocialMediaPackageError,
  SocialMediaPackagePersistenceError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error(
    "  node tests/validation/production-package.mjs create <socialMediaPackageId> <socialMediaPackageStoreDirectory> <productionPackageStoreDirectory> [--platform=<platform>]"
  );
  console.error("  node tests/validation/production-package.mjs inspect <productionPackageId> <productionPackageStoreDirectory>");
  console.error("  node tests/validation/production-package.mjs status <productionPackageStoreDirectory>");
  console.error("  node tests/validation/production-package.mjs list <productionPackageStoreDirectory>");
  process.exit(1);
}

function buildSocialMediaPackageStore(storeDirectory) {
  return createSocialMediaPackageStore({ adapter: createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: storeDirectory }) });
}

function buildProductionPackageStore(storeDirectory) {
  return createProductionPackageStore({ adapter: createLocalJsonProductionPackageStoreAdapter({ storageDir: storeDirectory }) });
}

function printSummaryLine(summary) {
  console.log(`  [${summary.production_package_id}] social_media=${summary.social_media_package_id} status=${summary.status.padEnd(9)} renderer=${summary.renderer} template=${summary.template_id}`);
}

function printFullRecord(record) {
  console.log(`  production_package_id:   ${record.production_package_id}`);
  console.log(`  social_media_package_id: ${record.social_media_package_id}`);
  console.log(`  status:                  ${record.status}`);
  console.log(`  renderer:                ${record.renderer}`);
  console.log(`  platform:                ${record.platform}`);
  console.log(`  design_id:               ${record.design_id}`);
  console.log(`  template_id:             ${record.template_id}`);
  console.log(`  slide_sequence:          ${JSON.stringify(record.slide_sequence, null, 2)}`);
  console.log(`  rendering_metadata:      ${JSON.stringify(record.rendering_metadata)}`);
  console.log(`  validation_metadata:     ${JSON.stringify(record.validation_metadata)}`);
  console.log(`  generated_at:            ${record.generated_at}`);
  console.log(`  schema_version:          ${record.schema_version}`);
  console.log(`  production_checksum:     ${record.production_checksum}`);
}

const args = process.argv.slice(2);
const platformArg = args.find((arg) => arg.startsWith("--platform="));
const platformValue = platformArg ? platformArg.split("=")[1] : null;
const positional = args.filter((arg) => !arg.startsWith("--"));
const [subcommand, ...rest] = positional;

if (!subcommand) usageAndExit();

try {
  if (subcommand === "create") {
    const [socialMediaPackageId, socialMediaPackageStoreDirectory, productionPackageStoreDirectory] = rest;
    if (!socialMediaPackageId || !socialMediaPackageStoreDirectory || !productionPackageStoreDirectory) usageAndExit();

    const socialMediaPackageStore = buildSocialMediaPackageStore(socialMediaPackageStoreDirectory);
    const productionPackageStore = buildProductionPackageStore(productionPackageStoreDirectory);

    const record = await generateProductionPackage(socialMediaPackageId, { socialMediaPackageStore, productionPackageStore, platform: platformValue });

    console.log("Production Package generated OK");
    printFullRecord(record);
  } else if (subcommand === "inspect") {
    const [productionPackageId, storeDirectory] = rest;
    if (!productionPackageId || !storeDirectory) usageAndExit();

    const store = buildProductionPackageStore(storeDirectory);
    const record = store.get(productionPackageId);

    console.log("Production Package found OK");
    console.log(JSON.stringify(record, null, 2));
  } else if (subcommand === "status") {
    const [storeDirectory] = rest;
    if (!storeDirectory) usageAndExit();

    const store = buildProductionPackageStore(storeDirectory);
    const summaries = store.list();
    const latest = summaries.length > 0 ? summaries[summaries.length - 1] : null;

    console.log("Production Package status");
    console.log(`  total_production_packages: ${summaries.length}`);
    console.log(`  latest_package:             ${latest ? `[${latest.production_package_id}] renderer=${latest.renderer}` : "(none)"}`);
    console.log(`  latest_status:              ${latest ? latest.status : "(none)"}`);
  } else if (subcommand === "list") {
    const [storeDirectory] = rest;
    if (!storeDirectory) usageAndExit();

    const store = buildProductionPackageStore(storeDirectory);
    const summaries = store.list();

    console.log(`${summaries.length} production package(s)`);
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

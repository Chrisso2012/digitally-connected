// DC-003-I032 — CLI for the Social Media Package Generator: create,
// inspect, status, and list Social Media Package records. Mock Social
// Media provider by default (no network, deterministic) — the ONLY mode
// automated tests use; pass --live to use the real Anthropic-backed
// provider instead (requires LLM_API_KEY — see README "Live mode").
// Consumes ONLY an Editorial Package record by ID — never reads Ingested
// Content, Google Docs, any Content Source, or a raw article — per the
// explicit architectural boundary set before this milestone began.
//
// Usage:
//   node tests/validation/social-media-package.mjs create <editorialPackageId> <editorialPackageStoreDirectory> <socialMediaPackageStoreDirectory> [--live] [--live-max-attempts=N]
//   node tests/validation/social-media-package.mjs inspect <socialMediaPackageId> <socialMediaPackageStoreDirectory>
//   node tests/validation/social-media-package.mjs status <socialMediaPackageStoreDirectory>
//   node tests/validation/social-media-package.mjs list <socialMediaPackageStoreDirectory>
//
//   or: npm run social-media-package -- <subcommand> ...
//
// DC-003-I006/I019's own Live Verification Gate safety rule applies
// identically here: --live defaults to exactly one attempt, independent
// of LLM_MAX_ATTEMPTS, unless --live-max-attempts=N is explicitly given.

import { createLocalJsonEditorialPackageStoreAdapter } from "../../src/local-json-editorial-package-store-adapter.mjs";
import { createEditorialPackageStore } from "../../src/editorial-package-store.mjs";
import { createLocalJsonSocialMediaPackageStoreAdapter } from "../../src/local-json-social-media-package-store-adapter.mjs";
import { createSocialMediaPackageStore } from "../../src/social-media-package-store.mjs";
import { generateSocialMediaPackage } from "../../src/social-media-package-generator.mjs";
import { createSocialMediaMockProvider } from "../../src/social-media-mock-provider.mjs";
import { createAnthropicSocialMediaProvider } from "../../src/social-media-anthropic-provider.mjs";
import { createSocialMediaHttpTransport } from "../../src/social-media-transport-http.mjs";
import { loadLlmProviderConfig, resolveLiveMaxAttempts } from "../../src/llm-provider-config.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { DuplicateSocialMediaPackageError, SocialMediaPackageGenerationFailedError } from "../../src/social-media-package-errors.mjs";
import {
  InvalidSocialMediaPackageStoreAdapterError,
  InvalidSocialMediaPackageIdentifierError,
  SocialMediaPackageAlreadyExistsError,
  SocialMediaPackageNotFoundError,
  CorruptedSocialMediaPackageError,
  SocialMediaPackagePersistenceError,
  InvalidSocialMediaPackageInputError,
  SocialMediaPackageValidationError,
} from "../../src/social-media-package-errors.mjs";
import {
  InvalidEditorialPackageStoreAdapterError,
  InvalidEditorialPackageIdentifierError,
  EditorialPackageNotFoundError,
  CorruptedEditorialPackageError,
  EditorialPackagePersistenceError,
} from "../../src/editorial-package-errors.mjs";
import { InvalidSocialMediaProviderError, MalformedSocialMediaResultError, SocialMediaPromptBuilderError } from "../../src/social-media-analysis-errors.mjs";
import { LlmProviderError } from "../../src/llm-provider-errors.mjs";

const KNOWN_ERRORS = [
  PipelineConfigurationError,
  DuplicateSocialMediaPackageError,
  SocialMediaPackageGenerationFailedError,
  InvalidSocialMediaPackageStoreAdapterError,
  InvalidSocialMediaPackageIdentifierError,
  SocialMediaPackageAlreadyExistsError,
  SocialMediaPackageNotFoundError,
  CorruptedSocialMediaPackageError,
  SocialMediaPackagePersistenceError,
  InvalidSocialMediaPackageInputError,
  SocialMediaPackageValidationError,
  InvalidEditorialPackageStoreAdapterError,
  InvalidEditorialPackageIdentifierError,
  EditorialPackageNotFoundError,
  CorruptedEditorialPackageError,
  EditorialPackagePersistenceError,
  InvalidSocialMediaProviderError,
  MalformedSocialMediaResultError,
  SocialMediaPromptBuilderError,
  LlmProviderError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error(
    "  node tests/validation/social-media-package.mjs create <editorialPackageId> <editorialPackageStoreDirectory> <socialMediaPackageStoreDirectory> [--live] [--live-max-attempts=N]"
  );
  console.error("  node tests/validation/social-media-package.mjs inspect <socialMediaPackageId> <socialMediaPackageStoreDirectory>");
  console.error("  node tests/validation/social-media-package.mjs status <socialMediaPackageStoreDirectory>");
  console.error("  node tests/validation/social-media-package.mjs list <socialMediaPackageStoreDirectory>");
  process.exit(1);
}

function buildEditorialPackageStore(storeDirectory) {
  return createEditorialPackageStore({ adapter: createLocalJsonEditorialPackageStoreAdapter({ storageDir: storeDirectory }) });
}

function buildSocialMediaPackageStore(storeDirectory) {
  return createSocialMediaPackageStore({ adapter: createLocalJsonSocialMediaPackageStoreAdapter({ storageDir: storeDirectory }) });
}

function printSummaryLine(summary) {
  console.log(`  [${summary.social_media_package_id}] editorial=${summary.editorial_package_id} status=${summary.status.padEnd(9)} "${summary.hook}"`);
}

function printFullRecord(record) {
  console.log(`  social_media_package_id: ${record.social_media_package_id}`);
  console.log(`  editorial_package_id:    ${record.editorial_package_id}`);
  console.log(`  status:                  ${record.status}`);
  console.log(`  hook:                    ${record.hook}`);
  console.log(`  call_to_action:          ${record.call_to_action}`);
  console.log(`  tone:                    ${record.tone}`);
  console.log(`  audience:                ${record.audience}`);
  console.log(`  platforms:               ${JSON.stringify(record.platforms, null, 2)}`);
  console.log(`  carousel:                ${JSON.stringify(record.carousel, null, 2)}`);
  console.log(`  metadata:                ${JSON.stringify(record.metadata)}`);
  console.log(`  generated_at:            ${record.generated_at}`);
  console.log(`  llm_model:               ${record.llm_model}`);
  console.log(`  prompt_version:          ${record.prompt_version}`);
  console.log(`  schema_version:          ${record.schema_version}`);
  console.log(`  checksum:                ${record.checksum}`);
}

const args = process.argv.slice(2);
const isLive = args.includes("--live");
const liveMaxAttemptsArg = args.find((arg) => arg.startsWith("--live-max-attempts="));
const liveMaxAttemptsValue = liveMaxAttemptsArg ? liveMaxAttemptsArg.split("=")[1] : undefined;
const positional = args.filter((arg) => !arg.startsWith("--"));
const [subcommand, ...rest] = positional;

if (!subcommand) usageAndExit();

try {
  if (subcommand === "create") {
    const [editorialPackageId, editorialPackageStoreDirectory, socialMediaPackageStoreDirectory] = rest;
    if (!editorialPackageId || !editorialPackageStoreDirectory || !socialMediaPackageStoreDirectory) usageAndExit();

    const editorialPackageStore = buildEditorialPackageStore(editorialPackageStoreDirectory);
    const socialMediaPackageStore = buildSocialMediaPackageStore(socialMediaPackageStoreDirectory);

    const config = loadLlmProviderConfig();
    let provider;
    let maxAttempts;

    if (isLive) {
      if (!config.apiKey) {
        console.error("FAIL  --live requires LLM_API_KEY to be set in the environment");
        process.exit(1);
      }
      maxAttempts = resolveLiveMaxAttempts(liveMaxAttemptsValue); // throws RangeError on a bad override
      console.log(`Generating LIVE via Anthropic (${config.baseUrl}, model: ${config.model}) — this performs a real API call.`);
      console.log(
        `  maxAttempts: ${maxAttempts}${liveMaxAttemptsValue ? " (explicit --live-max-attempts override)" : " (safe default, independent of LLM_MAX_ATTEMPTS)"}`
      );
      const transport = createSocialMediaHttpTransport(config);
      provider = createAnthropicSocialMediaProvider({ transport, model: config.model, timeoutMs: config.requestTimeoutMs });
    } else {
      maxAttempts = config.maxAttempts;
      provider = createSocialMediaMockProvider();
    }

    const record = await generateSocialMediaPackage(editorialPackageId, { editorialPackageStore, socialMediaPackageStore, provider, maxAttempts });

    console.log("Social Media Package generated OK");
    printFullRecord(record);
  } else if (subcommand === "inspect") {
    const [socialMediaPackageId, storeDirectory] = rest;
    if (!socialMediaPackageId || !storeDirectory) usageAndExit();

    const store = buildSocialMediaPackageStore(storeDirectory);
    const record = store.get(socialMediaPackageId);

    console.log("Social Media Package found OK");
    console.log(JSON.stringify(record, null, 2));
  } else if (subcommand === "status") {
    const [storeDirectory] = rest;
    if (!storeDirectory) usageAndExit();

    const store = buildSocialMediaPackageStore(storeDirectory);
    const summaries = store.list();
    const latest = summaries.length > 0 ? summaries[summaries.length - 1] : null;

    console.log("Social Media Package status");
    console.log(`  total_social_media_packages: ${summaries.length}`);
    console.log(`  latest_package:               ${latest ? `[${latest.social_media_package_id}] "${latest.hook}"` : "(none)"}`);
    console.log(`  latest_status:                ${latest ? latest.status : "(none)"}`);
  } else if (subcommand === "list") {
    const [storeDirectory] = rest;
    if (!storeDirectory) usageAndExit();

    const store = buildSocialMediaPackageStore(storeDirectory);
    const summaries = store.list();

    console.log(`${summaries.length} social media package(s)`);
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

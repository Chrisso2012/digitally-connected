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
//   node tests/validation/social-media-package.mjs create <editorialPackageId> <editorialPackageStoreDirectory> <socialMediaPackageStoreDirectory> [--live] [--live-max-attempts=N] [--live-timeout-ms=N]
//   node tests/validation/social-media-package.mjs revise <editorialPackageId> <supersededSocialMediaPackageId> <editorialPackageStoreDirectory> <socialMediaPackageStoreDirectory> [--live] [--live-max-attempts=N] [--live-timeout-ms=N]
//   node tests/validation/social-media-package.mjs correct <socialMediaPackageId> <slideNumber> <field> <replacementText> <reason> <socialMediaPackageStoreDirectory>
//   node tests/validation/social-media-package.mjs inspect <socialMediaPackageId> <socialMediaPackageStoreDirectory>
//   node tests/validation/social-media-package.mjs status <socialMediaPackageStoreDirectory>
//   node tests/validation/social-media-package.mjs list <socialMediaPackageStoreDirectory>
//   node tests/validation/social-media-package.mjs lineage <editorialPackageId> <socialMediaPackageStoreDirectory>
//
//   or: npm run social-media-package -- <subcommand> ...
//
// DC-003-I032.8 — `revise` is the ONLY way to create a second (or later)
// Social Media Package for an Editorial Package that already has one;
// `create` continues to reject that outright (DuplicateSocialMediaPackageError),
// exactly as before. `revise` requires the exact existing Social Media
// Package being superseded and fails closed on every lineage safety rule
// (missing/cross-Editorial-Package/not-latest/malformed lineage) — there
// is no bypass flag. `lineage` is a read-only, zero-cost structural
// inspection of one Editorial Package's revision chain (V1..Vn, which one
// is_latest) — makes no provider/network call.
//
// DC-003-I032.9 — `correct` applies one explicit, human-directed,
// deterministic slide-field correction to an EXISTING Social Media
// Package, in place under the SAME identifier (never a new revision,
// never a new id). `<field>` is one of heading|body|imageGuidance.
// Never calls Anthropic or any AI provider. Checks `<replacementText>`
// against the Template Capacity Contract's own canonical limit for that
// slide's real role before applying — a violation is rejected outright,
// the limit is never modified, the text is never truncated. `<reason>`
// is a required, non-empty audit justification, recorded verbatim in the
// record's own append-only `corrections` log. No bypass flag exists.
//
// DC-003-I006/I019's own Live Verification Gate safety rule applies
// identically here: --live defaults to exactly one attempt, independent
// of LLM_MAX_ATTEMPTS, unless --live-max-attempts=N is explicitly given.
//
// DC-003-I032.2/I032.5 — the --live per-request timeout defaults to
// 120000ms via I032_DEFAULT_LIVE_TIMEOUT_MS below, passed as
// resolveLiveRequestTimeoutMs()'s own explicit `defaultMs` parameter
// (llm-provider-config.mjs) — scoped to this CLI only, deliberately NOT
// the shared DEFAULT_LIVE_REQUEST_TIMEOUT_MS=60000 constant I031's own
// editorial-package.mjs still uses unmodified. Independent of the shared
// loadLlmProviderConfig().requestTimeoutMs (still 15000ms — no other
// CLI's own default changed). I032.2 first raised this from 15000ms to
// 60000ms after a genuine live I032 attempt timed out; I032.5 raised it
// again to 120000ms after confirming (I032.4's own live attempt) that
// the 8192-token live response genuinely needs longer than 60000ms to
// arrive, not a shape/serialisation issue. Override with
// --live-timeout-ms=N for a one-off run.

import { createLocalJsonEditorialPackageStoreAdapter } from "../../src/local-json-editorial-package-store-adapter.mjs";
import { createEditorialPackageStore } from "../../src/editorial-package-store.mjs";
import { createLocalJsonSocialMediaPackageStoreAdapter } from "../../src/local-json-social-media-package-store-adapter.mjs";
import { createSocialMediaPackageStore } from "../../src/social-media-package-store.mjs";
import { generateSocialMediaPackage, reviseSocialMediaPackage } from "../../src/social-media-package-generator.mjs";
import { correctSocialMediaPackageSlideField } from "../../src/social-media-package-correction.mjs";
import { createSocialMediaMockProvider } from "../../src/social-media-mock-provider.mjs";
import { createAnthropicSocialMediaProvider } from "../../src/social-media-anthropic-provider.mjs";
import { createSocialMediaHttpTransport } from "../../src/social-media-transport-http.mjs";
import { loadLlmProviderConfig, resolveLiveMaxAttempts, resolveLiveRequestTimeoutMs } from "../../src/llm-provider-config.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";
import { DuplicateSocialMediaPackageError, SocialMediaPackageGenerationFailedError } from "../../src/social-media-package-errors.mjs";
import {
  InvalidSocialMediaPackageStoreAdapterError,
  InvalidSocialMediaPackageIdentifierError,
  SocialMediaPackageAlreadyExistsError,
  SocialMediaPackageNotFoundError,
  CorruptedSocialMediaPackageError,
  UnsupportedSchemaVersionError,
  SocialMediaPackagePersistenceError,
  InvalidSocialMediaPackageInputError,
  SocialMediaPackageValidationError,
  CrossEditorialPackageSupersessionError,
  NotLatestRevisionError,
  MalformedSocialMediaPackageLineageError,
  InvalidSocialMediaPackageCorrectionError,
  SocialMediaPackageCorrectionCapacityExceededError,
  SocialMediaPackageIdentifierMismatchError,
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

// DC-003-I032.5 — this CLI's own live timeout default, deliberately
// independent of llm-provider-config.mjs's shared DEFAULT_LIVE_REQUEST_TIMEOUT_MS
// (still 60000ms, still I031's own editorial-package.mjs default) — see
// this file's own header comment for the full history.
const I032_DEFAULT_LIVE_TIMEOUT_MS = 120000;

const KNOWN_ERRORS = [
  PipelineConfigurationError,
  DuplicateSocialMediaPackageError,
  SocialMediaPackageGenerationFailedError,
  InvalidSocialMediaPackageStoreAdapterError,
  InvalidSocialMediaPackageIdentifierError,
  SocialMediaPackageAlreadyExistsError,
  SocialMediaPackageNotFoundError,
  CorruptedSocialMediaPackageError,
  UnsupportedSchemaVersionError,
  SocialMediaPackagePersistenceError,
  InvalidSocialMediaPackageInputError,
  SocialMediaPackageValidationError,
  CrossEditorialPackageSupersessionError,
  NotLatestRevisionError,
  MalformedSocialMediaPackageLineageError,
  InvalidSocialMediaPackageCorrectionError,
  SocialMediaPackageCorrectionCapacityExceededError,
  SocialMediaPackageIdentifierMismatchError,
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
  console.error(
    "  node tests/validation/social-media-package.mjs revise <editorialPackageId> <supersededSocialMediaPackageId> <editorialPackageStoreDirectory> <socialMediaPackageStoreDirectory> [--live] [--live-max-attempts=N]"
  );
  console.error(
    "  node tests/validation/social-media-package.mjs correct <socialMediaPackageId> <slideNumber> <field:heading|body|imageGuidance> <replacementText> <reason> <socialMediaPackageStoreDirectory>"
  );
  console.error("  node tests/validation/social-media-package.mjs inspect <socialMediaPackageId> <socialMediaPackageStoreDirectory>");
  console.error("  node tests/validation/social-media-package.mjs status <socialMediaPackageStoreDirectory>");
  console.error("  node tests/validation/social-media-package.mjs list <socialMediaPackageStoreDirectory>");
  console.error("  node tests/validation/social-media-package.mjs lineage <editorialPackageId> <socialMediaPackageStoreDirectory>");
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
  console.log(`  industry_context:        ${record.industry_context}`);
  console.log(`  platforms:               ${JSON.stringify(record.platforms, null, 2)}`);
  console.log(`  carousel:                ${JSON.stringify(record.carousel, null, 2)}`);
  console.log(`  metadata:                ${JSON.stringify(record.metadata)}`);
  console.log(`  generated_at:            ${record.generated_at}`);
  console.log(`  llm_model:               ${record.llm_model}`);
  console.log(`  prompt_version:          ${record.prompt_version}`);
  console.log(`  schema_version:          ${record.schema_version}`);
  console.log(`  revision:                ${record.revision}`);
  console.log(`  supersedes:              ${record.supersedes}`);
  console.log(`  corrections:             ${JSON.stringify(record.corrections)}`);
  console.log(`  checksum:                ${record.checksum}`);
}

// DC-003-I032.8 — shared by both `create` and `revise`: resolves the
// provider + maxAttempts from the CLI's --live/--live-max-attempts/
// --live-timeout-ms flags exactly once, so the two subcommands can never
// silently drift in how they interpret the same flags.
function buildProviderFromCliFlags(config, stopReasons) {
  if (isLive) {
    if (!config.apiKey) {
      console.error("FAIL  --live requires LLM_API_KEY to be set in the environment");
      process.exit(1);
    }
    const maxAttempts = resolveLiveMaxAttempts(liveMaxAttemptsValue); // throws RangeError on a bad override
    const liveTimeoutMs = resolveLiveRequestTimeoutMs(liveTimeoutMsValue, I032_DEFAULT_LIVE_TIMEOUT_MS); // throws RangeError on a bad override
    console.log(`Generating LIVE via Anthropic (${config.baseUrl}, model: ${config.model}) — this performs a real API call.`);
    console.log(
      `  maxAttempts: ${maxAttempts}${liveMaxAttemptsValue ? " (explicit --live-max-attempts override)" : " (safe default, independent of LLM_MAX_ATTEMPTS)"}`
    );
    console.log(
      `  timeoutMs:   ${liveTimeoutMs}${liveTimeoutMsValue ? " (explicit --live-timeout-ms override)" : " (I032.5 live default, independent of LLM_REQUEST_TIMEOUT_MS and I031's own 60000ms default)"}`
    );
    const transport = createSocialMediaHttpTransport(config);
    const provider = createAnthropicSocialMediaProvider({
      transport,
      model: config.model,
      timeoutMs: liveTimeoutMs,
      onStopReason: (stopReason) => stopReasons.push(stopReason),
    });
    return { provider, maxAttempts };
  }
  return { provider: createSocialMediaMockProvider(), maxAttempts: config.maxAttempts };
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

// DC-003-I032.3 — every stop_reason Anthropic returned this run, in call
// order (one entry per provider call that got a response at all — a
// network/timeout failure never reaches this callback). Declared outside
// the try block so the catch block below can still read it. Not paired
// 1:1 with error.attempts (an attempt can fail before ever calling the
// provider), but a bare list is enough to answer the one diagnostic
// question this exists for: did any attempt this run get cut off by
// max_tokens?
const stopReasons = [];

try {
  if (subcommand === "create") {
    const [editorialPackageId, editorialPackageStoreDirectory, socialMediaPackageStoreDirectory] = rest;
    if (!editorialPackageId || !editorialPackageStoreDirectory || !socialMediaPackageStoreDirectory) usageAndExit();

    const editorialPackageStore = buildEditorialPackageStore(editorialPackageStoreDirectory);
    const socialMediaPackageStore = buildSocialMediaPackageStore(socialMediaPackageStoreDirectory);

    const config = loadLlmProviderConfig();
    const { provider, maxAttempts } = buildProviderFromCliFlags(config, stopReasons);

    const record = await generateSocialMediaPackage(editorialPackageId, { editorialPackageStore, socialMediaPackageStore, provider, maxAttempts });

    console.log("Social Media Package generated OK");
    printFullRecord(record);
  } else if (subcommand === "revise") {
    const [editorialPackageId, supersededSocialMediaPackageId, editorialPackageStoreDirectory, socialMediaPackageStoreDirectory] = rest;
    if (!editorialPackageId || !supersededSocialMediaPackageId || !editorialPackageStoreDirectory || !socialMediaPackageStoreDirectory) usageAndExit();

    const editorialPackageStore = buildEditorialPackageStore(editorialPackageStoreDirectory);
    const socialMediaPackageStore = buildSocialMediaPackageStore(socialMediaPackageStoreDirectory);

    const config = loadLlmProviderConfig();
    const { provider, maxAttempts } = buildProviderFromCliFlags(config, stopReasons);

    const record = await reviseSocialMediaPackage(editorialPackageId, supersededSocialMediaPackageId, {
      editorialPackageStore,
      socialMediaPackageStore,
      provider,
      maxAttempts,
    });

    console.log(`Social Media Package revised OK — new revision ${record.revision}, supersedes ${record.supersedes}`);
    printFullRecord(record);
  } else if (subcommand === "correct") {
    const [socialMediaPackageId, slideNumberArg, field, replacementText, reason, storeDirectory] = rest;
    if (!socialMediaPackageId || !slideNumberArg || !field || !replacementText || !reason || !storeDirectory) usageAndExit();

    const store = buildSocialMediaPackageStore(storeDirectory);
    const existing = store.get(socialMediaPackageId);

    const corrected = correctSocialMediaPackageSlideField({
      socialMediaPackage: existing,
      slideNumber: Number(slideNumberArg),
      field,
      replacementText,
      reason,
    });

    const record = store.replace({ identifier: socialMediaPackageId, socialMediaPackage: corrected });

    console.log(`Social Media Package corrected OK — slide ${slideNumberArg} (${field})`);
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
  } else if (subcommand === "lineage") {
    // DC-003-I032.8 — read-only, zero-cost structural inspection: makes
    // no provider/network call of any kind. Reconstructs and validates
    // the revision chain for one Editorial Package via the store's own
    // getLineage() (social-media-package-lineage.mjs), never guessing.
    const [editorialPackageId, storeDirectory] = rest;
    if (!editorialPackageId || !storeDirectory) usageAndExit();

    const store = buildSocialMediaPackageStore(storeDirectory);
    const { chain, latest } = store.getLineage(editorialPackageId);

    console.log(`Social Media Package lineage for ${editorialPackageId}`);
    console.log(`  revisions: ${chain.length}`);
    if (chain.length === 0) {
      console.log("  (no Social Media Package exists yet for this Editorial Package — ordinary `create` would succeed)");
    } else {
      for (const record of chain) {
        console.log(
          `  V${record.revision}  [${record.social_media_package_id}]  supersedes=${record.supersedes}  is_latest=${record.is_latest}  "${record.hook}"`
        );
      }
      console.log(`  latest: [${latest.social_media_package_id}] (revision ${latest.revision})`);
      console.log(`  ordinary create for this Editorial Package would now fail (DuplicateSocialMediaPackageError)`);
      console.log(`  \`revise ${editorialPackageId} ${latest.social_media_package_id} ...\` would succeed`);
    }
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (KNOWN_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
    // DC-003-I032.3 — safe, content-free structural diagnostics only for
    // the --live path (see describeResultFieldShape()'s own header
    // comment): shape/type/length/key-name facts about whichever field
    // actually failed, plus every stop_reason Anthropic returned this
    // run — never the actual generated strings. Mirrors
    // tests/validation/editorial-package.mjs's own I031.3 precedent.
    if (isLive && error instanceof SocialMediaPackageGenerationFailedError) {
      for (const attempt of error.attempts ?? []) {
        if (attempt.fieldDiagnostics) {
          console.error(`  field diagnostics: ${JSON.stringify(attempt.fieldDiagnostics)}`);
        }
      }
      if (stopReasons.length > 0) {
        console.error(`  stop reasons (call order): ${JSON.stringify(stopReasons)}`);
      }
    }
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

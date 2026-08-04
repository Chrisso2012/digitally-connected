// DC-003-I022 — CLI for the Production Asset Publisher Service: uploads an
// already-completed I021 export package to Google Drive. Mock by default
// (no network, no credentials needed) — pass --live to publish for real.
//
// Usage:
//   node tests/validation/publish-production-assets.mjs <assetPackagePath> [--live] [--replace] [--live-max-attempts=N]
//   or: npm run publish:assets -- <assetPackagePath> [--live] [--replace]
//
// I022 does not generate assets and does not call I021 — assetPackagePath
// must already exist (the output of a prior `npm run export:assets` run).
//
// --live requires GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET,
// GOOGLE_DRIVE_REFRESH_TOKEN, and GOOGLE_DRIVE_ROOT_FOLDER_ID to be set in
// the environment — checked before any request is made. --live always
// resolves to exactly 1 attempt per file upload, via the SAME
// resolveLiveMaxAttempts() safety primitive DC-003-I006/I019/I021
// already established for their own --live CLIs — completely independent
// of GOOGLE_DRIVE_MAX_ATTEMPTS. Raising it requires an explicit
// --live-max-attempts=N flag on that specific invocation.
//
// --replace: if the destination Drive folder already contains files with
// matching names, update them in place instead of failing with
// DuplicatePackageError (see production-asset-publisher-adapter.mjs's own
// header comment). Off by default, per Strategy Office's own
// recommendation ("fail by default unless --replace is supplied").
//
// No live Google Drive upload has been authorized as of this milestone's
// delivery — see README "Google Drive Publisher — Live Verification
// Gate" for the exact procedure once approved.

import { createMockPublisherAdapter } from "../../src/production-asset-publisher-mock-adapter.mjs";
import { createGoogleDrivePublisherAdapter } from "../../src/google-drive-publisher-adapter.mjs";
import { loadGoogleDrivePublisherConfig, resolveLiveMaxAttempts } from "../../src/google-drive-publisher-config.mjs";
import { executeProductionAssetPublish } from "../../src/production-asset-publisher-service.mjs";
import {
  InvalidPublisherAdapterError,
  InvalidAssetPackageError,
  PublisherConfigurationError,
  PublisherAuthenticationError,
  PublisherTransportError,
  PublisherTimeoutError,
  PublisherClientError,
  PublisherRateLimitError,
  DuplicatePackageError,
  PublisherUploadError,
} from "../../src/production-asset-publisher-errors.mjs";

const rawArgs = process.argv.slice(2);
const isLive = rawArgs.includes("--live");
const replace = rawArgs.includes("--replace");
const liveMaxAttemptsArg = rawArgs.find((arg) => arg.startsWith("--live-max-attempts="));
const liveMaxAttemptsValue = liveMaxAttemptsArg ? liveMaxAttemptsArg.split("=")[1] : undefined;
const [assetPackagePath] = rawArgs.filter((arg) => !arg.startsWith("--"));

function usageAndExit() {
  console.error("Usage: node tests/validation/publish-production-assets.mjs <assetPackagePath> [--live] [--replace] [--live-max-attempts=N]");
  console.error("Example (mock, safe anytime): node tests/validation/publish-production-assets.mjs /exports/car_9c026a104e3745c3");
  console.error("Example (LIVE):                node tests/validation/publish-production-assets.mjs /exports/car_9c026a104e3745c3 --live");
  process.exit(1);
}

if (!assetPackagePath) usageAndExit();

try {
  let adapter;
  let maxAttempts;

  if (isLive) {
    const config = loadGoogleDrivePublisherConfig();

    const missing = [];
    if (!config.clientId) missing.push("GOOGLE_DRIVE_CLIENT_ID");
    if (!config.clientSecret) missing.push("GOOGLE_DRIVE_CLIENT_SECRET");
    if (!config.refreshToken) missing.push("GOOGLE_DRIVE_REFRESH_TOKEN");
    if (!config.rootFolderId) missing.push("GOOGLE_DRIVE_ROOT_FOLDER_ID");
    if (missing.length > 0) {
      console.error(`FAIL  --live requires ${missing.join(", ")} to be set in the environment`);
      process.exit(1);
    }

    maxAttempts = resolveLiveMaxAttempts(liveMaxAttemptsValue);
    console.log(`Publishing LIVE to Google Drive (${config.apiBaseUrl}) — this performs real API calls.`);
    console.log(
      `  maxAttempts: ${maxAttempts}${liveMaxAttemptsValue ? " (explicit --live-max-attempts override)" : " (safe default, independent of GOOGLE_DRIVE_MAX_ATTEMPTS)"}`
    );
    console.log(`  replace: ${replace}`);

    adapter = createGoogleDrivePublisherAdapter(config);
  } else {
    adapter = createMockPublisherAdapter();
  }

  const result = await executeProductionAssetPublish(assetPackagePath, { adapter, replace, maxAttempts });

  console.log("Publish complete");
  console.log(`  status:          ${result.status}`);
  console.log(`  publisher:       ${result.publisher}`);
  console.log(`  package ID:      ${result.packageId}`);
  console.log(`  folder ID:       ${result.folderId}`);
  console.log(`  folder URL:      ${result.folderUrl}`);
  console.log(`  files uploaded:  ${result.filesUploaded}`);

  process.exit(0);
} catch (error) {
  if (
    error instanceof InvalidPublisherAdapterError ||
    error instanceof InvalidAssetPackageError ||
    error instanceof PublisherConfigurationError ||
    error instanceof PublisherAuthenticationError ||
    error instanceof PublisherTransportError ||
    error instanceof PublisherTimeoutError ||
    error instanceof PublisherRateLimitError ||
    error instanceof DuplicatePackageError ||
    error instanceof PublisherUploadError
  ) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else if (error instanceof PublisherClientError) {
    // Safe diagnostic only — status/reason/sanitised message, mirroring
    // DC-003-I019.1's own LlmClientError.diagnostic surfacing — never the
    // raw response body, headers, or access token.
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
    const diagnostic = error.diagnostic ?? {};
    console.error(`  status:  ${diagnostic.status ?? "unknown"}`);
    console.error(`  reason:  ${diagnostic.reason ?? "(none reported)"}`);
    console.error(`  message: ${diagnostic.message ?? "(none reported)"}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

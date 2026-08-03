// DC-003-I018 — CLI for the Content Asset Repository: get, list, and
// validate repository-owned Content Assets. No network, no ledger
// writes, no production workflow involvement — this CLI only ever reads.
//
// Usage:
//   node tests/validation/content-asset.mjs get <assetId> [assetsDir]
//   node tests/validation/content-asset.mjs list [assetsDir]
//   node tests/validation/content-asset.mjs validate <assetId> [assetsDir]
//
//   or: npm run content-asset -- <subcommand> ...
//
// assetsDir defaults to the repository's own content-assets/ directory
// — the canonical, version-controlled production source (see README
// "Content Asset Repository"). Pass an explicit trailing argument to
// point at a different directory (used by this CLI's own tests).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContentAssetRepository } from "../../src/content-asset-repository.mjs";
import {
  UnknownContentAssetError,
  DuplicateContentAssetIdError,
  ContentAssetSchemaError,
  ContentAssetReadFailureError,
  InvalidContentAssetError,
} from "../../src/content-asset-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ASSETS_DIR = path.join(__dirname, "..", "..", "content-assets");

const [subcommand, ...rest] = process.argv.slice(2);

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/content-asset.mjs get <assetId> [assetsDir]");
  console.error("  node tests/validation/content-asset.mjs list [assetsDir]");
  console.error("  node tests/validation/content-asset.mjs validate <assetId> [assetsDir]");
  process.exit(1);
}

function printSummaryLine(asset) {
  console.log(`  [${asset.asset_id}] "${asset.title}" status=${asset.status} topic=${asset.topic_package.topic_id} created_at=${asset.created_at}`);
}

if (!subcommand) usageAndExit();

try {
  if (subcommand === "get" || subcommand === "validate") {
    const [assetId, assetsDirArg] = rest;
    if (!assetId) usageAndExit();
    const assetsDir = assetsDirArg ?? DEFAULT_ASSETS_DIR;

    const repository = createContentAssetRepository({ assetsDir });
    const asset = repository.get(assetId);

    if (subcommand === "validate") {
      console.log(`Content asset "${assetId}" is valid OK`);
      printSummaryLine(asset);
    } else {
      console.log("Content asset found OK");
      console.log(JSON.stringify(asset, null, 2));
    }
  } else if (subcommand === "list") {
    const [assetsDirArg] = rest;
    const assetsDir = assetsDirArg ?? DEFAULT_ASSETS_DIR;

    const repository = createContentAssetRepository({ assetsDir });
    const assets = repository.list();

    console.log(`${assets.length} content asset(s)`);
    for (const asset of assets) printSummaryLine(asset);
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (
    error instanceof UnknownContentAssetError ||
    error instanceof DuplicateContentAssetIdError ||
    error instanceof ContentAssetSchemaError ||
    error instanceof ContentAssetReadFailureError ||
    error instanceof InvalidContentAssetError
  ) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

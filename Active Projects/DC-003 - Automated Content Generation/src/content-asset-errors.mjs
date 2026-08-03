// DC-003-I018 — structured errors for the Content Asset Repository and
// its resolver bridge. Every message here assumes it may reach an
// external caller (a CLI user, an n8n workflow output) — none of them
// ever interpolate a raw filesystem path or a raw Node error message
// (which can itself contain a path). Only the asset_id (already public,
// already part of the asset's own identity) is ever named.

/**
 * get() was called for an asset_id with no corresponding
 * `<asset_id>.json` file in the repository.
 */
export class UnknownContentAssetError extends Error {
  constructor(assetId) {
    super(`No content asset found for asset_id "${assetId}"`);
    this.name = "UnknownContentAssetError";
    this.assetId = assetId;
  }
}

/**
 * list() found two or more stored assets whose own `asset_id` field is
 * the same value — a repository integrity problem, never silently
 * resolved by picking one.
 */
export class DuplicateContentAssetIdError extends Error {
  constructor(assetId) {
    super(`More than one content asset in the repository declares asset_id "${assetId}"`);
    this.name = "DuplicateContentAssetIdError";
    this.assetId = assetId;
  }
}

/**
 * A stored asset's JSON failed validation against
 * content-asset.schema.json. `errors` is the same { path, keyword,
 * message, params }[] shape createValidator().validate() returns.
 */
export class ContentAssetSchemaError extends Error {
  constructor(assetId, errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Content asset "${assetId}" failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "ContentAssetSchemaError";
    this.assetId = assetId;
    this.errors = errors;
  }
}

/**
 * The repository failed to read or parse a stored asset file — a genuine
 * I/O failure (permissions, disk issue) or malformed JSON, not a schema
 * problem. The underlying cause (which may contain a raw host path) is
 * attached as `.cause` for local debugging only, never included in
 * `.message`.
 */
export class ContentAssetReadFailureError extends Error {
  constructor(assetId, operation, cause) {
    super(`Content asset repository ${operation} failed for "${assetId}"`, { cause });
    this.name = "ContentAssetReadFailureError";
    this.assetId = assetId;
    this.operation = operation;
  }
}

/**
 * The asset's outer envelope is schema-valid JSON, but is semantically
 * inconsistent — its own asset_id doesn't match its filename, its
 * embedded topic_package fails topic-package.schema.json validation, or
 * the requested identifier isn't shaped like a valid asset_id
 * (`^[A-Za-z0-9_-]+$` — the one check standing between a caller-supplied
 * string and a real filesystem path, blocking path traversal).
 */
export class InvalidContentAssetError extends Error {
  constructor(assetId, reason) {
    super(`Content asset "${assetId}" is invalid — ${reason}`);
    this.name = "InvalidContentAssetError";
    this.assetId = assetId;
  }
}

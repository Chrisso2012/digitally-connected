// DC-003-I030 — Content Source Adapter: the provider-neutral contract
// every source integration (the mock in content-source-mock-adapter.mjs,
// the live Google Docs one in google-docs-source-adapter.mjs, and any
// future markdown/git/wordpress/notion adapter) must satisfy. Mirrors
// delivery-office-runner-adapter.mjs's own pattern exactly — a shape
// check, not a base class, plus a result-shape assertion so
// content-ingestion-service.mjs never has to trust an adapter blindly.
//
//   { name: string,
//     fetch({ sourceReference }): Promise<{
//       title: string,
//       body: string,
//       metadata: object | null,
//       sourceIdentifier: string,
//     }> }
//
// content-ingestion-service.mjs depends on ONLY this shape — it never
// imports a specific adapter, and adding a new source type never requires
// changing the service. `sourceIdentifier` is the adapter's own
// normalised, stable form of whatever sourceReference the caller supplied
// (e.g. a bare Google Doc ID extracted from a full share URL) — see
// README "Investigation — stable document identifier".

import { InvalidContentSourceAdapterError, MalformedContentSourceResultError } from "./content-source-errors.mjs";

export function assertValidContentSourceAdapter(adapter) {
  if (!adapter || typeof adapter.name !== "string" || typeof adapter.fetch !== "function") {
    throw new InvalidContentSourceAdapterError();
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Validates that an adapter's fetch() result matches the Content Source
 * Fetch Result contract — called by content-ingestion-service.mjs
 * immediately after every adapter invocation, real or mock, before any of
 * it is trusted.
 */
export function assertValidContentSourceFetchResult(result, sourceReference) {
  if (!result || typeof result !== "object") {
    throw new MalformedContentSourceResultError(sourceReference, "result is not an object");
  }
  if (!isNonEmptyString(result.title)) {
    throw new MalformedContentSourceResultError(sourceReference, "title is required and must be a non-empty string");
  }
  if (!isNonEmptyString(result.body)) {
    throw new MalformedContentSourceResultError(sourceReference, "body is required and must be a non-empty string");
  }
  if (result.metadata !== null && typeof result.metadata !== "object") {
    throw new MalformedContentSourceResultError(sourceReference, "metadata must be an object or null");
  }
  if (!isNonEmptyString(result.sourceIdentifier)) {
    throw new MalformedContentSourceResultError(sourceReference, "sourceIdentifier is required and must be a non-empty string");
  }
  return result;
}

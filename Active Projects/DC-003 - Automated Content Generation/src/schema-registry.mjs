// DC-003 — schema registry.
//
// Loads the eight approved JSON Schemas (five from DC-003-T002, plus
// DC-003-I008's execution-record.schema.json and DC-003-I010's
// invocation-request.schema.json / invocation-response.schema.json — none
// part of the original T002 five) and exposes them behind stable,
// camelCase identifiers (matching the JS-side naming convention documented
// in DC-003-T002 §8) so later modules never need to know a schema's
// filesystem path — only its identifier.

import { readJsonFileSync } from "./read-json-file.mjs";
import { resolveFromRoot } from "./paths.mjs";

const SCHEMA_FILES = {
  topicPackage: "topic-package.schema.json",
  carouselContent: "carousel-content.schema.json",
  templatedPayload: "templated-payload.schema.json",
  finishedCarousel: "finished-carousel.schema.json",
  // DEPRECATED (DC-003-I008.1) — not part of the active architecture, no
  // production consumer. Retained (not removed) for the schema's own
  // fixture/validation coverage and a possible future rolled-up-summary
  // role; see README "execution-log.schema.json — deprecated".
  executionLog: "execution-log.schema.json",
  // The active operational record model — see README "Operational layer".
  executionRecord: "execution-record.schema.json",
  // The platform's first external boundary — see README "External
  // Invocation Adapter".
  invocationRequest: "invocation-request.schema.json",
  invocationResponse: "invocation-response.schema.json",
};

export const SCHEMA_IDS = Object.keys(SCHEMA_FILES);

/**
 * Loads all eight schemas and returns them keyed by identifier, e.g.
 * `registry.topicPackage`. Fails fast on the first missing or malformed
 * schema file.
 */
export function loadSchemaRegistry(options = {}) {
  const registry = {};
  for (const [id, filename] of Object.entries(SCHEMA_FILES)) {
    registry[id] = readJsonFileSync(resolveFromRoot(options.rootDir, "schemas", filename));
  }
  return registry;
}

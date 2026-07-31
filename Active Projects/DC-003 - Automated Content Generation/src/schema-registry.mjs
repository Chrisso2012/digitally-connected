// DC-003 — schema registry.
//
// Loads the five approved JSON Schemas and exposes them behind stable,
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
  executionLog: "execution-log.schema.json",
};

export const SCHEMA_IDS = Object.keys(SCHEMA_FILES);

/**
 * Loads all five schemas and returns them keyed by identifier, e.g.
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

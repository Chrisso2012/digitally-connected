// DC-003 — validation runtime.
//
// The single source of truth for validating any object against any of the
// five registered schemas. Built on Ajv (2020-12 dialect) + ajv-formats —
// see README "Dependencies" for why these two were chosen.
//
// Unknown schema identifiers are a caller bug, not a data problem, so
// `validate()` throws UnknownSchemaError for those rather than returning a
// { valid: false } result. Actual data validation failures always return a
// structured result — never a bare "validation failed".

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadSchemaRegistry } from "./schema-registry.mjs";
import { UnknownSchemaError } from "./errors.mjs";

function formatAjvError(error) {
  const path = error.instancePath === "" ? "(root)" : error.instancePath;
  return {
    path,
    keyword: error.keyword,
    message: `${path} ${error.message}`.trim(),
    params: error.params,
  };
}

/**
 * Creates a validator bound to the five registered schemas.
 *
 * options.schemaRegistry — inject a pre-loaded registry (used by tests with
 *   a temporary schema directory) instead of loading the real project schemas.
 * options.rootDir — passed through to loadSchemaRegistry when no registry
 *   is injected.
 */
export function createValidator(options = {}) {
  const registry = options.schemaRegistry ?? loadSchemaRegistry(options);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const compiled = {};
  for (const [id, schema] of Object.entries(registry)) {
    compiled[id] = ajv.compile(schema);
  }
  const knownIds = Object.keys(compiled);

  /**
   * Validate `data` against the schema registered under `schemaId`.
   * Returns { valid: true, errors: [] } or { valid: false, errors: [...] },
   * where each error has { path, keyword, message, params }.
   * Throws UnknownSchemaError if schemaId isn't registered.
   */
  function validate(schemaId, data) {
    const validateFn = compiled[schemaId];
    if (!validateFn) {
      throw new UnknownSchemaError(schemaId, knownIds);
    }
    const valid = validateFn(data);
    if (valid) {
      return { valid: true, errors: [] };
    }
    return { valid: false, errors: (validateFn.errors ?? []).map(formatAjvError) };
  }

  return { validate, schemaIds: knownIds };
}

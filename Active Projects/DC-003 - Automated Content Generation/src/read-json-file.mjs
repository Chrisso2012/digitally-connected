// DC-003 — single shared "read and parse one JSON file, fail clearly" helper.
// Used by both the config loader and the schema registry so there is one
// place that defines what "missing" and "malformed" mean.

import { existsSync, readFileSync } from "node:fs";
import { ConfigFileNotFoundError, ConfigParseError } from "./errors.mjs";

export function readJsonFileSync(filePath) {
  if (!existsSync(filePath)) {
    throw new ConfigFileNotFoundError(filePath);
  }
  const raw = readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new ConfigParseError(filePath, cause);
  }
}

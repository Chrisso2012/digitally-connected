// DC-003-I025 — Local JSON Storage Adapter for Publisher Results: one
// file per record, at `<storageDir>/<publisher_result_id>.json`.
// Deliberately a byte-for-byte mirror of
// local-json-production-metrics-store-adapter.mjs (I023) — same
// atomic-write strategy (temp file in the same directory,
// read-back-verify, then rename), same "storageDir is always an explicit
// constructor argument, never a built-in default or env var" rule.

import { writeFileSync, readFileSync, readdirSync, existsSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const EXTENSION = ".json";

/**
 * Builds a Storage Adapter backed by one JSON file per publisher result
 * under `storageDir`.
 *
 * write(identifier, content) — atomically writes `content` (an
 *   already-serialized JSON string) to `<storageDir>/<identifier>.json`,
 *   creating `storageDir` if it doesn't exist yet.
 * read(identifier) — returns the raw file content as a string. Throws
 *   Node's own ENOENT error if the file doesn't exist.
 * list() — returns every stored identifier (filenames with `.json`
 *   stripped), in no particular order. Returns [] if `storageDir` doesn't
 *   exist yet (an empty store, not an error).
 * exists(identifier) — true if `<storageDir>/<identifier>.json` exists.
 */
export function createLocalJsonPublisherResultStoreAdapter({ storageDir }) {
  function finalPath(identifier) {
    return path.join(storageDir, `${identifier}${EXTENSION}`);
  }

  return {
    name: "local-json-publisher-result-store",

    write(identifier, content) {
      mkdirSync(storageDir, { recursive: true });
      const target = finalPath(identifier);
      const tempPath = path.join(storageDir, `.${identifier}.tmp-${randomUUID()}${EXTENSION}`);

      writeFileSync(tempPath, content, "utf-8");

      const writtenBack = readFileSync(tempPath, "utf-8");
      if (writtenBack !== content) {
        unlinkSync(tempPath);
        throw new Error("atomic write verification failed — temp file content did not match what was written");
      }

      renameSync(tempPath, target);
    },

    read(identifier) {
      return readFileSync(finalPath(identifier), "utf-8");
    },

    list() {
      if (!existsSync(storageDir)) {
        return [];
      }
      return readdirSync(storageDir)
        .filter((name) => name.endsWith(EXTENSION) && !name.startsWith("."))
        .map((name) => name.slice(0, -EXTENSION.length));
    },

    exists(identifier) {
      return existsSync(finalPath(identifier));
    },
  };
}

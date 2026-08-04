// DC-003-I023 — Local JSON Storage Adapter for Production Metrics: one
// file per record, at `<storageDir>/<metrics_id>.json`. Deliberately a
// byte-for-byte mirror of local-json-carousel-store-adapter.mjs (I015) —
// same atomic-write strategy (temp file in the same directory,
// read-back-verify, then rename), same "storageDir is always an explicit
// constructor argument, never a built-in default or env var" rule — this
// is a genuinely separate adapter for a genuinely separate store, not a
// modification of I015's own file.
//
// Atomicity: write() writes to a temporary file in the same directory,
// reads it back to verify the write round-tripped intact, then renames it
// into its final location. A same-directory rename is atomic on both
// POSIX filesystems and Windows NTFS — the final file either doesn't
// exist yet, or exists complete; there is no window where a reader can
// observe a partially-written file at the real path. A failed
// verification removes the temp file and never touches the real path, so
// a partial write can never replace a previously valid stored record.

import { writeFileSync, readFileSync, readdirSync, existsSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const EXTENSION = ".json";

/**
 * Builds a Storage Adapter backed by one JSON file per metrics record
 * under `storageDir`.
 *
 * write(identifier, content) — atomically writes `content` (an
 *   already-serialized JSON string) to `<storageDir>/<identifier>.json`,
 *   creating `storageDir` if it doesn't exist yet. Overwrites whatever was
 *   there before — the domain layer, not this adapter, decides whether an
 *   overwrite is ever allowed (it isn't — see production-metrics-store.mjs's
 *   own save(), which never calls write() for an identifier that already
 *   exists()).
 * read(identifier) — returns the raw file content as a string. Throws
 *   Node's own ENOENT error if the file doesn't exist — the domain layer
 *   is expected to call exists() first.
 * list() — returns every stored identifier (filenames with `.json`
 *   stripped), in no particular order. Returns [] if `storageDir` doesn't
 *   exist yet (an empty store, not an error).
 * exists(identifier) — true if `<storageDir>/<identifier>.json` exists.
 */
export function createLocalJsonProductionMetricsStoreAdapter({ storageDir }) {
  function finalPath(identifier) {
    return path.join(storageDir, `${identifier}${EXTENSION}`);
  }

  return {
    name: "local-json-production-metrics-store",

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

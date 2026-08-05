// DC-003-I028 — Local JSON Storage Adapter for Social Analytics Snapshots:
// one file per record, at `<storageDir>/<analytics_snapshot_id>.json`.
// Byte-for-byte mirror of local-json-production-metrics-store-adapter.mjs
// (I023) / local-json-publisher-result-store-adapter.mjs (I025) — same
// atomic-write strategy (temp file in the same directory,
// read-back-verify, then rename), same "storageDir is always an explicit
// constructor argument, never a built-in default or env var" rule. Never
// committed to Git — a real store directory only ever exists on disk/in a
// Docker volume, matching every other local store in this codebase.

import { writeFileSync, readFileSync, readdirSync, existsSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const EXTENSION = ".json";

/**
 * Builds a Storage Adapter backed by one JSON file per snapshot under
 * `storageDir`.
 *
 * write(identifier, content) — atomically writes `content` to
 *   `<storageDir>/<identifier>.json`, creating `storageDir` if needed.
 * read(identifier) — returns the raw file content as a string.
 * list() — returns every stored identifier, in no particular order.
 *   Returns [] if `storageDir` doesn't exist yet (an empty store).
 * exists(identifier) — true if the file exists.
 */
export function createLocalJsonSocialAnalyticsStoreAdapter({ storageDir }) {
  function finalPath(identifier) {
    return path.join(storageDir, `${identifier}${EXTENSION}`);
  }

  return {
    name: "local-json-social-analytics-store",

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

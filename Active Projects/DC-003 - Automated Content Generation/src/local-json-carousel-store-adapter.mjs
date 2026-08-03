// DC-003-I015 — Local JSON Storage Adapter: the one Finished Carousel
// Storage Adapter this milestone ships (see
// finished-carousel-store-adapter.mjs for the abstraction every adapter
// must satisfy). One file per carousel, at
// `<storageDir>/<carousel_id>.json` — human-readable, diffable, and
// trivial to migrate off later (SQLite/Postgres/cloud storage) without
// touching finished-carousel-store.mjs, which never imports node:fs
// directly.
//
// `storageDir` is always an explicit constructor argument — this module
// has no built-in default and never reads an environment variable for it.
// Per the I015 brief: "The exact location should originate from
// configuration or an explicit CLI argument — not a hardcoded
// machine-specific path."
//
// Atomicity: write() writes to a temporary file in the same directory,
// reads it back to verify the write round-tripped intact, then renames it
// into its final location. A same-directory rename is atomic on both
// POSIX filesystems and Windows NTFS — the final file either doesn't
// exist yet, or exists complete; there is no window where a reader can
// observe a partially-written file at the real path. A failed
// verification removes the temp file and never touches the real path, so
// a partial write can never replace a previously valid stored carousel.

import { writeFileSync, readFileSync, readdirSync, existsSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const EXTENSION = ".json";

/**
 * Builds a Storage Adapter backed by one JSON file per carousel under
 * `storageDir`.
 *
 * write(identifier, content) — atomically writes `content` (an
 *   already-serialized JSON string) to `<storageDir>/<identifier>.json`,
 *   creating `storageDir` if it doesn't exist yet. Overwrites whatever was
 *   there before — the domain layer, not this adapter, is responsible for
 *   deciding whether an overwrite is allowed (save() vs replace()).
 * read(identifier) — returns the raw file content as a string. Throws
 *   Node's own ENOENT error if the file doesn't exist — the domain layer
 *   is expected to call exists() first and never rely on this adapter's
 *   own error shape.
 * list() — returns every stored identifier (filenames with `.json`
 *   stripped), in no particular order — the domain layer is responsible
 *   for any ordering guarantee. Returns [] if `storageDir` doesn't exist
 *   yet (an empty store, not an error), matching
 *   jsonl-ledger-store.mjs's readAll() convention.
 * exists(identifier) — true if `<storageDir>/<identifier>.json` exists.
 */
export function createLocalJsonCarouselStoreAdapter({ storageDir }) {
  function finalPath(identifier) {
    return path.join(storageDir, `${identifier}${EXTENSION}`);
  }

  return {
    name: "local-json-carousel-store",

    write(identifier, content) {
      mkdirSync(storageDir, { recursive: true });
      const target = finalPath(identifier);
      const tempPath = path.join(storageDir, `.${identifier}.tmp-${randomUUID()}${EXTENSION}`);

      writeFileSync(tempPath, content, "utf-8");

      // Validate the completed write before it ever becomes visible at
      // the real path — catches a truncated or corrupted write, not just
      // a crash mid-write.
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

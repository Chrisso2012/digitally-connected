// DC-003-I008 — JSONL Ledger Store: the one Ledger Store implementation
// this milestone ships (see execution-ledger-store.mjs for the abstraction
// every implementation must satisfy). One ExecutionRecord per line, each a
// complete JSON object — appendable, human-readable, diffable, and trivial
// to migrate off later (SQLite/Postgres/an event store) without touching
// execution-ledger.mjs, which never imports node:fs directly.

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { MalformedLedgerLineError } from "./execution-ledger-errors.mjs";

/**
 * Builds a Ledger Store backed by one JSON Lines file at `filePath`.
 *
 * append(record) — appends one line (JSON.stringify(record) + "\n") to the
 *   file, creating it if it doesn't exist yet (node:fs's default
 *   appendFileSync behavior — no separate "create" step is required for
 *   the store itself to function; the CLI's `init` subcommand exists only
 *   for an operator to explicitly stake out an empty ledger file up front).
 * readAll() — returns [] if the file doesn't exist yet (an empty ledger,
 *   not an error); otherwise parses every non-blank line and returns the
 *   plain objects in file order. Throws MalformedLedgerLineError, naming
 *   the file and 1-based line number, for any line that isn't valid JSON —
 *   never a raw JSON.parse SyntaxError, and never the line's own content
 *   (which could itself be a leak from a truncated write).
 */
export function createJsonlLedgerStore({ filePath }) {
  return {
    name: "jsonl-ledger-store",
    append(record) {
      appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
    },
    readAll() {
      if (!existsSync(filePath)) {
        return [];
      }
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim() !== "");
      return lines.map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          // Node's JSON.parse SyntaxError message embeds a snippet of the
          // offending text itself (e.g. `"not valid json" is not valid
          // JSON`) — passing it through would leak exactly the raw line
          // content this error type promises never to leak. A fixed,
          // content-free reason is used instead.
          throw new MalformedLedgerLineError(filePath, index + 1, "not valid JSON");
        }
      });
    },
  };
}

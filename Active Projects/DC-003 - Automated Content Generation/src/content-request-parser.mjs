// DC-003-I016 — Content Request Parser.
//
// Supports exactly one deterministic command shape, per the approved
// I016 brief: "Create <N> designs based on article <reference>". This is
// deliberately not general-purpose natural-language understanding — no
// synonyms, no reordering, no inference. Anything that doesn't match this
// one pattern is rejected as ambiguous rather than guessed at, matching
// the brief's explicit "reject ambiguous wording rather than guessing."
//
// Output shape matches what content-request-service.mjs also accepts
// directly as an already-structured request (bypassing this parser):
// { action, designCount, sourceType, sourceReference, rawCommand }.
// designCount is NOT validated against the supported contract (6) here —
// that's content-request-service.mjs's job (UnsupportedDesignCountError),
// so this parser stays a pure syntax-to-structure step with one
// responsibility.

import { AmbiguousContentRequestError } from "./content-request-errors.mjs";

// Case-insensitive on the command's own words ("Create"/"create",
// "designs"/"design"); the source reference itself is captured verbatim
// — its casing is meaningful (e.g. "GS01", not "gs01").
const COMMAND_PATTERN = /^create\s+(\d+)\s+designs?\s+based\s+on\s+(article)\s+(\S+)$/i;

/**
 * Parses one content-request command string into a structured request.
 *
 * Throws AmbiguousContentRequestError for anything that isn't a
 * non-blank string matching the one supported command shape.
 */
export function parseContentRequestCommand(command) {
  if (typeof command !== "string" || command.trim() === "") {
    throw new AmbiguousContentRequestError(
      command,
      'expected a command like "Create 6 designs based on article GS01"'
    );
  }

  const match = COMMAND_PATTERN.exec(command.trim());
  if (!match) {
    throw new AmbiguousContentRequestError(
      command,
      'expected a command like "Create 6 designs based on article GS01" — no other phrasing is understood'
    );
  }

  const [, designCountRaw, sourceType, sourceReference] = match;

  return {
    action: "create",
    designCount: Number(designCountRaw),
    sourceType: sourceType.toLowerCase(),
    sourceReference,
    rawCommand: command,
  };
}

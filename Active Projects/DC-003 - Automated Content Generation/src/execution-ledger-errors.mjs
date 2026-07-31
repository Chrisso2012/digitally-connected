// DC-003-I008 — structured errors for the Execution Ledger, its
// ExecutionRecord factory, and the JSONL Ledger Store.

/**
 * An ExecutionRecord failed schema validation via the I002 runtime.
 * `errors` is the same { path, keyword, message, params }[] shape
 * createValidator().validate() returns.
 */
export class ExecutionRecordValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Execution Record failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "ExecutionRecordValidationError";
    this.errors = errors;
  }
}

/**
 * A record's sequence is not strictly greater than the highest existing
 * sequence already recorded for the same execution_id — covers both exact
 * duplicates and any out-of-order (lower) sequence, since the brief
 * requires sequence to increase monotonically, not merely to be unique.
 * Only detectable at append time (the Execution Ledger), never by a single
 * ExecutionRecord in isolation — a record has no visibility into siblings.
 */
export class DuplicateSequenceError extends Error {
  constructor(executionId, sequence, maxExistingSequence) {
    super(
      `execution "${executionId}": sequence ${sequence} is not greater than the highest existing sequence (${maxExistingSequence}) — sequence must increase monotonically within one execution`
    );
    this.name = "DuplicateSequenceError";
    this.executionId = executionId;
    this.sequence = sequence;
    this.maxExistingSequence = maxExistingSequence;
  }
}

/**
 * A caller handed createExecutionLedger() something that doesn't implement
 * the Ledger Store shape: { name: string, append(record), readAll() }.
 */
export class InvalidLedgerStoreError extends Error {
  constructor() {
    super('A Ledger Store must be shaped { name: string, append(record), readAll() }');
    this.name = "InvalidLedgerStoreError";
  }
}

/**
 * One line of a .jsonl ledger file could not be parsed as JSON. Names the
 * file and 1-based line number — never the raw line content, in case it's
 * itself the source of a leak (e.g. a truncated write mid-object).
 */
export class MalformedLedgerLineError extends Error {
  constructor(filePath, lineNumber, cause) {
    super(`Malformed JSONL at ${filePath}:${lineNumber} — ${cause}`);
    this.name = "MalformedLedgerLineError";
    this.filePath = filePath;
    this.lineNumber = lineNumber;
  }
}

/**
 * reconstructExecution() found no records at all for the given
 * execution_id — distinct from an empty-but-valid execution, which isn't
 * representable (every real execution has at least an execution.started
 * record).
 */
export class ExecutionNotFoundError extends Error {
  constructor(executionId) {
    super(`No records found for execution_id "${executionId}"`);
    this.name = "ExecutionNotFoundError";
    this.executionId = executionId;
  }
}

/**
 * The CLI's `init` subcommand refuses to overwrite an existing ledger file.
 */
export class LedgerFileExistsError extends Error {
  constructor(filePath) {
    super(`Ledger file already exists: ${filePath} — refusing to overwrite`);
    this.name = "LedgerFileExistsError";
    this.filePath = filePath;
  }
}

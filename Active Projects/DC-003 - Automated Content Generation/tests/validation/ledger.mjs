// DC-003-I008 — CLI for the Execution Ledger: create a ledger file, append
// records, read them back, and reconstruct one execution's history.
//
// No network, no renderer, no provider interaction — purely local file I/O
// against a JSONL Ledger Store. Diagnostics printed here are exactly what
// was written to the ledger: the diagnostics allowlist
// (execution-record.schema.json) already guarantees nothing sensitive can
// be present, so no additional redaction happens at print time.
//
// Usage:
//   node tests/validation/ledger.mjs init <ledgerPath>
//   node tests/validation/ledger.mjs append <ledgerPath> <recordFieldsJsonPath>
//   node tests/validation/ledger.mjs read <ledgerPath> [executionId]
//   node tests/validation/ledger.mjs reconstruct <ledgerPath> <executionId>
//
//   or: npm run ledger -- <subcommand> ...

import { readFileSync, writeFileSync } from "node:fs";
import { createJsonlLedgerStore } from "../../src/jsonl-ledger-store.mjs";
import { createExecutionLedger } from "../../src/execution-ledger.mjs";
import {
  ExecutionRecordValidationError,
  DuplicateSequenceError,
  InvalidLedgerStoreError,
  MalformedLedgerLineError,
  ExecutionNotFoundError,
  LedgerFileExistsError,
} from "../../src/execution-ledger-errors.mjs";

const [subcommand, ledgerPath, ...rest] = process.argv.slice(2);

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/ledger.mjs init <ledgerPath>");
  console.error("  node tests/validation/ledger.mjs append <ledgerPath> <recordFieldsJsonPath>");
  console.error("  node tests/validation/ledger.mjs read <ledgerPath> [executionId]");
  console.error("  node tests/validation/ledger.mjs reconstruct <ledgerPath> <executionId>");
  process.exit(1);
}

if (!subcommand || !ledgerPath) usageAndExit();

try {
  if (subcommand === "init") {
    try {
      writeFileSync(ledgerPath, "", { flag: "wx" });
    } catch (cause) {
      if (cause.code === "EEXIST") throw new LedgerFileExistsError(ledgerPath);
      throw cause;
    }
    console.log(`Ledger created OK — ${ledgerPath}`);
  } else if (subcommand === "append") {
    const recordFieldsPath = rest[0];
    if (!recordFieldsPath) usageAndExit();
    const fields = JSON.parse(readFileSync(recordFieldsPath, "utf-8"));
    const store = createJsonlLedgerStore({ filePath: ledgerPath });
    const ledger = createExecutionLedger({ store });
    const record = ledger.appendRecord(fields);

    console.log("Record appended OK");
    console.log(`  record ID:    ${record.record_id}`);
    console.log(`  execution ID: ${record.execution_id}`);
    console.log(`  sequence:     ${record.sequence}`);
    console.log(`  event type:   ${record.event_type}`);
    console.log(`  status:       ${record.status}`);
  } else if (subcommand === "read") {
    const executionId = rest[0];
    const store = createJsonlLedgerStore({ filePath: ledgerPath });
    const ledger = createExecutionLedger({ store });
    const records = ledger.readAll().filter((r) => !executionId || r.execution_id === executionId);

    console.log(`${records.length} record(s)`);
    for (const record of records) {
      console.log(
        `  [${record.sequence}] ${record.execution_id} ${record.event_type} (${record.status}) at ${record.occurred_at}`
      );
    }
  } else if (subcommand === "reconstruct") {
    const executionId = rest[0];
    if (!executionId) usageAndExit();
    const store = createJsonlLedgerStore({ filePath: ledgerPath });
    const ledger = createExecutionLedger({ store });
    const execution = ledger.reconstructExecution(executionId);

    console.log("Execution reconstructed OK");
    console.log(`  execution ID:  ${execution.executionId}`);
    console.log(`  record count:  ${execution.recordCount}`);
    console.log(`  first event:   ${execution.firstEventAt}`);
    console.log(`  last event:    ${execution.lastEventAt}`);
    console.log(`  final status:  ${execution.finalStatus}`);
    for (const record of execution.records) {
      console.log(`    [${record.sequence}] ${record.event_type} (${record.status})`);
    }
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`FAIL  File not found: ${error.path ?? ledgerPath}`);
  } else if (error instanceof SyntaxError) {
    console.error(`FAIL  Malformed JSON: ${error.message}`);
  } else if (
    error instanceof ExecutionRecordValidationError ||
    error instanceof MalformedLedgerLineError ||
    error instanceof DuplicateSequenceError ||
    error instanceof InvalidLedgerStoreError ||
    error instanceof ExecutionNotFoundError ||
    error instanceof LedgerFileExistsError
  ) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

// DC-003-I010 — CLI for the External Invocation Adapter: builds a mock-only
// Pipeline Orchestrator, wraps it in an adapter, and invokes it against one
// raw InvocationRequest JSON file. Demonstrates request validation, a
// successful invocation, a validation failure, and safe response printing
// — no network, no live provider interaction anywhere.
//
// Usage: node tests/validation/invoke.mjs <invocationRequestJsonPath> <ledgerPath>
//    or: npm run invoke -- <path> <ledgerPath>

import { readFileSync } from "node:fs";
import { createJsonlLedgerStore } from "../../src/jsonl-ledger-store.mjs";
import { createExecutionLedger } from "../../src/execution-ledger.mjs";
import { createPipelineOrchestrator } from "../../src/pipeline-orchestrator.mjs";
import { createExternalInvocationAdapter } from "../../src/invocation-adapter.mjs";

const [requestPath, ledgerPath] = process.argv.slice(2);

if (!requestPath || !ledgerPath) {
  console.error("Usage: node tests/validation/invoke.mjs <invocationRequestJsonPath> <ledgerPath>");
  process.exit(1);
}

try {
  const rawRequest = JSON.parse(readFileSync(requestPath, "utf-8"));

  const store = createJsonlLedgerStore({ filePath: ledgerPath });
  const ledger = createExecutionLedger({ store });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const adapter = createExternalInvocationAdapter({ orchestrator });

  const response = await adapter.invoke(rawRequest);

  console.log(response.accepted ? "Request accepted" : "Request rejected");
  console.log(`  request ID:   ${response.request_id}`);
  console.log(`  execution ID: ${response.execution_id}`);
  console.log(`  status:       ${response.status}`);
  if (response.warnings.length > 0) {
    console.log(`  warnings:     ${response.warnings.length}`);
    for (const warning of response.warnings) console.log(`    - ${warning}`);
  }
  if (response.status === "completed") {
    console.log(`  carousel ID:  ${response.finished_carousel.carousel_id}`);
    console.log(`  overall status: ${response.finished_carousel.overall_status}`);
  } else if (response.error) {
    console.log(`  error code:   ${response.error.code}`);
    console.log(`  error:        ${response.error.message}`);
    console.log(`  retryable:    ${response.error.retryable}`);
  }

  process.exit(response.status === "completed" ? 0 : 1);
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`FAIL  File not found: ${requestPath}`);
  } else if (error instanceof SyntaxError) {
    console.error(`FAIL  Malformed JSON: ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

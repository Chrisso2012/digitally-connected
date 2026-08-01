// DC-003-I011 — CLI for the n8n Adapter: builds a mock-only Pipeline
// Orchestrator + External Invocation Adapter, wraps it in the n8n Adapter,
// and invokes it against one raw workflow-input JSON file. Demonstrates a
// successful invocation, invalid input, and safe output formatting — no
// network, no live provider interaction anywhere.
//
// Usage: node tests/validation/n8n-invoke.mjs <workflowInputJsonPath> <ledgerPath>
//    or: npm run n8n -- <path> <ledgerPath>

import { readFileSync } from "node:fs";
import { createJsonlLedgerStore } from "../../src/jsonl-ledger-store.mjs";
import { createExecutionLedger } from "../../src/execution-ledger.mjs";
import { createPipelineOrchestrator } from "../../src/pipeline-orchestrator.mjs";
import { createExternalInvocationAdapter } from "../../src/invocation-adapter.mjs";
import { createN8nAdapter } from "../../src/n8n-adapter.mjs";

const [workflowInputPath, ledgerPath] = process.argv.slice(2);

if (!workflowInputPath || !ledgerPath) {
  console.error("Usage: node tests/validation/n8n-invoke.mjs <workflowInputJsonPath> <ledgerPath>");
  process.exit(1);
}

try {
  const workflowInput = JSON.parse(readFileSync(workflowInputPath, "utf-8"));

  const store = createJsonlLedgerStore({ filePath: ledgerPath });
  const ledger = createExecutionLedger({ store });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const invocationAdapter = createExternalInvocationAdapter({ orchestrator });
  const n8nAdapter = createN8nAdapter({ invocationAdapter });

  const output = await n8nAdapter.invoke(workflowInput);

  console.log(output.success ? "n8n output: success" : "n8n output: not successful");
  console.log(`  requestId:   ${output.requestId}`);
  console.log(`  executionId: ${output.executionId}`);
  console.log(`  status:      ${output.status}`);
  if (output.warnings.length > 0) {
    console.log(`  warnings:    ${output.warnings.length}`);
    for (const warning of output.warnings) console.log(`    - ${warning}`);
  }
  if (output.success) {
    console.log(`  carousel ID: ${output.finishedCarousel.carousel_id}`);
    console.log(`  overall status: ${output.finishedCarousel.overall_status}`);
  } else if (output.error) {
    console.log(`  error code:  ${output.error.code}`);
    console.log(`  error:       ${output.error.message}`);
    console.log(`  retryable:   ${output.error.retryable}`);
  }

  process.exit(output.success ? 0 : 1);
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`FAIL  File not found: ${workflowInputPath}`);
  } else if (error instanceof SyntaxError) {
    console.error(`FAIL  Malformed JSON: ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

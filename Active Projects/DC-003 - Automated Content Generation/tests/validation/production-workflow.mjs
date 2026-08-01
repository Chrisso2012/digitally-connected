// DC-003-I012 — CLI for the Production Workflow: composes the entire
// platform (JSONL Ledger Store -> Execution Ledger -> Pipeline
// Orchestrator -> External Invocation Adapter -> n8n Adapter -> Production
// Workflow) into one end-to-end production execution, persists the
// result, and prints the workflow summary. Mock-only — no production
// services, no network.
//
// Usage: node tests/validation/production-workflow.mjs <workflowInputJsonPath> <ledgerPath> <outputJsonPath>
//    or: npm run workflow -- <path> <ledgerPath> <outputPath>

import { readFileSync } from "node:fs";
import { createJsonlLedgerStore } from "../../src/jsonl-ledger-store.mjs";
import { createExecutionLedger } from "../../src/execution-ledger.mjs";
import { createPipelineOrchestrator } from "../../src/pipeline-orchestrator.mjs";
import { createExternalInvocationAdapter } from "../../src/invocation-adapter.mjs";
import { createN8nAdapter } from "../../src/n8n-adapter.mjs";
import { createProductionWorkflow, persistWorkflowOutput } from "../../src/production-workflow.mjs";

const [workflowInputPath, ledgerPath, outputPath] = process.argv.slice(2);

if (!workflowInputPath || !ledgerPath || !outputPath) {
  console.error("Usage: node tests/validation/production-workflow.mjs <workflowInputJsonPath> <ledgerPath> <outputJsonPath>");
  process.exit(1);
}

try {
  const workflowInput = JSON.parse(readFileSync(workflowInputPath, "utf-8"));

  const store = createJsonlLedgerStore({ filePath: ledgerPath });
  const ledger = createExecutionLedger({ store });
  const orchestrator = createPipelineOrchestrator({ ledger });
  const invocationAdapter = createExternalInvocationAdapter({ orchestrator });
  const n8nAdapter = createN8nAdapter({ invocationAdapter });
  const workflow = createProductionWorkflow({ n8nAdapter });

  const result = await workflow.run(workflowInput);
  persistWorkflowOutput(outputPath, result);

  console.log(result.summary.status === "completed" ? "Workflow complete" : "Workflow did not complete successfully");
  console.log(`  status:        ${result.summary.status}`);
  console.log(`  requestId:     ${result.summary.requestId}`);
  console.log(`  executionId:   ${result.summary.executionId}`);
  console.log(`  duration:      ${result.summary.durationMs}ms`);
  console.log(`  completed at:  ${result.summary.completedAt}`);
  console.log(`  warning count: ${result.summary.warningCount}`);
  console.log(`  has error:     ${result.summary.hasError}`);
  console.log(`  output written to: ${outputPath}`);
  if (result.invocationResponse.error) {
    console.log(`  error code:    ${result.invocationResponse.error.code}`);
    console.log(`  error:         ${result.invocationResponse.error.message}`);
  }

  process.exit(result.summary.status === "completed" ? 0 : 1);
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

// DC-003-I009 — CLI for the Pipeline Orchestrator: create a pipeline,
// execute it end-to-end from one Topic Package file, print a safe
// PipelineResult, then print the reconstructed execution summary from the
// Execution Ledger.
//
// No live provider interaction — every stage defaults to a mock
// provider/transport (see pipeline-stages.mjs). No network.
//
// Usage: node tests/validation/pipeline.mjs <topicPackagePath> <ledgerPath>
//    or: npm run pipeline -- <topicPackagePath> <ledgerPath>

import { createJsonlLedgerStore } from "../../src/jsonl-ledger-store.mjs";
import { createExecutionLedger } from "../../src/execution-ledger.mjs";
import { createPipelineOrchestrator } from "../../src/pipeline-orchestrator.mjs";
import { PipelineConfigurationError } from "../../src/pipeline-errors.mjs";

const [topicPackagePath, ledgerPath] = process.argv.slice(2);

if (!topicPackagePath || !ledgerPath) {
  console.error("Usage: node tests/validation/pipeline.mjs <topicPackagePath> <ledgerPath>");
  process.exit(1);
}

try {
  const store = createJsonlLedgerStore({ filePath: ledgerPath });
  const ledger = createExecutionLedger({ store });
  const orchestrator = createPipelineOrchestrator({ ledger });

  const result = await orchestrator.run({
    configuration: { topicPackageSource: { filePath: topicPackagePath } },
  });

  console.log(result.success ? "Pipeline OK" : "Pipeline FAILED");
  console.log(`  execution ID: ${result.executionId}`);
  console.log(`  success:      ${result.success}`);
  console.log(`  duration:     ${result.duration}ms`);
  if (result.warnings.length > 0) {
    console.log(`  warnings:     ${result.warnings.length}`);
    for (const warning of result.warnings) console.log(`    - ${warning}`);
  }
  if (result.success) {
    console.log(`  carousel ID:  ${result.finishedCarousel.carousel_id}`);
    console.log(`  overall status: ${result.finishedCarousel.overall_status}`);
  } else {
    console.log(`  failed stage: ${result.error.stage}`);
    console.log(`  error code:   ${result.error.code}`);
    console.log(`  error:        ${result.error.message}`);
  }

  console.log("");
  console.log("Execution summary:");
  const execution = ledger.reconstructExecution(result.executionId);
  console.log(`  record count: ${execution.recordCount}`);
  console.log(`  first event:  ${execution.firstEventAt}`);
  console.log(`  last event:   ${execution.lastEventAt}`);
  console.log(`  final status: ${execution.finalStatus}`);
  for (const record of execution.records) {
    console.log(`    [${record.sequence}] ${record.event_type} (${record.status})${record.stage ? ` — ${record.stage}` : ""}`);
  }

  process.exit(result.success ? 0 : 1);
} catch (error) {
  if (error instanceof PipelineConfigurationError) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
    process.exit(1);
  }
  // Genuinely unexpected — a stack trace is warranted here.
  throw error;
}

// DC-003-I029.2 — CLI for the Automated Delivery Office Runner. Default is
// ALWAYS the mock runner — real Claude Code execution requires the
// unmistakable `--live-runner` flag, invokes exactly one Work Order, and
// performs no automatic retry and no second Work Order, per this
// milestone's own §14.
//
// Usage:
//   node tests/validation/delivery-office-runner.mjs inspect --repo=<repositoryPath> [--branch=<name>]
//   node tests/validation/delivery-office-runner.mjs execute <workOrderId> <workOrderStoreDirectory> <deliveryReportStoreDirectory> <bridgeTransportStoreDirectory>
//       --repo=<repositoryPath> --lock=<lockDirectory> --drop=<deliveryReportDropDir>
//       [--branch=<name>] [--live-runner] [--allow-newer-commit] [--allow-push] [--allow-commits] [--allow-docker] [--max-cost-usd=<n>]
//   node tests/validation/delivery-office-runner.mjs status <workOrderId> <workOrderStoreDirectory> <deliveryReportStoreDirectory> --lock=<lockDirectory>
//
//   or: npm run delivery-office -- <subcommand> ...

import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import {
  InvalidEngineeringWorkOrderStoreAdapterError,
  InvalidEngineeringWorkOrderIdentifierError,
  EngineeringWorkOrderNotFoundError,
  CorruptedEngineeringWorkOrderError,
  EngineeringWorkOrderPersistenceError,
} from "../../src/engineering-work-order-errors.mjs";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import {
  InvalidEngineeringDeliveryReportStoreAdapterError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
} from "../../src/engineering-delivery-report-errors.mjs";
import { createLocalJsonBridgeTransportStoreAdapter } from "../../src/local-json-bridge-transport-store-adapter.mjs";
import { createBridgeTransportStore } from "../../src/bridge-transport-store.mjs";
import { createMockBridgeTransportAdapter } from "../../src/bridge-transport-mock-adapter.mjs";
import {
  InvalidBridgeTransportStoreAdapterError,
  CorruptedBridgeTransportRecordError,
  BridgeTransportPersistenceError,
  BridgeTransportCorruptionError,
  DuplicateBridgeTransportError,
} from "../../src/bridge-transport-errors.mjs";
import { createDeliveryExecutionLock } from "../../src/delivery-execution-lock.mjs";
import { createExecutionPolicy } from "../../src/execution-policy.mjs";
import { createMockDeliveryOfficeRunnerAdapter } from "../../src/delivery-office-mock-runner-adapter.mjs";
import { createClaudeCodeDeliveryRunnerAdapter } from "../../src/claude-code-delivery-runner-adapter.mjs";
import { loadDeliveryOfficeRunnerConfig, describeAuthenticationAvailability } from "../../src/delivery-office-runner-config.mjs";
import { createAutomatedDeliveryOfficeService } from "../../src/automated-delivery-office-service.mjs";
import {
  InvalidExecutionPolicyError,
  InvalidExecutionLockIdentifierError,
  ExecutionLockAlreadyHeldError,
  ExecutionLockNotHeldError,
  ExecutionLockOwnershipError,
  ExecutionLockPersistenceError,
  InvalidDeliveryOfficeRunnerAdapterError,
  MalformedRunnerResultError,
  RunnerExecutionFailedError,
  WorkOrderNotEligibleError,
  DuplicateDeliveryError,
  InvalidAutomatedDeliveryOfficeDependenciesError,
} from "../../src/delivery-office-errors.mjs";

const KNOWN_ERRORS = [
  InvalidEngineeringWorkOrderStoreAdapterError,
  InvalidEngineeringWorkOrderIdentifierError,
  EngineeringWorkOrderNotFoundError,
  CorruptedEngineeringWorkOrderError,
  EngineeringWorkOrderPersistenceError,
  InvalidEngineeringDeliveryReportStoreAdapterError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
  InvalidBridgeTransportStoreAdapterError,
  CorruptedBridgeTransportRecordError,
  BridgeTransportPersistenceError,
  BridgeTransportCorruptionError,
  DuplicateBridgeTransportError,
  InvalidExecutionPolicyError,
  InvalidExecutionLockIdentifierError,
  ExecutionLockAlreadyHeldError,
  ExecutionLockNotHeldError,
  ExecutionLockOwnershipError,
  ExecutionLockPersistenceError,
  InvalidDeliveryOfficeRunnerAdapterError,
  MalformedRunnerResultError,
  RunnerExecutionFailedError,
  WorkOrderNotEligibleError,
  DuplicateDeliveryError,
  InvalidAutomatedDeliveryOfficeDependenciesError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/delivery-office-runner.mjs inspect --repo=<repositoryPath> [--branch=<name>]");
  console.error(
    "  node tests/validation/delivery-office-runner.mjs execute <workOrderId> <workOrderStoreDirectory> <deliveryReportStoreDirectory> <bridgeTransportStoreDirectory> --repo=<repositoryPath> --lock=<lockDirectory> --drop=<deliveryReportDropDir> [--branch=<name>] [--live-runner] [--allow-newer-commit] [--allow-push] [--allow-commits] [--allow-docker] [--max-cost-usd=<n>]"
  );
  console.error("  node tests/validation/delivery-office-runner.mjs status <workOrderId> <workOrderStoreDirectory> <deliveryReportStoreDirectory> --lock=<lockDirectory>");
  process.exit(1);
}

function extractFlags(args) {
  const flags = {};
  const rest = [];
  for (const arg of args) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) {
      flags[match[1]] = match[2] ?? true;
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

function buildExecutionPolicy(flags) {
  if (!flags.repo) {
    console.error('FAIL  --repo=<repositoryPath> is required');
    process.exit(1);
  }
  return createExecutionPolicy({
    repositoryPath: flags.repo,
    permittedBranch: flags.branch ?? "main",
    allowCommits: Boolean(flags["allow-commits"]) || Boolean(flags["allow-push"]),
    allowPush: Boolean(flags["allow-push"]),
    allowDocker: Boolean(flags["allow-docker"]),
    maxCostUsd: flags["max-cost-usd"] ? Number(flags["max-cost-usd"]) : undefined,
  });
}

function buildRunnerAdapter(flags) {
  return flags["live-runner"] ? createClaudeCodeDeliveryRunnerAdapter() : createMockDeliveryOfficeRunnerAdapter();
}

function printInspect(flags) {
  const config = loadDeliveryOfficeRunnerConfig(process.env);
  const auth = describeAuthenticationAvailability(process.env);
  const policy = flags.repo ? buildExecutionPolicy(flags) : null;

  console.log("Automated Delivery Office Runner — Inspect");
  console.log();
  console.log(`  Selected runner (default):  mock-delivery-office-runner`);
  console.log(`  Live runner mechanism:      ${config.command} (${config.source})`);
  console.log(`  Authentication mechanism:   ${auth.mechanism}`);
  if (policy) {
    console.log(`  Repository path:            ${policy.repositoryPath}`);
    console.log(`  Permitted branch:           ${policy.permittedBranch}`);
    console.log(`  Allowed tools:              ${policy.allowedTools.join(" ")}`);
    console.log(`  Disallowed tools:           ${policy.disallowedTools.join(" ")}`);
    console.log(`  Command timeout (ms):       ${policy.commandTimeoutMs}`);
    console.log(`  Max run duration (ms):      ${policy.maxRunDurationMs}`);
    console.log(`  Allow commits/push/docker:  ${policy.allowCommits}/${policy.allowPush}/${policy.allowDocker}`);
    console.log(`  Prohibit live external:     ${policy.prohibitLiveExternalCalls}`);
    console.log(`  Prohibit infra changes:     ${policy.prohibitInfrastructureChanges}`);
    console.log(`  Max cost (USD):             ${policy.maxCostUsd}`);
  } else {
    console.log("  (pass --repo=<repositoryPath> to also see the resolved Execution Policy)");
  }
  console.log();
  console.log("  No Claude Code invocation occurs as part of this command.");
}

function buildStores(workOrderStoreDirectory, deliveryReportStoreDirectory, bridgeTransportStoreDirectory) {
  const workOrderStore = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: workOrderStoreDirectory }) });
  const deliveryReportStore = createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: deliveryReportStoreDirectory }) });
  const transportStore = bridgeTransportStoreDirectory
    ? createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: bridgeTransportStoreDirectory }) })
    : null;
  return { workOrderStore, deliveryReportStore, transportStore };
}

const [subcommand, ...rawRest] = process.argv.slice(2);
if (!subcommand) usageAndExit();
const { flags, rest } = extractFlags(rawRest);

try {
  if (subcommand === "inspect") {
    printInspect(flags);
  } else if (subcommand === "execute") {
    const [workOrderId, workOrderStoreDirectory, deliveryReportStoreDirectory, bridgeTransportStoreDirectory] = rest;
    if (!workOrderId || !workOrderStoreDirectory || !deliveryReportStoreDirectory || !bridgeTransportStoreDirectory || !flags.lock || !flags.drop) usageAndExit();

    const executionPolicy = buildExecutionPolicy(flags);
    const { workOrderStore, deliveryReportStore, transportStore } = buildStores(workOrderStoreDirectory, deliveryReportStoreDirectory, bridgeTransportStoreDirectory);
    const lock = createDeliveryExecutionLock({ lockDir: flags.lock });
    const runnerAdapter = buildRunnerAdapter(flags);

    console.log("Automated Delivery Office Runner — Execute");
    console.log();
    console.log(`  Work Order:        ${workOrderId}`);
    console.log(`  Runner:            ${runnerAdapter.name}${flags["live-runner"] ? "  (LIVE — real Claude Code execution)" : "  (mock — no Claude Code execution)"}`);
    console.log(`  Repository:        ${executionPolicy.repositoryPath}`);
    console.log(`  Branch:            ${executionPolicy.permittedBranch}`);
    console.log(`  Max run duration:  ${executionPolicy.maxRunDurationMs} ms`);
    console.log();

    const service = createAutomatedDeliveryOfficeService({
      workOrderStore,
      deliveryReportStore,
      transportStore,
      transportAdapter: createMockBridgeTransportAdapter(),
      runnerAdapter,
      lock,
      executionPolicy,
      deliveryReportDropDir: flags.drop,
    });

    const result = await service.executeApprovedWorkOrder({
      workOrderId,
      allowNewerStartingCommit: Boolean(flags["allow-newer-commit"]),
    });

    console.log("Execution complete");
    console.log(`  delivery_report_id:  ${result.deliveryReportId}`);
    console.log(`  status:              ${result.status}`);
    console.log(`  commit:              ${result.commit}`);
    console.log(`  transport_record_id: ${result.transportRecordId}`);
  } else if (subcommand === "status") {
    const [workOrderId, workOrderStoreDirectory, deliveryReportStoreDirectory] = rest;
    if (!workOrderId || !workOrderStoreDirectory || !deliveryReportStoreDirectory || !flags.lock) usageAndExit();

    // Status is a pure read across three already-existing components —
    // deliberately NOT assembled through createAutomatedDeliveryOfficeService()
    // (which requires a full transport/runner/policy wiring meant for
    // execute()); reading is simpler than executing and should not need
    // to fake dependencies execute() alone needs.
    const { workOrderStore, deliveryReportStore } = buildStores(workOrderStoreDirectory, deliveryReportStoreDirectory, null);
    const lock = createDeliveryExecutionLock({ lockDir: flags.lock });

    const workOrder = workOrderStore.get(workOrderId);
    const deliveryReports = deliveryReportStore.findByWorkOrder(workOrderId);
    const lockInfo = lock.inspect(workOrderId);

    console.log("Automated Delivery Office Runner — Status");
    console.log();
    console.log(`  work_order_id:      ${workOrder.work_order_id}`);
    console.log(`  status:             ${workOrder.status}`);
    console.log(`  delivery_reports:   ${deliveryReports.length}`);
    for (const report of deliveryReports) {
      console.log(`    - [${report.delivery_report_id}] status=${report.status} commit=${report.commit} at=${report.delivery_timestamp}`);
    }
    console.log(`  lock:               ${lockInfo ? `held (acquired_at=${lockInfo.acquiredAt}, stale=${lockInfo.stale})` : "not held"}`);
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (KNOWN_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    throw error;
  }
  process.exit(1);
}

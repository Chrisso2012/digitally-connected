// DC-003-I029.4 — CLI for the Automated Operations Bridge. Orchestrates
// tests/validation/delivery-office-runner.mjs (I029.2) and
// tests/validation/strategy-review-agent.mjs (I029.3) into one command —
// this file constructs each of their two underlying services EXACTLY the
// way each standalone CLI already does (same store/lock/policy/adapter
// wiring), then hands both finished services to
// createOperationsBridgeService(). No eligibility/lock/git/review logic
// lives here. Default is ALWAYS both mock adapters — real Claude Code
// execution and real OpenAI review each require their own unmistakable
// flag (`--live-runner`, `--live-review`), independently, exactly like
// the standalone CLIs.
//
// Usage:
//   node tests/validation/operations-bridge.mjs inspect --repo=<repositoryPath> [--branch=<name>]
//   node tests/validation/operations-bridge.mjs run <workOrderId> <workOrderStoreDirectory> <deliveryReportStoreDirectory> <strategyReviewStoreDirectory> <bridgeTransportStoreDirectory> <repositoryPath>
//       --delivery-lock=<lockDirectory> --review-lock=<lockDirectory> --drop=<deliveryReportDropDir> --export=<reviewExportDir>
//       [--branch=<name>] [--live-runner] [--live-review] [--allow-newer-commit]
//       [--allow-push] [--allow-commits] [--allow-docker] [--max-cost-usd=<n>]
//       [--rerun-tests] [--rerun-fixtures] [--allow-delivery-branch-differ]
//   node tests/validation/operations-bridge.mjs status <workOrderId> <workOrderStoreDirectory> <deliveryReportStoreDirectory> <strategyReviewStoreDirectory>
//       --delivery-lock=<lockDirectory> --review-lock=<lockDirectory>
//
//   or: npm run operations-bridge -- <subcommand> ...

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
  EngineeringDeliveryReportNotFoundError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
} from "../../src/engineering-delivery-report-errors.mjs";
import { createLocalJsonEngineeringStrategyReviewStoreAdapter } from "../../src/local-json-engineering-strategy-review-store-adapter.mjs";
import { createEngineeringStrategyReviewStore } from "../../src/engineering-strategy-review-store.mjs";
import {
  InvalidEngineeringStrategyReviewStoreAdapterError,
  CorruptedEngineeringStrategyReviewError,
  EngineeringStrategyReviewPersistenceError,
  DuplicateDeliveryReportReviewError,
} from "../../src/engineering-strategy-review-errors.mjs";
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
import { loadDeliveryOfficeRunnerConfig, describeAuthenticationAvailability as describeClaudeCodeAuthenticationAvailability } from "../../src/delivery-office-runner-config.mjs";
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
import { createStrategyReviewLock } from "../../src/strategy-review-lock.mjs";
import { createStrategyReviewPolicy } from "../../src/strategy-review-policy.mjs";
import { createStrategyReviewMockAdapter } from "../../src/strategy-review-mock-adapter.mjs";
import { createOpenAiStrategyReviewAdapter } from "../../src/openai-strategy-review-adapter.mjs";
import { loadStrategyReviewConfig, describeAuthenticationAvailability as describeOpenAiAuthenticationAvailability } from "../../src/strategy-review-config.mjs";
import { createAutomatedStrategyReviewService } from "../../src/automated-strategy-review-service.mjs";
import {
  InvalidStrategyReviewPolicyError,
  InvalidStrategyReviewLockIdentifierError,
  StrategyReviewLockAlreadyHeldError,
  StrategyReviewLockNotHeldError,
  StrategyReviewLockOwnershipError,
  StrategyReviewLockPersistenceError,
  InvalidStrategyReviewAgentAdapterError,
  MalformedReviewProposalError,
  ReviewAdapterExecutionFailedError,
  DeliveryReportNotEligibleForReviewError,
  InvalidAutomatedStrategyReviewDependenciesError,
  EvidenceRelationshipMismatchError,
  EvidenceCollectionFailedError,
  StrategyReviewConfigurationError,
  StrategyReviewAuthenticationError,
  StrategyReviewRateLimitError,
  StrategyReviewTimeoutError,
  StrategyReviewClientError,
  StrategyReviewTransportError,
} from "../../src/strategy-review-errors.mjs";
import { createOperationsBridgeService, getOperationsBridgeStatus } from "../../src/automated-operations-bridge-service.mjs";
import { InvalidAutomatedOperationsBridgeDependenciesError } from "../../src/operations-bridge-errors.mjs";

const KNOWN_ERRORS = [
  InvalidEngineeringWorkOrderStoreAdapterError,
  InvalidEngineeringWorkOrderIdentifierError,
  EngineeringWorkOrderNotFoundError,
  CorruptedEngineeringWorkOrderError,
  EngineeringWorkOrderPersistenceError,
  InvalidEngineeringDeliveryReportStoreAdapterError,
  EngineeringDeliveryReportNotFoundError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
  InvalidEngineeringStrategyReviewStoreAdapterError,
  CorruptedEngineeringStrategyReviewError,
  EngineeringStrategyReviewPersistenceError,
  DuplicateDeliveryReportReviewError,
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
  InvalidStrategyReviewPolicyError,
  InvalidStrategyReviewLockIdentifierError,
  StrategyReviewLockAlreadyHeldError,
  StrategyReviewLockNotHeldError,
  StrategyReviewLockOwnershipError,
  StrategyReviewLockPersistenceError,
  InvalidStrategyReviewAgentAdapterError,
  MalformedReviewProposalError,
  ReviewAdapterExecutionFailedError,
  DeliveryReportNotEligibleForReviewError,
  InvalidAutomatedStrategyReviewDependenciesError,
  EvidenceRelationshipMismatchError,
  EvidenceCollectionFailedError,
  StrategyReviewConfigurationError,
  StrategyReviewAuthenticationError,
  StrategyReviewRateLimitError,
  StrategyReviewTimeoutError,
  StrategyReviewClientError,
  StrategyReviewTransportError,
  InvalidAutomatedOperationsBridgeDependenciesError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/operations-bridge.mjs inspect --repo=<repositoryPath> [--branch=<name>]");
  console.error(
    "  node tests/validation/operations-bridge.mjs run <workOrderId> <workOrderStoreDirectory> <deliveryReportStoreDirectory> <strategyReviewStoreDirectory> <bridgeTransportStoreDirectory> <repositoryPath> --delivery-lock=<lockDirectory> --review-lock=<lockDirectory> --drop=<deliveryReportDropDir> --export=<reviewExportDir> [--branch=<name>] [--live-runner] [--live-review] [--allow-newer-commit] [--allow-push] [--allow-commits] [--allow-docker] [--max-cost-usd=<n>] [--rerun-tests] [--rerun-fixtures] [--allow-delivery-branch-differ]"
  );
  console.error(
    "  node tests/validation/operations-bridge.mjs status <workOrderId> <workOrderStoreDirectory> <deliveryReportStoreDirectory> <strategyReviewStoreDirectory> --delivery-lock=<lockDirectory> --review-lock=<lockDirectory>"
  );
  process.exit(1);
}

function extractFlags(args) {
  const flags = {};
  const rest = [];
  for (const arg of args) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags[match[1]] = match[2] ?? true;
    else rest.push(arg);
  }
  return { flags, rest };
}

function buildExecutionPolicy(flags) {
  if (!flags.repo) {
    console.error("FAIL  --repo=<repositoryPath> is required");
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

function buildStrategyReviewPolicy(flags) {
  return createStrategyReviewPolicy({
    repositoryPath: flags.repo,
    permittedBranch: flags.branch ?? "main",
    allowDeliveryBranchDifferFromMain: Boolean(flags["allow-delivery-branch-differ"]),
    rerunTests: Boolean(flags["rerun-tests"]),
    rerunFixtures: Boolean(flags["rerun-fixtures"]),
  });
}

function buildRunnerAdapter(flags) {
  return flags["live-runner"] ? createClaudeCodeDeliveryRunnerAdapter() : createMockDeliveryOfficeRunnerAdapter();
}

function buildReviewerAdapter(flags) {
  if (!flags["live-review"]) return createStrategyReviewMockAdapter();
  const config = loadStrategyReviewConfig(process.env);
  return createOpenAiStrategyReviewAdapter(config);
}

function printInspect(flags) {
  const runnerConfig = loadDeliveryOfficeRunnerConfig(process.env);
  const runnerAuth = describeClaudeCodeAuthenticationAvailability(process.env);
  const reviewConfig = loadStrategyReviewConfig(process.env);
  const reviewAuth = describeOpenAiAuthenticationAvailability(process.env);
  const executionPolicy = flags.repo ? buildExecutionPolicy(flags) : null;

  console.log("Automated Operations Bridge — Inspect");
  console.log();
  console.log("  Stage 1 — Delivery Office (I029.2):");
  console.log(`    Selected runner (default):  mock-delivery-office-runner`);
  console.log(`    Live runner mechanism:      ${runnerConfig.command} (${runnerConfig.source})`);
  console.log(`    Authentication mechanism:   ${runnerAuth.mechanism}`);
  console.log();
  console.log("  Stage 2 — Strategy Review (I029.3):");
  console.log(`    Selected reviewer (default): mock-strategy-review-adapter`);
  console.log(`    Live reviewer model:         ${reviewConfig.model}`);
  console.log(`    Authentication mechanism:    ${reviewAuth.mechanism} (available=${reviewAuth.available})`);
  console.log(`    Max OpenAI requests:         1 (fixed, not configurable)`);
  console.log();
  if (executionPolicy) {
    console.log(`  Repository path:            ${executionPolicy.repositoryPath}`);
    console.log(`  Permitted branch:           ${executionPolicy.permittedBranch}`);
    console.log(`  Allow commits/push/docker:  ${executionPolicy.allowCommits}/${executionPolicy.allowPush}/${executionPolicy.allowDocker}`);
  } else {
    console.log("  (pass --repo=<repositoryPath> to also see the resolved Execution Policy)");
  }
  console.log();
  console.log("  No Claude Code or OpenAI invocation occurs as part of this command.");
}

function buildStores(workOrderStoreDirectory, deliveryReportStoreDirectory, strategyReviewStoreDirectory, bridgeTransportStoreDirectory) {
  const workOrderStore = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: workOrderStoreDirectory }) });
  const deliveryReportStore = createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: deliveryReportStoreDirectory }) });
  const strategyReviewStore = strategyReviewStoreDirectory
    ? createEngineeringStrategyReviewStore({ adapter: createLocalJsonEngineeringStrategyReviewStoreAdapter({ storageDir: strategyReviewStoreDirectory }) })
    : null;
  const transportStore = bridgeTransportStoreDirectory
    ? createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: bridgeTransportStoreDirectory }) })
    : null;
  return { workOrderStore, deliveryReportStore, strategyReviewStore, transportStore };
}

const [subcommand, ...rawRest] = process.argv.slice(2);
if (!subcommand) usageAndExit();
const { flags, rest } = extractFlags(rawRest);

try {
  if (subcommand === "inspect") {
    printInspect(flags);
  } else if (subcommand === "run") {
    const [workOrderId, workOrderStoreDirectory, deliveryReportStoreDirectory, strategyReviewStoreDirectory, bridgeTransportStoreDirectory, repositoryPathPositional] = rest;
    if (
      !workOrderId ||
      !workOrderStoreDirectory ||
      !deliveryReportStoreDirectory ||
      !strategyReviewStoreDirectory ||
      !bridgeTransportStoreDirectory ||
      !repositoryPathPositional ||
      !flags["delivery-lock"] ||
      !flags["review-lock"] ||
      !flags.drop ||
      !flags.export
    ) {
      usageAndExit();
    }
    flags.repo = flags.repo ?? repositoryPathPositional;

    const executionPolicy = buildExecutionPolicy(flags);
    const strategyReviewPolicy = buildStrategyReviewPolicy(flags);
    const { workOrderStore, deliveryReportStore, strategyReviewStore, transportStore } = buildStores(
      workOrderStoreDirectory,
      deliveryReportStoreDirectory,
      strategyReviewStoreDirectory,
      bridgeTransportStoreDirectory
    );
    const deliveryLock = createDeliveryExecutionLock({ lockDir: flags["delivery-lock"] });
    const reviewLock = createStrategyReviewLock({ lockDir: flags["review-lock"] });
    const runnerAdapter = buildRunnerAdapter(flags);
    const reviewerAdapter = buildReviewerAdapter(flags);
    const transportAdapter = createMockBridgeTransportAdapter();

    console.log("Automated Operations Bridge — Run");
    console.log();
    console.log(`  Work Order:        ${workOrderId}`);
    console.log(`  Runner:            ${runnerAdapter.name}${flags["live-runner"] ? "  (LIVE — real Claude Code execution)" : "  (mock — no Claude Code execution)"}`);
    console.log(`  Reviewer:          ${reviewerAdapter.name}${flags["live-review"] ? "  (LIVE — real OpenAI request)" : "  (mock — no network)"}`);
    console.log(`  Repository:        ${executionPolicy.repositoryPath}`);
    console.log(`  Branch:            ${executionPolicy.permittedBranch}`);
    console.log();

    const deliveryOfficeService = createAutomatedDeliveryOfficeService({
      workOrderStore,
      deliveryReportStore,
      transportStore,
      transportAdapter,
      runnerAdapter,
      lock: deliveryLock,
      executionPolicy,
      deliveryReportDropDir: flags.drop,
    });

    const strategyReviewService = createAutomatedStrategyReviewService({
      workOrderStore,
      deliveryReportStore,
      strategyReviewStore,
      transportStore,
      reviewerAdapter,
      lock: reviewLock,
      policy: strategyReviewPolicy,
      reviewExportDir: flags.export,
    });

    const service = createOperationsBridgeService({ deliveryOfficeService, strategyReviewService });

    const result = await service.runOperationsBridge({
      workOrderId,
      allowNewerStartingCommit: Boolean(flags["allow-newer-commit"]),
    });

    console.log("Run complete");
    console.log(`  delivery_report_id:         ${result.deliveryReportId}`);
    console.log(`  delivery_status:            ${result.deliveryStatus}`);
    console.log(`  delivery_commit:            ${result.deliveryCommit}`);
    console.log(`  delivery_transport_record:  ${result.deliveryTransportRecordId}`);
    console.log(`  strategy_review_id:         ${result.strategyReviewId}`);
    console.log(`  decision:                   ${result.decision}`);
    console.log(`  review_transport_record:    ${result.reviewTransportRecordId}`);
  } else if (subcommand === "status") {
    const [workOrderId, workOrderStoreDirectory, deliveryReportStoreDirectory, strategyReviewStoreDirectory] = rest;
    if (!workOrderId || !workOrderStoreDirectory || !deliveryReportStoreDirectory || !strategyReviewStoreDirectory || !flags["delivery-lock"] || !flags["review-lock"]) {
      usageAndExit();
    }

    const { workOrderStore, deliveryReportStore, strategyReviewStore } = buildStores(
      workOrderStoreDirectory,
      deliveryReportStoreDirectory,
      strategyReviewStoreDirectory,
      null
    );
    const deliveryLock = createDeliveryExecutionLock({ lockDir: flags["delivery-lock"] });
    const reviewLock = createStrategyReviewLock({ lockDir: flags["review-lock"] });

    // Status is a pure read across the same four stores/locks — deliberately
    // NOT assembled through createOperationsBridgeService() (which requires
    // a full transport/runner/reviewer/policy wiring meant only for run())
    // — mirrors delivery-office-runner.mjs's own and strategy-review-agent
    // .mjs's own `status` subcommand precedent of reading directly.
    const status = getOperationsBridgeStatus({ workOrderId, workOrderStore, deliveryReportStore, strategyReviewStore, deliveryLock, reviewLock });

    console.log("Automated Operations Bridge — Status");
    console.log();
    console.log(`  work_order_id:      ${status.workOrder.work_order_id}`);
    console.log(`  status:             ${status.workOrder.status}`);
    console.log(`  delivery lock:      ${status.deliveryLock ? `held (acquired_at=${status.deliveryLock.acquiredAt}, stale=${status.deliveryLock.stale})` : "not held"}`);
    console.log(`  delivery_reports:   ${status.deliveryReports.length}`);
    for (const { deliveryReport, reviews, reviewLock: reviewLockInfo } of status.deliveryReports) {
      console.log(`    - [${deliveryReport.delivery_report_id}] status=${deliveryReport.status} commit=${deliveryReport.commit}`);
      console.log(`      reviews: ${reviews.length}${reviewLockInfo ? `  (review lock held, acquired_at=${reviewLockInfo.acquiredAt}, stale=${reviewLockInfo.stale})` : ""}`);
      for (const review of reviews) {
        console.log(`        - [${review.strategy_review_id}] decision=${review.decision} at=${review.reviewed_at}`);
      }
    }
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

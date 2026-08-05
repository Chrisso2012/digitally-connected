// DC-003-I029.3 — CLI for the Automated Strategy Review Agent. Default is
// ALWAYS the mock adapter — real OpenAI review requires the unmistakable
// `--live-review` flag, reviews exactly one Delivery Report, performs no
// automatic retry and no second review, per this milestone's own §18.
//
// Usage:
//   node tests/validation/strategy-review-agent.mjs inspect [--repo=<repositoryPath>] [--branch=<name>]
//   node tests/validation/strategy-review-agent.mjs review <workOrderId> <deliveryReportId> <workOrderStoreDirectory> <deliveryReportStoreDirectory> <strategyReviewStoreDirectory> <bridgeStoreDirectory> <repositoryPath>
//       --lock=<lockDirectory> --export=<reviewExportDir>
//       [--branch=<name>] [--live-review] [--rerun-tests] [--rerun-fixtures] [--allow-delivery-branch-differ]
//   node tests/validation/strategy-review-agent.mjs get <strategyReviewId> <strategyReviewStoreDirectory>
//   node tests/validation/strategy-review-agent.mjs work <workOrderId> <strategyReviewStoreDirectory>
//   node tests/validation/strategy-review-agent.mjs status <deliveryReportId> <strategyReviewStoreDirectory> --lock=<lockDirectory>
//
//   or: npm run strategy-review -- <subcommand> ...

import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import {
  InvalidEngineeringWorkOrderStoreAdapterError,
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
  EngineeringStrategyReviewNotFoundError,
  CorruptedEngineeringStrategyReviewError,
  EngineeringStrategyReviewPersistenceError,
  DuplicateDeliveryReportReviewError,
} from "../../src/engineering-strategy-review-errors.mjs";
import { createLocalJsonBridgeTransportStoreAdapter } from "../../src/local-json-bridge-transport-store-adapter.mjs";
import { createBridgeTransportStore } from "../../src/bridge-transport-store.mjs";
import { InvalidBridgeTransportStoreAdapterError, CorruptedBridgeTransportRecordError, BridgeTransportPersistenceError } from "../../src/bridge-transport-errors.mjs";
import { createStrategyReviewLock } from "../../src/strategy-review-lock.mjs";
import { createStrategyReviewPolicy } from "../../src/strategy-review-policy.mjs";
import { createStrategyReviewMockAdapter } from "../../src/strategy-review-mock-adapter.mjs";
import { createOpenAiStrategyReviewAdapter } from "../../src/openai-strategy-review-adapter.mjs";
import { loadStrategyReviewConfig, describeAuthenticationAvailability } from "../../src/strategy-review-config.mjs";
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

const KNOWN_ERRORS = [
  InvalidEngineeringWorkOrderStoreAdapterError,
  EngineeringWorkOrderNotFoundError,
  CorruptedEngineeringWorkOrderError,
  EngineeringWorkOrderPersistenceError,
  InvalidEngineeringDeliveryReportStoreAdapterError,
  EngineeringDeliveryReportNotFoundError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
  InvalidEngineeringStrategyReviewStoreAdapterError,
  EngineeringStrategyReviewNotFoundError,
  CorruptedEngineeringStrategyReviewError,
  EngineeringStrategyReviewPersistenceError,
  DuplicateDeliveryReportReviewError,
  InvalidBridgeTransportStoreAdapterError,
  CorruptedBridgeTransportRecordError,
  BridgeTransportPersistenceError,
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
];

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/strategy-review-agent.mjs inspect [--repo=<repositoryPath>] [--branch=<name>]");
  console.error(
    "  node tests/validation/strategy-review-agent.mjs review <workOrderId> <deliveryReportId> <workOrderStoreDirectory> <deliveryReportStoreDirectory> <strategyReviewStoreDirectory> <bridgeStoreDirectory> <repositoryPath> --lock=<lockDirectory> --export=<reviewExportDir> [--branch=<name>] [--live-review] [--rerun-tests] [--rerun-fixtures] [--allow-delivery-branch-differ]"
  );
  console.error("  node tests/validation/strategy-review-agent.mjs get <strategyReviewId> <strategyReviewStoreDirectory>");
  console.error("  node tests/validation/strategy-review-agent.mjs work <workOrderId> <strategyReviewStoreDirectory>");
  console.error("  node tests/validation/strategy-review-agent.mjs status <deliveryReportId> <strategyReviewStoreDirectory> --lock=<lockDirectory>");
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

function buildPolicy(flags) {
  if (!flags.repo) {
    console.error("FAIL  --repo=<repositoryPath> is required");
    process.exit(1);
  }
  return createStrategyReviewPolicy({
    repositoryPath: flags.repo,
    permittedBranch: flags.branch ?? "main",
    allowDeliveryBranchDifferFromMain: Boolean(flags["allow-delivery-branch-differ"]),
    rerunTests: Boolean(flags["rerun-tests"]),
    rerunFixtures: Boolean(flags["rerun-fixtures"]),
  });
}

function buildReviewerAdapter(flags) {
  if (!flags["live-review"]) return createStrategyReviewMockAdapter();
  const config = loadStrategyReviewConfig(process.env);
  return createOpenAiStrategyReviewAdapter(config);
}

function printInspect(flags) {
  const config = loadStrategyReviewConfig(process.env);
  const auth = describeAuthenticationAvailability(process.env);
  const policy = flags.repo ? buildPolicy(flags) : null;

  console.log("Automated Strategy Review Agent — Inspect");
  console.log();
  console.log(`  Selected reviewer (default):  mock-strategy-review-adapter`);
  console.log(`  Live reviewer model:          ${config.model}`);
  console.log(`  Live reviewer base URL:       ${config.baseUrl}`);
  console.log(`  Authentication mechanism:     ${auth.mechanism} (available=${auth.available})`);
  console.log(`  Max OpenAI requests per review: 1 (fixed, not configurable)`);
  if (policy) {
    console.log(`  Repository path:              ${policy.repositoryPath}`);
    console.log(`  Permitted branch:             ${policy.permittedBranch}`);
    console.log(`  Rerun tests/fixtures:         ${policy.rerunTests}/${policy.rerunFixtures}`);
    console.log(`  Max evidence summary length:  ${policy.maxEvidenceSummaryLength}`);
    console.log(`  Max review duration (ms):     ${policy.maxReviewDurationMs}`);
    console.log(`  Max output tokens:            ${policy.maxOutputTokens}`);
    console.log(`  Max input chars:              ${policy.maxInputChars}`);
    console.log(`  Allow routine approval:       ${policy.allowRoutineApproval}`);
  } else {
    console.log("  (pass --repo=<repositoryPath> to also see the resolved Review Policy)");
  }
  console.log();
  console.log("  No OpenAI invocation occurs as part of this command.");
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

function printReview(strategyReviewId, decision) {
  console.log("Review complete");
  console.log(`  strategy_review_id: ${strategyReviewId}`);
  console.log(`  decision:           ${decision}`);
}

const [subcommand, ...rawRest] = process.argv.slice(2);
if (!subcommand) usageAndExit();
const { flags, rest } = extractFlags(rawRest);

try {
  if (subcommand === "inspect") {
    printInspect(flags);
  } else if (subcommand === "review") {
    const [workOrderId, deliveryReportId, workOrderStoreDirectory, deliveryReportStoreDirectory, strategyReviewStoreDirectory, bridgeTransportStoreDirectory, repositoryPathPositional] = rest;
    if (!workOrderId || !deliveryReportId || !workOrderStoreDirectory || !deliveryReportStoreDirectory || !strategyReviewStoreDirectory || !bridgeTransportStoreDirectory || !repositoryPathPositional || !flags.lock || !flags.export) {
      usageAndExit();
    }
    flags.repo = flags.repo ?? repositoryPathPositional;

    const policy = buildPolicy(flags);
    const { workOrderStore, deliveryReportStore, strategyReviewStore, transportStore } = buildStores(
      workOrderStoreDirectory,
      deliveryReportStoreDirectory,
      strategyReviewStoreDirectory,
      bridgeTransportStoreDirectory
    );
    const lock = createStrategyReviewLock({ lockDir: flags.lock });
    const reviewerAdapter = buildReviewerAdapter(flags);

    console.log("Automated Strategy Review Agent — Review");
    console.log();
    console.log(`  Work Order:        ${workOrderId}`);
    console.log(`  Delivery Report:   ${deliveryReportId}`);
    console.log(`  Reviewer:          ${reviewerAdapter.name}${flags["live-review"] ? "  (LIVE — real OpenAI request)" : "  (mock — no network)"}`);
    console.log(`  Repository:        ${policy.repositoryPath}`);
    console.log(`  Branch:            ${policy.permittedBranch}`);
    console.log();

    const service = createAutomatedStrategyReviewService({
      workOrderStore,
      deliveryReportStore,
      strategyReviewStore,
      transportStore,
      reviewerAdapter,
      lock,
      policy,
      reviewExportDir: flags.export,
    });

    const result = await service.reviewDelivery({ workOrderId, deliveryReportId });
    printReview(result.strategyReviewId, result.decision);
    console.log(`  transport_record_id: ${result.transportRecordId}`);
  } else if (subcommand === "get") {
    const [strategyReviewId, strategyReviewStoreDirectory] = rest;
    if (!strategyReviewId || !strategyReviewStoreDirectory) usageAndExit();
    const store = createEngineeringStrategyReviewStore({ adapter: createLocalJsonEngineeringStrategyReviewStoreAdapter({ storageDir: strategyReviewStoreDirectory }) });
    const review = store.get(strategyReviewId);
    console.log("Strategy Review found");
    console.log(`  strategy_review_id: ${review.strategy_review_id}`);
    console.log(`  work_order_id:      ${review.work_order_id}`);
    console.log(`  delivery_report_id: ${review.delivery_report_id}`);
    console.log(`  decision:           ${review.decision}`);
    console.log(`  reviewed_at:        ${review.reviewed_at}`);
    console.log(`  reviewer:           ${review.reviewer.type} (${review.reviewer.provider})`);
    console.log(`  summary:            ${review.summary}`);
    for (const c of review.criteria) {
      console.log(`    [${c.criterion_index}] ${c.result.padEnd(20)} ${c.criterion}`);
    }
  } else if (subcommand === "work") {
    const [workOrderId, strategyReviewStoreDirectory] = rest;
    if (!workOrderId || !strategyReviewStoreDirectory) usageAndExit();
    const store = createEngineeringStrategyReviewStore({ adapter: createLocalJsonEngineeringStrategyReviewStoreAdapter({ storageDir: strategyReviewStoreDirectory }) });
    const reviews = store.findByWorkOrder(workOrderId);
    console.log(`${reviews.length} strategy review(s) for ${workOrderId}`);
    for (const r of reviews) {
      console.log(`  [${r.strategy_review_id}] decision=${r.decision.padEnd(22)} delivery_report=${r.delivery_report_id} at=${r.reviewed_at}`);
    }
  } else if (subcommand === "status") {
    const [deliveryReportId, strategyReviewStoreDirectory] = rest;
    if (!deliveryReportId || !strategyReviewStoreDirectory || !flags.lock) usageAndExit();
    const store = createEngineeringStrategyReviewStore({ adapter: createLocalJsonEngineeringStrategyReviewStoreAdapter({ storageDir: strategyReviewStoreDirectory }) });
    const lock = createStrategyReviewLock({ lockDir: flags.lock });

    const reviews = store.findByDeliveryReport(deliveryReportId);
    const lockInfo = lock.inspect(deliveryReportId);

    console.log("Automated Strategy Review Agent — Status");
    console.log();
    console.log(`  delivery_report_id: ${deliveryReportId}`);
    console.log(`  reviews:            ${reviews.length}`);
    for (const r of reviews) {
      console.log(`    - [${r.strategy_review_id}] decision=${r.decision} at=${r.reviewed_at}`);
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

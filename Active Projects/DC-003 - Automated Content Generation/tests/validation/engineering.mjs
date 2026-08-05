// DC-003-I029 — CLI for Engineering Work Management: structured Strategy
// Office <-> Delivery Office engineering objects, replacing informal
// markdown briefs/delivery summaries. No networking anywhere in this
// file — every subcommand only ever reads/writes local JSON stores.
//
// `report create` deliberately does not exist — mirrors
// publisher-results.mjs's (I025) own precedent: a Delivery Report is
// evidence of completed work, recorded by whoever performs the delivery
// (a real engineering session) via the domain layer/module API directly,
// not typed by hand through a CLI the way a Work Order's own intent is.
//
// Usage:
//   node tests/validation/engineering.mjs work list <workOrderStoreDirectory>
//   node tests/validation/engineering.mjs work get <workOrderId> <workOrderStoreDirectory>
//   node tests/validation/engineering.mjs work create <milestone> <draft|ready> <workOrderStoreDirectory>
//       --title=<t> --objective=<o> --review-criteria=<c1|c2|...>
//       [--priority=low|medium|high] [--constraints=<c1|c2|...>]
//       [--commit=<hash>] [--depends-on=<wo_a,wo_b>] [--notes=<n>]
//       [--approved-at=<iso>] [--repository-commit=<hash>]
//   node tests/validation/engineering.mjs report list <deliveryReportStoreDirectory>
//   node tests/validation/engineering.mjs report get <deliveryReportId> <deliveryReportStoreDirectory>
//   node tests/validation/engineering.mjs status <workOrderStoreDirectory> <deliveryReportStoreDirectory>
//
//   or: npm run engineering -- <subcommand> ...

import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";
import {
  InvalidEngineeringWorkOrderStoreAdapterError,
  InvalidEngineeringWorkOrderIdentifierError,
  EngineeringWorkOrderAlreadyExistsError,
  EngineeringWorkOrderNotFoundError,
  CorruptedEngineeringWorkOrderError,
  EngineeringWorkOrderPersistenceError,
  InvalidEngineeringWorkOrderInputError,
  EngineeringWorkOrderValidationError,
} from "../../src/engineering-work-order-errors.mjs";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import {
  InvalidEngineeringDeliveryReportStoreAdapterError,
  InvalidEngineeringDeliveryReportIdentifierError,
  EngineeringDeliveryReportNotFoundError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
} from "../../src/engineering-delivery-report-errors.mjs";
import { createEngineeringWorkManagementService } from "../../src/engineering-work-management-service.mjs";
import { InvalidEngineeringWorkManagementDependenciesError } from "../../src/engineering-work-management-errors.mjs";

const KNOWN_ERRORS = [
  InvalidEngineeringWorkOrderStoreAdapterError,
  InvalidEngineeringWorkOrderIdentifierError,
  EngineeringWorkOrderAlreadyExistsError,
  EngineeringWorkOrderNotFoundError,
  CorruptedEngineeringWorkOrderError,
  EngineeringWorkOrderPersistenceError,
  InvalidEngineeringWorkOrderInputError,
  EngineeringWorkOrderValidationError,
  InvalidEngineeringDeliveryReportStoreAdapterError,
  InvalidEngineeringDeliveryReportIdentifierError,
  EngineeringDeliveryReportNotFoundError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
  InvalidEngineeringWorkManagementDependenciesError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/engineering.mjs work list <workOrderStoreDirectory>");
  console.error("  node tests/validation/engineering.mjs work get <workOrderId> <workOrderStoreDirectory>");
  console.error(
    "  node tests/validation/engineering.mjs work create <milestone> <draft|ready> <workOrderStoreDirectory> --title=<t> --objective=<o> --review-criteria=<c1|c2|...> [--priority=low|medium|high] [--constraints=<c1|c2|...>] [--commit=<hash>] [--depends-on=<wo_a,wo_b>] [--notes=<n>] [--approved-at=<iso>]"
  );
  console.error("  node tests/validation/engineering.mjs report list <deliveryReportStoreDirectory>");
  console.error("  node tests/validation/engineering.mjs report get <deliveryReportId> <deliveryReportStoreDirectory>");
  console.error("  node tests/validation/engineering.mjs status <workOrderStoreDirectory> <deliveryReportStoreDirectory>");
  process.exit(1);
}

function extractFlags(args) {
  const flags = {};
  const rest = [];
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) {
      flags[match[1]] = match[2];
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

function splitList(value) {
  if (value === undefined || value.trim() === "") return [];
  return value.split("|").map((s) => s.trim());
}

function buildWorkOrderStore(storeDirectory) {
  return createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: storeDirectory }) });
}

function buildDeliveryReportStore(storeDirectory) {
  return createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: storeDirectory }) });
}

function printWorkOrderSummaryLine(summary) {
  console.log(
    `  [${summary.work_order_id}] ${summary.milestone.padEnd(16)} status=${summary.status.padEnd(11)} priority=${summary.priority.padEnd(6)} ` +
      `"${summary.title}"${summary.derived_state ? ` derived=${summary.derived_state}` : ""}`
  );
}

function printFullWorkOrder(workOrder) {
  console.log(`  work_order_id:     ${workOrder.work_order_id}`);
  console.log(`  milestone:         ${workOrder.milestone}`);
  console.log(`  title:             ${workOrder.title}`);
  console.log(`  objective:         ${workOrder.objective}`);
  console.log(`  status:            ${workOrder.status}`);
  console.log(`  priority:          ${workOrder.priority}`);
  console.log(`  repository_commit: ${workOrder.repository_commit}`);
  console.log(`  constraints:       ${JSON.stringify(workOrder.constraints)}`);
  console.log(`  review_criteria:   ${JSON.stringify(workOrder.review_criteria)}`);
  console.log(`  dependencies:      ${JSON.stringify(workOrder.dependencies)}`);
  console.log(`  created_at:        ${workOrder.created_at}`);
  console.log(`  approved_at:       ${workOrder.approved_at}`);
  console.log(`  notes:             ${workOrder.notes}`);
}

function printDeliveryReportSummaryLine(summary) {
  console.log(
    `  [${summary.delivery_report_id}] work_order=${summary.work_order_id} ${summary.milestone.padEnd(16)} status=${summary.status.padEnd(9)} ` +
      `commit=${summary.commit} delivered_at=${summary.delivery_timestamp}`
  );
}

function printFullDeliveryReport(report) {
  console.log(`  delivery_report_id: ${report.delivery_report_id}`);
  console.log(`  work_order_id:      ${report.work_order_id}`);
  console.log(`  milestone:          ${report.milestone}`);
  console.log(`  status:             ${report.status}`);
  console.log(`  commit:             ${report.commit}`);
  console.log(`  push_status:        ${report.push_status}`);
  console.log(`  working_tree:       ${report.working_tree}`);
  console.log(`  tests:              ${report.tests.passed}/${report.tests.total} passed (${report.tests.failed} failed)`);
  console.log(`  fixtures:           ${report.fixtures.passed}/${report.fixtures.total} passed (${report.fixtures.failed} failed)`);
  console.log(`  files_created:      ${report.files_created.length}`);
  console.log(`  files_modified:     ${report.files_modified.length}`);
  console.log(`  live_requests:      occurred=${report.live_requests.occurred}`);
  console.log(`  follow_up_required: ${JSON.stringify(report.follow_up_required)}`);
  console.log(`  delivery_timestamp: ${report.delivery_timestamp}`);
}

const [subcommand, action, ...rest] = process.argv.slice(2);
if (!subcommand) usageAndExit();

try {
  if (subcommand === "work" && action === "list") {
    const { rest: positional } = extractFlags(rest);
    const [storeDirectory] = positional;
    if (!storeDirectory) usageAndExit();
    const summaries = buildWorkOrderStore(storeDirectory).list();
    console.log(`${summaries.length} work order(s)`);
    for (const summary of summaries) printWorkOrderSummaryLine(summary);
  } else if (subcommand === "work" && action === "get") {
    const { rest: positional } = extractFlags(rest);
    const [workOrderId, storeDirectory] = positional;
    if (!workOrderId || !storeDirectory) usageAndExit();
    console.log("Work order found");
    printFullWorkOrder(buildWorkOrderStore(storeDirectory).get(workOrderId));
  } else if (subcommand === "work" && action === "create") {
    const { flags, rest: positional } = extractFlags(rest);
    const [milestone, status, storeDirectory] = positional;
    if (!milestone || !status || !storeDirectory) usageAndExit();
    if (!["draft", "ready"].includes(status)) {
      console.error('FAIL  status must be "draft" or "ready" — the CLI never creates any other status (see README "Status Model")');
      process.exit(1);
    }
    if (!flags.title || !flags.objective || !flags["review-criteria"]) usageAndExit();

    const store = buildWorkOrderStore(storeDirectory);
    const workOrder = createEngineeringWorkOrder({
      milestone,
      title: flags.title,
      objective: flags.objective,
      repositoryCommit: flags["repository-commit"] ?? flags.commit ?? null,
      constraints: splitList(flags.constraints),
      reviewCriteria: splitList(flags["review-criteria"]),
      status,
      approvedAt: status === "ready" ? (flags["approved-at"] ?? new Date().toISOString()) : null,
      priority: flags.priority ?? "medium",
      dependencies: flags["depends-on"] ? flags["depends-on"].split(",").map((s) => s.trim()) : [],
      notes: flags.notes ?? null,
    });
    const saved = store.save(workOrder);
    console.log("Work order created");
    printFullWorkOrder(saved);
  } else if (subcommand === "report" && action === "list") {
    const { rest: positional } = extractFlags(rest);
    const [storeDirectory] = positional;
    if (!storeDirectory) usageAndExit();
    const summaries = buildDeliveryReportStore(storeDirectory).list();
    console.log(`${summaries.length} delivery report(s)`);
    for (const summary of summaries) printDeliveryReportSummaryLine(summary);
  } else if (subcommand === "report" && action === "get") {
    const { rest: positional } = extractFlags(rest);
    const [deliveryReportId, storeDirectory] = positional;
    if (!deliveryReportId || !storeDirectory) usageAndExit();
    console.log("Delivery report found");
    printFullDeliveryReport(buildDeliveryReportStore(storeDirectory).get(deliveryReportId));
  } else if (subcommand === "status") {
    const { rest: positional } = extractFlags([action, ...rest].filter(Boolean));
    const [workOrderStoreDirectory, deliveryReportStoreDirectory] = positional;
    if (!workOrderStoreDirectory || !deliveryReportStoreDirectory) usageAndExit();

    const service = createEngineeringWorkManagementService({
      workOrderStore: buildWorkOrderStore(workOrderStoreDirectory),
      deliveryReportStore: buildDeliveryReportStore(deliveryReportStoreDirectory),
    });
    const status = service.getStatus();
    console.log("Engineering Status");
    console.log(`  current_milestone:         ${status.current_milestone}`);
    console.log(`  last_completed_milestone:  ${status.last_completed_milestone}`);
    console.log(`  outstanding_work_orders:   ${status.outstanding_work_orders}`);
    console.log(`  awaiting_review:           ${status.awaiting_review}`);
    console.log(
      `  repository_status:         ${status.repository_status ? JSON.stringify(status.repository_status) : "unknown (no delivery reports yet)"}`
    );
    console.log(`  latest_delivery_report:    ${status.latest_delivery_report?.delivery_report_id ?? "(none)"}`);
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

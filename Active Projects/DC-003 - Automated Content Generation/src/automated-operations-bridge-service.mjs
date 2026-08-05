// DC-003-I029.4 — Automated Operations Bridge Service: orchestrates I029.2
// (Automated Delivery Office) and I029.3 (Automated Strategy Review) so one
// call runs the whole chain —
//
//   Engineering Work Order
//     -> Delivery Office Runner (I029.2, unmodified)
//     -> Engineering Delivery Report
//     -> Strategy Review (I029.3, unmodified)
//     -> Strategy Review decision
//
// per the DC-003-I029.4 brief: "orchestration only... compose existing
// modules." This file contains no eligibility checks, no lock logic, no
// git evidence collection, no review-gate logic, and no schema/store code
// of its own — every one of those already exists in I029.2/I029.3 and is
// called here exactly as their own CLIs already call it. Concretely: this
// service takes two ALREADY-CONSTRUCTED service instances as dependencies
// (not their individual stores/adapters/locks/policies) — the orchestrator
// never re-wires a Bridge Transport adapter, a runner adapter, a reviewer
// adapter, an Execution Policy, a Strategy Review Policy, or a lock itself;
// the caller (tests/validation/operations-bridge.mjs) builds
// createAutomatedDeliveryOfficeService(...) and
// createAutomatedStrategyReviewService(...) the exact same way their own
// standalone CLIs already do, and hands the two finished services to this
// module. That is the entire "composition, not duplication" contract this
// milestone's brief asks for.
//
// Investigation finding worth recording here (see README "End-to-End
// Operations Bridge (DC-003-I029.4)"): "Update Control Centre" from the
// brief's own desired end state requires NO code change. The Production
// Control Centre (I024, extended by I029/I029.1/I029.2/I029.3) is a
// read-only query layer that re-reads the Work Order/Delivery Report/
// Strategy Review/Bridge Transport stores live on every invocation — it
// never has a "record this event" entry point to call. Once this service
// has run, the exact same `npm run control-centre -- dashboard
// --engineering-work-orders=... --engineering-delivery-reports=...
// --bridge=...` command an operator was already running reflects the new
// Delivery Report and Strategy Review automatically, with zero new wiring.

import { InvalidAutomatedOperationsBridgeDependenciesError } from "./operations-bridge-errors.mjs";

function assertDependencies({ deliveryOfficeService, strategyReviewService }) {
  if (!deliveryOfficeService || typeof deliveryOfficeService.executeApprovedWorkOrder !== "function") {
    throw new InvalidAutomatedOperationsBridgeDependenciesError(
      "fields.deliveryOfficeService must be an Automated Delivery Office Service — see createAutomatedDeliveryOfficeService() (DC-003-I029.2)"
    );
  }
  if (!strategyReviewService || typeof strategyReviewService.reviewDelivery !== "function") {
    throw new InvalidAutomatedOperationsBridgeDependenciesError(
      "fields.strategyReviewService must be an Automated Strategy Review Service — see createAutomatedStrategyReviewService() (DC-003-I029.3)"
    );
  }
}

/**
 * Builds an Automated Operations Bridge Service.
 *
 * fields.deliveryOfficeService — required, an already-constructed
 *   Automated Delivery Office Service (I029.2) — see
 *   createAutomatedDeliveryOfficeService().
 * fields.strategyReviewService — required, an already-constructed
 *   Automated Strategy Review Service (I029.3) — see
 *   createAutomatedStrategyReviewService().
 *
 * Returns { runOperationsBridge }. See also this file's standalone
 * getOperationsBridgeStatus() export for the read-only status path.
 */
export function createOperationsBridgeService(fields = {}) {
  assertDependencies(fields);
  const { deliveryOfficeService, strategyReviewService } = fields;

  /**
   * Runs the full chain for one Engineering Work Order: delivery, then
   * review of whatever Delivery Report that delivery produced — including
   * a "failed"/"partial" delivery, since evaluating exactly that evidence
   * is the Strategy Review's own purpose (see I029.3's own
   * strategy-review-authority-gates.mjs; a bad delivery routes toward
   * `ceo_decision_required`/`correction_required`, it is never silently
   * skipped). Neither stage's own errors are caught or wrapped here —
   * WorkOrderNotEligibleError, DuplicateDeliveryError,
   * ExecutionLockAlreadyHeldError, DeliveryReportNotEligibleForReviewError,
   * etc. all propagate as themselves, exactly as they would from either
   * standalone CLI.
   */
  async function runOperationsBridge({ workOrderId, allowNewerStartingCommit = false }) {
    const deliveryResult = await deliveryOfficeService.executeApprovedWorkOrder({ workOrderId, allowNewerStartingCommit });

    const reviewResult = await strategyReviewService.reviewDelivery({
      workOrderId,
      deliveryReportId: deliveryResult.deliveryReportId,
    });

    return {
      workOrderId,
      deliveryReportId: deliveryResult.deliveryReportId,
      deliveryStatus: deliveryResult.status,
      deliveryCommit: deliveryResult.commit,
      deliveryTransportRecordId: deliveryResult.transportRecordId,
      strategyReviewId: reviewResult.strategyReviewId,
      decision: reviewResult.decision,
      reviewTransportRecordId: reviewResult.transportRecordId,
    };
  }

  return { runOperationsBridge };
}

// Read-only. Combines a Work Order's Delivery Reports (I029.2) with each
// Delivery Report's own Strategy Reviews (I029.3) — for the CLI's `status`
// subcommand. Deliberately a plain function over the four already-existing
// stores/locks directly, NOT a method requiring a fully-wired
// createOperationsBridgeService() (which needs a runner/reviewer/policy
// only run() needs) — mirrors delivery-office-runner.mjs's own and
// strategy-review-agent.mjs's own `status` subcommand precedent of reading
// directly rather than constructing a service just to read.
export function getOperationsBridgeStatus({ workOrderId, workOrderStore, deliveryReportStore, strategyReviewStore, deliveryLock, reviewLock }) {
  const workOrder = workOrderStore.get(workOrderId);
  const deliveryReports = deliveryReportStore.findByWorkOrder(workOrderId).map((deliveryReport) => ({
    deliveryReport,
    reviews: strategyReviewStore.findByDeliveryReport(deliveryReport.delivery_report_id),
    reviewLock: reviewLock.inspect(deliveryReport.delivery_report_id),
  }));
  return { workOrder, deliveryLock: deliveryLock.inspect(workOrderId), deliveryReports };
}

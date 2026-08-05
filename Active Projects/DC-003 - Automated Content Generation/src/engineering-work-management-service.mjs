// DC-003-I029 — Engineering Work Management Service: the only module that
// joins Engineering Work Orders to their Engineering Delivery Reports and
// derives a human-readable state. Read-only, no persistence of its own,
// no business logic beyond repository evidence already sitting in the two
// I029 stores — no field on either stored object is ever inferred or
// guessed.
//
// Derived-state model (repository-evidence only, never a stored mutation
// — this milestone's own brief explicitly forbids inventing workflow
// transitions, see engineering-work-order.mjs's own header comment):
//   - No Delivery Report exists yet for a Work Order: the derived label is
//     the Work Order's own `status`, verbatim (Draft/Ready/In Progress/
//     Completed/Approved/Archived). An unrecognized status value (should
//     never happen given schema validation, but never trusted blindly)
//     degrades to "Future Extension" rather than throwing.
//   - At least one Delivery Report exists AND the Work Order's own status
//     is not yet "approved"/"archived": the derived label is "Awaiting
//     Review" — delivered, but the Strategy Office has not yet recorded a
//     final decision. This is the one genuinely composite label this
//     service computes; every other label is a direct pass-through of
//     already-stored evidence.
//   - At least one Delivery Report exists AND the Work Order's own status
//     IS "approved"/"archived": the Strategy Office's own recorded
//     decision wins — the derived label passes that status through
//     verbatim, not "Awaiting Review".
//
// DC-003-I029.3 — additive: fields.strategyReviewStore is OPTIONAL. When
// supplied, "Awaiting Review" is refined further using the most recent
// Engineering Strategy Review's own `decision` for that Work Order's most
// recent Delivery Report (Approved by Strategy Review / Correction
// Required / CEO Decision Required / Rejected) — still repository
// evidence only, still no stored mutation. When omitted, every existing
// behaviour (including "Awaiting Review" itself) is completely unchanged
// — this is why every pre-I029.3 caller of this service keeps working
// without modification.

import { InvalidEngineeringWorkManagementDependenciesError } from "./engineering-work-management-errors.mjs";

const STATUS_LABELS = {
  draft: "Draft",
  ready: "Ready",
  in_progress: "In Progress",
  completed: "Completed",
  approved: "Approved",
  archived: "Archived",
};

const REVIEW_DECISION_LABELS = {
  approved: "Approved by Strategy Review",
  correction_required: "Correction Required",
  ceo_decision_required: "CEO Decision Required",
  rejected: "Rejected",
};

function assertDependencies({ workOrderStore, deliveryReportStore, strategyReviewStore }) {
  if (!workOrderStore || typeof workOrderStore.list !== "function" || typeof workOrderStore.get !== "function") {
    throw new InvalidEngineeringWorkManagementDependenciesError(
      "fields.workOrderStore must be an Engineering Work Order Store — see createEngineeringWorkOrderStore()"
    );
  }
  if (
    !deliveryReportStore ||
    typeof deliveryReportStore.list !== "function" ||
    typeof deliveryReportStore.get !== "function" ||
    typeof deliveryReportStore.findByWorkOrder !== "function"
  ) {
    throw new InvalidEngineeringWorkManagementDependenciesError(
      "fields.deliveryReportStore must be an Engineering Delivery Report Store — see createEngineeringDeliveryReportStore()"
    );
  }
  if (
    strategyReviewStore !== null &&
    strategyReviewStore !== undefined &&
    (typeof strategyReviewStore.list !== "function" || typeof strategyReviewStore.findByWorkOrder !== "function")
  ) {
    throw new InvalidEngineeringWorkManagementDependenciesError(
      "fields.strategyReviewStore, when supplied, must be an Engineering Strategy Review Store — see createEngineeringStrategyReviewStore()"
    );
  }
}

function deriveState(workOrderSummary, deliveryReports, latestReview) {
  if (deliveryReports.length === 0) {
    return STATUS_LABELS[workOrderSummary.status] ?? "Future Extension";
  }
  if (workOrderSummary.status === "approved" || workOrderSummary.status === "archived") {
    return STATUS_LABELS[workOrderSummary.status];
  }
  if (latestReview) {
    return REVIEW_DECISION_LABELS[latestReview.decision] ?? "Awaiting Review";
  }
  return "Awaiting Review";
}

/**
 * Builds an Engineering Work Management Service.
 *
 * fields.workOrderStore — required, an Engineering Work Order Store.
 * fields.deliveryReportStore — required, an Engineering Delivery Report
 *   Store.
 * fields.strategyReviewStore — optional (DC-003-I029.3), an Engineering
 *   Strategy Review Store. When omitted, review-aware derived states and
 *   `getStatus()`'s own review counts/`latest_strategy_review` are simply
 *   never computed — see this module's own header comment.
 *
 * Returns { listWorkOrders, getWorkOrder, listDeliveryReports,
 * getDeliveryReport, getStatus }.
 */
export function createEngineeringWorkManagementService(fields = {}) {
  const { workOrderStore, deliveryReportStore, strategyReviewStore = null } = fields;
  assertDependencies({ workOrderStore, deliveryReportStore, strategyReviewStore });

  function latestReviewForWorkOrder(workOrderId) {
    if (!strategyReviewStore) return null;
    const reviews = strategyReviewStore.findByWorkOrder(workOrderId);
    return reviews.length > 0 ? reviews[reviews.length - 1] : null;
  }

  /**
   * Returns every Work Order summary, each joined with its own delivery
   * report count and derived state — ordered chronologically (the store's
   * own list() ordering, oldest first).
   */
  function listWorkOrders() {
    return workOrderStore.list().map((summary) => {
      const deliveryReports = deliveryReportStore.findByWorkOrder(summary.work_order_id);
      return {
        ...summary,
        derived_state: deriveState(summary, deliveryReports, latestReviewForWorkOrder(summary.work_order_id)),
        delivery_report_count: deliveryReports.length,
      };
    });
  }

  /**
   * Returns one Work Order's full record plus every Delivery Report filed
   * against it (oldest to newest) and its own derived state. Propagates
   * whatever error workOrderStore.get() itself throws for an unknown ID.
   */
  function getWorkOrder(workOrderId) {
    const workOrder = workOrderStore.get(workOrderId);
    const deliveryReports = deliveryReportStore.findByWorkOrder(workOrderId);
    const latestReview = latestReviewForWorkOrder(workOrderId);
    return {
      work_order: workOrder,
      delivery_reports: deliveryReports,
      derived_state: deriveState(workOrder, deliveryReports, latestReview),
      latest_strategy_review: latestReview,
    };
  }

  function listDeliveryReports() {
    return deliveryReportStore.list();
  }

  function getDeliveryReport(deliveryReportId) {
    return deliveryReportStore.get(deliveryReportId);
  }

  /**
   * Assembles a system-wide summary purely from repository evidence:
   * current milestone (the most recently created Work Order's own
   * milestone), last completed milestone (the most recent Delivery Report
   * with status "completed"), outstanding work (Ready/In Progress/
   * Awaiting Review counts), and repository status (the latest Delivery
   * Report's own commit/push_status/working_tree — never a live `git`
   * call; this milestone has no filesystem/network access of its own).
   */
  function getStatus() {
    const workOrders = listWorkOrders();
    const deliveryReportSummaries = deliveryReportStore.list();

    const currentMilestone = workOrders.length > 0 ? workOrders[workOrders.length - 1].milestone : null;

    const completedReports = deliveryReportSummaries.filter((r) => r.status === "completed");
    const lastCompleted = completedReports.length > 0 ? completedReports[completedReports.length - 1] : null;

    const outstanding = workOrders.filter((w) => ["Ready", "In Progress"].includes(w.derived_state));
    const awaitingReview = workOrders.filter((w) => w.derived_state === "Awaiting Review");
    const approvedByReview = workOrders.filter((w) => w.derived_state === "Approved by Strategy Review");
    const correctionRequired = workOrders.filter((w) => w.derived_state === "Correction Required");
    const ceoDecisionRequired = workOrders.filter((w) => w.derived_state === "CEO Decision Required");
    const rejectedByReview = workOrders.filter((w) => w.derived_state === "Rejected");

    const latestReportSummary = deliveryReportSummaries.length > 0 ? deliveryReportSummaries[deliveryReportSummaries.length - 1] : null;
    const latestReport = latestReportSummary ? deliveryReportStore.get(latestReportSummary.delivery_report_id) : null;

    // strategyReviewStore.list() is already chronologically sorted
    // (reviewed_at ascending) — its own last element is the single most
    // recent review across every Work Order.
    const strategyReviewSummaries = strategyReviewStore ? strategyReviewStore.list() : null;
    const latestStrategyReview =
      strategyReviewSummaries && strategyReviewSummaries.length > 0
        ? strategyReviewStore.get(strategyReviewSummaries[strategyReviewSummaries.length - 1].strategy_review_id)
        : null;

    return {
      current_milestone: currentMilestone,
      last_completed_milestone: lastCompleted?.milestone ?? null,
      outstanding_work_orders: outstanding.length,
      // DC-003-I029.3 — additive review-status counts, null when no
      // strategyReviewStore was supplied (never checked, not zero).
      approved_by_review: strategyReviewStore ? approvedByReview.length : null,
      correction_required: strategyReviewStore ? correctionRequired.length : null,
      ceo_decision_required: strategyReviewStore ? ceoDecisionRequired.length : null,
      rejected_by_review: strategyReviewStore ? rejectedByReview.length : null,
      latest_strategy_review: latestStrategyReview,
      awaiting_review: awaitingReview.length,
      repository_status: latestReport
        ? { commit: latestReport.commit, push_status: latestReport.push_status, working_tree: latestReport.working_tree }
        : null,
      latest_delivery_report: latestReport,
    };
  }

  return { listWorkOrders, getWorkOrder, listDeliveryReports, getDeliveryReport, getStatus };
}

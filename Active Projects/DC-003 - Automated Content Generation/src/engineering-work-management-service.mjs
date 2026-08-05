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

import { InvalidEngineeringWorkManagementDependenciesError } from "./engineering-work-management-errors.mjs";

const STATUS_LABELS = {
  draft: "Draft",
  ready: "Ready",
  in_progress: "In Progress",
  completed: "Completed",
  approved: "Approved",
  archived: "Archived",
};

function assertDependencies({ workOrderStore, deliveryReportStore }) {
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
}

function deriveState(workOrderSummary, deliveryReports) {
  if (deliveryReports.length === 0) {
    return STATUS_LABELS[workOrderSummary.status] ?? "Future Extension";
  }
  if (workOrderSummary.status === "approved" || workOrderSummary.status === "archived") {
    return STATUS_LABELS[workOrderSummary.status];
  }
  return "Awaiting Review";
}

/**
 * Builds an Engineering Work Management Service.
 *
 * fields.workOrderStore — required, an Engineering Work Order Store.
 * fields.deliveryReportStore — required, an Engineering Delivery Report
 *   Store.
 *
 * Returns { listWorkOrders, getWorkOrder, listDeliveryReports,
 * getDeliveryReport, getStatus }.
 */
export function createEngineeringWorkManagementService(fields = {}) {
  const { workOrderStore, deliveryReportStore } = fields;
  assertDependencies({ workOrderStore, deliveryReportStore });

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
        derived_state: deriveState(summary, deliveryReports),
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
    return {
      work_order: workOrder,
      delivery_reports: deliveryReports,
      derived_state: deriveState(workOrder, deliveryReports),
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

    const latestReportSummary = deliveryReportSummaries.length > 0 ? deliveryReportSummaries[deliveryReportSummaries.length - 1] : null;
    const latestReport = latestReportSummary ? deliveryReportStore.get(latestReportSummary.delivery_report_id) : null;

    return {
      current_milestone: currentMilestone,
      last_completed_milestone: lastCompleted?.milestone ?? null,
      outstanding_work_orders: outstanding.length,
      awaiting_review: awaitingReview.length,
      repository_status: latestReport
        ? { commit: latestReport.commit, push_status: latestReport.push_status, working_tree: latestReport.working_tree }
        : null,
      latest_delivery_report: latestReport,
    };
  }

  return { listWorkOrders, getWorkOrder, listDeliveryReports, getDeliveryReport, getStatus };
}

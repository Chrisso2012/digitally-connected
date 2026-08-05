// DC-003-I029.3 — Automated Strategy Review Service: the only module that
// reviews one Engineering Delivery Report against the Engineering Work
// Order it answers, through a Strategy Review Agent Adapter (mock by
// default; the real OpenAI adapter only when the caller explicitly
// constructs and supplies one), and records one Engineering Strategy
// Review. Composes I029's own stores unmodified, I029.2's own
// independent-verification discipline (via strategy-review-evidence-collector.mjs,
// which itself reuses repository-git-evidence.mjs unmodified), and
// records the outgoing review through the real Bridge Transport Store —
// see this file's own exportReviewThroughBridgeTransport() for why that
// is NOT routed through bridge-transport-service.mjs's own
// exportWorkOrder()/importDeliveryReport() (both are hardcoded to their
// own specific object types; per Strategy Office's own explicit scoping
// of this milestone's I029.1 changes to bridge-transport-record.schema.json
// and bridge-transport-record.mjs only, this service composes the
// already-generic createBridgeTransportRecord() + transportStore.save()
// directly instead of extending bridge-transport-service.mjs).
//
// The OpenAI model NEVER decides the final outcome alone — every proposal
// passes through strategy-review-authority-gates.mjs both before
// (skipping the adapter call entirely for unambiguous cases, saving a
// request) and after invocation (defense in depth, and the only place a
// "the model proposed approval despite failing evidence" mismatch is
// caught and forced to ceo_decision_required). This service can only
// make an outcome MORE cautious than what the deterministic evidence
// already demands, never less.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createEngineeringStrategyReview } from "./engineering-strategy-review.mjs";
import { createBridgeTransportRecord } from "./bridge-transport-record.mjs";
import { assertValidStrategyReviewAgentAdapter, assertValidReviewProposal } from "./strategy-review-agent-adapter.mjs";
import { collectStrategyReviewEvidence } from "./strategy-review-evidence-collector.mjs";
import { evaluatePreReviewGates, applyPostReviewGates } from "./strategy-review-authority-gates.mjs";
import {
  DeliveryReportNotEligibleForReviewError,
  InvalidAutomatedStrategyReviewDependenciesError,
} from "./strategy-review-errors.mjs";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function assertDependencies({ workOrderStore, deliveryReportStore, strategyReviewStore, transportStore, reviewerAdapter, lock, policy, reviewExportDir }) {
  if (!workOrderStore || typeof workOrderStore.get !== "function") {
    throw new InvalidAutomatedStrategyReviewDependenciesError("fields.workOrderStore must be an Engineering Work Order Store");
  }
  if (!deliveryReportStore || typeof deliveryReportStore.get !== "function") {
    throw new InvalidAutomatedStrategyReviewDependenciesError("fields.deliveryReportStore must be an Engineering Delivery Report Store");
  }
  if (!strategyReviewStore || typeof strategyReviewStore.save !== "function" || typeof strategyReviewStore.findByDeliveryReport !== "function") {
    throw new InvalidAutomatedStrategyReviewDependenciesError("fields.strategyReviewStore must be an Engineering Strategy Review Store");
  }
  if (!transportStore || typeof transportStore.save !== "function" || typeof transportStore.findByObject !== "function") {
    throw new InvalidAutomatedStrategyReviewDependenciesError("fields.transportStore must be a Bridge Transport Store");
  }
  assertValidStrategyReviewAgentAdapter(reviewerAdapter);
  if (!lock || typeof lock.acquire !== "function" || typeof lock.release !== "function") {
    throw new InvalidAutomatedStrategyReviewDependenciesError("fields.lock must be a Strategy Review Lock — see createStrategyReviewLock()");
  }
  if (!policy || !isNonEmptyString(policy.repositoryPath) || !isNonEmptyString(policy.permittedBranch)) {
    throw new InvalidAutomatedStrategyReviewDependenciesError("fields.policy must be a real Strategy Review Policy — see createStrategyReviewPolicy()");
  }
  if (!isNonEmptyString(reviewExportDir)) {
    throw new InvalidAutomatedStrategyReviewDependenciesError("fields.reviewExportDir is required and must be a non-empty string");
  }
}

function checksumOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildUnassessedCriteria(workOrder, reasonText) {
  return workOrder.review_criteria.map((criterion, i) => ({
    criterionIndex: i + 1,
    criterion,
    result: "insufficient_evidence",
    evidence: [{ source: "work-order", summary: "Not individually assessed — review was escalated before per-criterion assessment." }],
    reason: reasonText,
  }));
}

function synthesizeCeoEscalation(reasons) {
  return {
    decisionRequired: "Automated safety gate override — manual Strategy Office review required.",
    reason: reasons.join(" "),
    safeOptions: ["Stop and route to manual Strategy Office review.", "Request a corrected delivery once the flagged condition is resolved."],
  };
}

/**
 * Builds an Automated Strategy Review Service.
 *
 * fields.workOrderStore / deliveryReportStore — required, I029 stores.
 * fields.strategyReviewStore — required, an Engineering Strategy Review
 *   Store (I029.3).
 * fields.transportStore — required, a Bridge Transport Store (I029.1).
 * fields.reviewerAdapter — required, a Strategy Review Agent Adapter —
 *   the mock adapter by default; the real OpenAI adapter only when the
 *   caller explicitly constructs and supplies one.
 * fields.lock — required, a Strategy Review Lock.
 * fields.policy — required, a Strategy Review Policy.
 * fields.reviewExportDir — required, explicit directory the constructed
 *   review is written to before being recorded as an outgoing Bridge
 *   Transport event (mirrors Bridge Transport's own `destinationDir`
 *   "outgoing queue drop" convention, I029.1).
 *
 * options.now / idGenerator / validator / rootDir / runGit / runTests /
 *   runFixtures — injectable for tests.
 *
 * Returns { reviewDelivery, getReviewStatus }.
 */
export function createAutomatedStrategyReviewService(fields = {}, options = {}) {
  const { workOrderStore, deliveryReportStore, strategyReviewStore, transportStore, reviewerAdapter, lock, policy, reviewExportDir } = fields;
  assertDependencies(fields);

  async function reviewDelivery({ workOrderId, deliveryReportId }) {
    const workOrder = workOrderStore.get(workOrderId);
    const deliveryReport = deliveryReportStore.get(deliveryReportId);

    const reasons = [];
    if (deliveryReport.work_order_id !== workOrder.work_order_id) {
      reasons.push(`Delivery Report "${deliveryReportId}" does not reference Work Order "${workOrderId}"`);
    }
    if (["approved", "archived"].includes(workOrder.status)) {
      reasons.push(`Work Order status is "${workOrder.status}" — already finalised`);
    }
    if (strategyReviewStore.findByDeliveryReport(deliveryReportId).length > 0) {
      reasons.push(`Delivery Report "${deliveryReportId}" already has a Strategy Review`);
    }
    if (reasons.length > 0) {
      throw new DeliveryReportNotEligibleForReviewError(deliveryReportId, reasons);
    }

    const lockHandle = lock.acquire(deliveryReportId);

    try {
      const evidence = collectStrategyReviewEvidence({ workOrder, deliveryReport, transportStore, policy }, options);

      const preGate = evaluatePreReviewGates(evidence, policy);

      let finalDecision;
      let criteria;
      let correction = null;
      let ceoEscalation = null;
      let risks = [];
      let summary;
      const reviewerProvider = reviewerAdapter.name;

      if (preGate.forced) {
        finalDecision = preGate.decision;
        criteria = buildUnassessedCriteria(workOrder, preGate.reasons.join(" "));
        ceoEscalation = synthesizeCeoEscalation(preGate.reasons);
        risks = preGate.reasons;
        summary = `Review escalated before the reviewer was invoked: ${preGate.reasons.join(" ")}`;
      } else {
        let proposal;
        try {
          const raw = await reviewerAdapter.reviewDelivery({ workOrder, deliveryReport, evidence, policy });
          proposal = assertValidReviewProposal(raw, workOrder.review_criteria.length);
        } catch (cause) {
          finalDecision = "ceo_decision_required";
          criteria = buildUnassessedCriteria(workOrder, `The reviewer failed to complete: ${cause.message}`);
          ceoEscalation = synthesizeCeoEscalation([`The Strategy Review Agent failed to complete: ${cause.message}`]);
          risks = [`Strategy Review Agent failure: ${cause.message}`];
          summary = `Review could not be completed by the reviewer — escalated. ${cause.message}`;
          proposal = null;
        }

        if (proposal) {
          const gateResult = applyPostReviewGates(proposal.decision, evidence, policy);
          finalDecision = gateResult.decision;
          // assertValidReviewProposal() only guarantees every index 1..N is
          // present exactly once, not that the array arrived in that
          // order — sort explicitly, since createEngineeringStrategyReview()
          // requires strict positional ordering.
          criteria = [...proposal.criteria]
            .sort((a, b) => a.criterionIndex - b.criterionIndex)
            .map((c) => ({ criterionIndex: c.criterionIndex, result: c.result, evidence: c.evidence, reason: c.reason }));
          if (gateResult.overridden) {
            correction = null;
            ceoEscalation = finalDecision === "ceo_decision_required" ? synthesizeCeoEscalation(gateResult.reasons) : null;
            risks = [...proposal.risks, ...gateResult.reasons];
          } else {
            correction = proposal.correction
              ? {
                  failedCriteria: proposal.correction.failedCriteria,
                  requiredOutcome: proposal.correction.requiredOutcome,
                  prohibitedScopeExpansion: proposal.correction.prohibitedScopeExpansion,
                  verificationRequired: proposal.correction.verificationRequired,
                }
              : null;
            ceoEscalation = proposal.ceoEscalation
              ? { decisionRequired: proposal.ceoEscalation.decisionRequired, reason: proposal.ceoEscalation.reason, safeOptions: proposal.ceoEscalation.safeOptions }
              : null;
            risks = proposal.risks;
          }
          summary = proposal.summary;
        }
      }

      const review = createEngineeringStrategyReview(
        {
          workOrderId,
          deliveryReportId,
          workOrderReviewCriteria: workOrder.review_criteria,
          milestone: workOrder.milestone,
          reviewerProvider,
          decision: finalDecision,
          criteria: criteria.map((c) => ({ criterionIndex: c.criterionIndex, criterion: workOrder.review_criteria[c.criterionIndex - 1], result: c.result, evidence: c.evidence, reason: c.reason })),
          repositoryEvidence: {
            startingCommit: evidence.repository.startingCommit,
            endingCommit: evidence.repository.endingCommit,
            branch: evidence.repository.branch,
            workingTree: evidence.repository.verifiable ? (evidence.repository.workingTreeClean ? "clean" : "dirty") : "unknown",
            pushStatus: evidence.repository.pushStatus,
            verifiable: evidence.repository.verifiable,
          },
          verification: { tests: evidence.tests, fixtures: evidence.fixtures },
          risks,
          correction,
          ceoEscalation,
          summary,
          notes: null,
        },
        options
      );

      const saved = strategyReviewStore.save(review);
      const transportRecord = exportReviewThroughBridgeTransport(saved);

      return {
        workOrderId,
        deliveryReportId,
        strategyReviewId: saved.strategy_review_id,
        decision: saved.decision,
        transportRecordId: transportRecord.transport_record_id,
      };
    } finally {
      lock.release(deliveryReportId, lockHandle.lockToken);
    }
  }

  /**
   * Records the review as one outgoing Bridge Transport event — reuses
   * the real, generic createBridgeTransportRecord() + transportStore
   * unmodified (see this file's own header comment for why
   * bridge-transport-service.mjs's own export/import functions are not
   * used here). A real file is written to reviewExportDir, mirroring the
   * "outgoing queue drop" convention the mock Transport Adapter itself
   * uses for Work Orders.
   */
  function exportReviewThroughBridgeTransport(review) {
    mkdirSync(reviewExportDir, { recursive: true });
    const content = JSON.stringify(review);
    const destinationPath = path.join(reviewExportDir, `${review.strategy_review_id}.json`);
    writeFileSync(destinationPath, content, "utf-8");

    const record = createBridgeTransportRecord(
      {
        objectType: "engineering_strategy_review",
        objectId: review.strategy_review_id,
        transportType: "mock",
        status: "delivered",
        source: "engineering-strategy-review-store",
        destination: destinationPath,
        checksum: checksumOf(review),
      },
      options
    );
    transportStore.save(record);
    return record;
  }

  /** Read-only. Work Order + its Strategy Reviews + current lock state — for the CLI's `status`/`work` subcommands and Control Centre. */
  function getReviewStatus(deliveryReportId) {
    const deliveryReport = deliveryReportStore.get(deliveryReportId);
    const reviews = strategyReviewStore.findByDeliveryReport(deliveryReportId);
    const lockInfo = lock.inspect(deliveryReportId);
    return { deliveryReport, reviews, lock: lockInfo };
  }

  return { reviewDelivery, getReviewStatus };
}

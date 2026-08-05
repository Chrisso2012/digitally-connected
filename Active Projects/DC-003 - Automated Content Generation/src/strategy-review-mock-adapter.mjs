// DC-003-I029.3 — Mock Strategy Review Adapter: the ONLY adapter any
// automated test or the CLI's default mode ever uses — no HTTP, no
// OpenAI, no network dependency. Deterministic: `options.mode` selects
// the exact scenario. Mirrors delivery-office-mock-runner-adapter.mjs's
// own `options.mode` pattern (I029.2).
//
// Covers every DC-003-I029.3 §8 scenario:
//   approved | correction-required | ceo-escalation | rejected |
//   malformed | missing-criterion | duplicate-criterion |
//   unsupported-decision | unsafe-approval | timeout | provider-failure

import { ReviewAdapterExecutionFailedError } from "./strategy-review-errors.mjs";

const DEFAULT_MODE = "approved";

function passCriteria(count) {
  return Array.from({ length: count }, (_, i) => ({
    criterionIndex: i + 1,
    result: "pass",
    evidence: [{ source: "independent-verification", summary: "Evidence supports this criterion [mock]." }],
    reason: null,
  }));
}

export function createStrategyReviewMockAdapter(options = {}) {
  const mode = options.mode ?? DEFAULT_MODE;

  return {
    name: "mock-strategy-review-adapter",

    async reviewDelivery({ evidence, workOrder }) {
      const criterionCount = workOrder.review_criteria.length;

      if (mode === "timeout") {
        throw new ReviewAdapterExecutionFailedError("review exceeded the configured maximum duration [mock]");
      }
      if (mode === "provider-failure") {
        throw new ReviewAdapterExecutionFailedError("simulated provider transport failure [mock]");
      }

      if (mode === "malformed") {
        // Deliberately missing required Review Proposal fields —
        // strategy-review-agent-adapter.mjs's own assertValidReviewProposal()
        // must catch this, not this adapter.
        return { decision: "approved" };
      }
      if (mode === "missing-criterion") {
        return { decision: "approved", criteria: passCriteria(criterionCount).slice(0, -1), risks: [], correction: null, ceoEscalation: null, summary: "Missing one criterion [mock]." };
      }
      if (mode === "duplicate-criterion") {
        const criteria = passCriteria(criterionCount);
        criteria[criteria.length - 1] = { ...criteria[0] };
        return { decision: "approved", criteria, risks: [], correction: null, ceoEscalation: null, summary: "Duplicated a criterion index [mock]." };
      }
      if (mode === "unsupported-decision") {
        return { decision: "auto_merge", criteria: passCriteria(criterionCount), risks: [], correction: null, ceoEscalation: null, summary: "Unsupported decision [mock]." };
      }
      if (mode === "unsafe-approval") {
        // Proposes "approved" with every criterion passing, REGARDLESS of
        // the real evidence handed to this adapter — proves the service's
        // own deterministic post-review gate (not this mock) is what
        // catches an approval that contradicts real failing evidence.
        return { decision: "approved", criteria: passCriteria(criterionCount), risks: [], correction: null, ceoEscalation: null, summary: "Approved regardless of evidence [mock, deliberately unsafe]." };
      }

      if (mode === "correction-required") {
        const criteria = passCriteria(criterionCount);
        criteria[0] = { criterionIndex: 1, result: "fail", evidence: [{ source: "independent-verification", summary: "This criterion was not met [mock]." }], reason: "Criterion 1 failed verification [mock]." };
        return {
          decision: "correction_required",
          criteria,
          risks: [],
          correction: {
            failedCriteria: [1],
            requiredOutcome: "Address the failed criterion without expanding scope [mock].",
            prohibitedScopeExpansion: "Do not touch anything beyond the original Work Order [mock].",
            verificationRequired: "Re-run the full test and fixture suite [mock].",
          },
          ceoEscalation: null,
          summary: "One criterion requires correction [mock].",
        };
      }

      if (mode === "ceo-escalation") {
        return {
          decision: "ceo_decision_required",
          criteria: passCriteria(criterionCount),
          risks: ["Evidence conflict requires CEO judgement [mock]."],
          correction: null,
          ceoEscalation: {
            decisionRequired: "Whether to proceed given an evidence conflict [mock].",
            reason: "Independent evidence and the Delivery Report's own claims disagree in a way this reviewer cannot resolve [mock].",
            safeOptions: ["Stop and request clarification.", "Reject and request a fresh delivery."],
          },
          summary: "Escalated to CEO decision [mock].",
        };
      }

      if (mode === "rejected") {
        const criteria = passCriteria(criterionCount).map((c) => ({ ...c, result: "fail", reason: "Delivery is fundamentally unsafe or out of scope [mock]." }));
        return { decision: "rejected", criteria, risks: ["Delivery evidence is irreconcilable with the Work Order [mock]."], correction: null, ceoEscalation: null, summary: "Rejected — unsafe or out of scope [mock]." };
      }

      // "approved" (default)
      return { decision: "approved", criteria: passCriteria(criterionCount), risks: [], correction: null, ceoEscalation: null, summary: `Work Order ${workOrder.milestone} delivery matches every review criterion [mock].` };
    },
  };
}

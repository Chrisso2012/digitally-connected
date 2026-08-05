// DC-003-I029.3 — Review instruction construction: translates one Work
// Order + Delivery Report + independently-collected evidence into a
// bounded OpenAI instruction, and defines the strict JSON Schema OpenAI's
// own structured-output mechanism is constrained to. Mirrors
// claude-code-delivery-runner-adapter.mjs's own buildDeliveryInstruction()
// discipline (I029.2): only real Work Order/Delivery Report/evidence
// fields, deterministic authority rules, required response format —
// nothing invented, no conversation history, never persisted as a new
// permanent domain object.

const EVIDENCE_SOURCES = ["independent-verification", "delivery-report", "work-order", "bridge-transport"];
const CRITERION_RESULTS = ["pass", "fail", "insufficient_evidence", "not_applicable"];

const evidenceEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "summary"],
  properties: {
    source: { type: "string", enum: EVIDENCE_SOURCES },
    summary: { type: "string" },
  },
};

const criterionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["criterionIndex", "result", "evidence", "reason"],
  properties: {
    criterionIndex: { type: "integer" },
    result: { type: "string", enum: CRITERION_RESULTS },
    evidence: { type: "array", items: evidenceEntrySchema },
    reason: { type: ["string", "null"] },
  },
};

export const REVIEW_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "criteria", "risks", "correction", "ceoEscalation", "summary"],
  properties: {
    decision: { type: "string", enum: ["approved", "correction_required", "ceo_decision_required", "rejected"] },
    criteria: { type: "array", items: criterionSchema },
    risks: { type: "array", items: { type: "string" } },
    correction: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["failedCriteria", "requiredOutcome", "prohibitedScopeExpansion", "verificationRequired"],
      properties: {
        failedCriteria: { type: "array", items: { type: "integer" } },
        requiredOutcome: { type: "string" },
        prohibitedScopeExpansion: { type: "string" },
        verificationRequired: { type: "string" },
      },
    },
    ceoEscalation: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["decisionRequired", "reason", "safeOptions"],
      properties: {
        decisionRequired: { type: "string" },
        reason: { type: "string" },
        safeOptions: { type: "array", items: { type: "string" } },
      },
    },
    summary: { type: "string" },
  },
};

function bounded(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}… [truncated]` : text;
}

/**
 * Builds the bounded review instruction. `evidenceSummaryMaxLength`
 * bounds each individual evidence-summary line; the caller
 * (openai-strategy-review-adapter.mjs) is responsible for enforcing the
 * overall policy.maxInputChars ceiling on the assembled result.
 */
export function buildReviewInstruction({ workOrder, deliveryReport, evidence, policy }) {
  const maxLen = policy.maxEvidenceSummaryLength;
  const lines = [
    "You are the Automated Strategy Review Agent reviewing one completed Engineering Delivery against the Engineering Work Order that authorised it.",
    "You review evidence. You do not trust prose alone. Compare the Work Order against the independently collected repository evidence and the Delivery Report below.",
    "",
    `Milestone: ${workOrder.milestone}`,
    `Work Order title: ${workOrder.title}`,
    `Objective: ${workOrder.objective}`,
    "",
    "Constraints:",
    ...(workOrder.constraints.length > 0 ? workOrder.constraints.map((c) => `  - ${c}`) : ["  (none recorded)"]),
    "",
    "Dependencies:",
    ...(workOrder.dependencies.length > 0 ? workOrder.dependencies.map((d) => `  - ${d}`) : ["  (none)"]),
    "",
    "Review criteria — assess EACH ONE exactly once, in this exact order, using criterionIndex 1..N:",
    ...workOrder.review_criteria.map((c, i) => `  ${i + 1}. ${c}`),
    "",
    `Delivery Report status (as self-reported by the Delivery Office): ${deliveryReport.status}`,
    `Delivery Report tests: ${deliveryReport.tests.passed}/${deliveryReport.tests.total} passed (${deliveryReport.tests.failed} failed)`,
    `Delivery Report fixtures: ${deliveryReport.fixtures.passed}/${deliveryReport.fixtures.total} passed (${deliveryReport.fixtures.failed} failed)`,
    `Delivery Report summary: ${bounded(deliveryReport.repository_findings.join(" "), maxLen)}`,
    "",
    "Independently collected repository evidence (trust this over any Delivery Report claim it conflicts with):",
    `  starting_commit=${evidence.repository.startingCommit} ending_commit=${evidence.repository.endingCommit} branch=${evidence.repository.branch}`,
    `  working_tree_clean=${evidence.repository.workingTreeClean} push_status=${evidence.repository.pushStatus} verifiable=${evidence.repository.verifiable}`,
    `  tests (source=${evidence.tests.source}): ${evidence.tests.passed}/${evidence.tests.total} passed`,
    `  fixtures (source=${evidence.fixtures.source}): ${evidence.fixtures.passed}/${evidence.fixtures.total} passed`,
    `  files_created=${evidence.filesCreated.length} files_modified=${evidence.filesModified.length}`,
    "",
    "Authority rules — hard limits, not suggestions:",
    "  - Review ONLY the Work Order and evidence supplied above. Do not invent criteria, and never broaden scope.",
    "  - Never approve when required evidence is missing, contradictory, or unverifiable.",
    "  - Never waive a failed test, fixture, or review criterion to reach approval.",
    "  - Do not propose, suggest, or approve any live external-provider call, credential action, or infrastructure change — if the evidence shows one occurred, escalate instead.",
    "  - You cannot override deterministic safety gates enforced by the calling service; a rejected/escalated proposal you make in good faith will stand, but an unsafe 'approved' will be overridden regardless of what you write here.",
    "  - Do not output hidden reasoning or a transcript — return only the structured, bounded fields defined by the required schema.",
    "",
    "Return your assessment using exactly the structured schema you have been given.",
  ];
  return lines.join("\n");
}

// DC-003-I029.3 — structured errors for the Strategy Review layer: the
// evidence collector, the review policy, the Strategy Review Agent
// Adapter contract, the Strategy Review Lock, and the Automated Strategy
// Review Service — combined in one file, mirroring
// delivery-office-errors.mjs's own precedent (I029.2) for a set of small,
// closely-related components. Every message here is written on the
// assumption it may be shown to an external caller — never a raw
// filesystem path, raw Node error message, stack trace, or credential.

export class InvalidStrategyReviewPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidStrategyReviewPolicyError";
  }
}

/** The supplied Delivery Report's own work_order_id does not match the Work Order being reviewed. */
export class EvidenceRelationshipMismatchError extends Error {
  constructor(workOrderId, deliveryReportId) {
    super(`Delivery Report "${deliveryReportId}" does not reference Work Order "${workOrderId}" — refusing to review a mismatched pair`);
    this.name = "EvidenceRelationshipMismatchError";
    this.workOrderId = workOrderId;
    this.deliveryReportId = deliveryReportId;
  }
}

/** The evidence collector could not independently inspect the repository at all (e.g. not a real git repository). */
export class EvidenceCollectionFailedError extends Error {
  constructor(reason, cause) {
    super(`Strategy Review evidence collection failed — ${reason}`, { cause });
    this.name = "EvidenceCollectionFailedError";
  }
}

/** OpenAI adapter construction failed — e.g. no API key configured. Never thrown for a missing key on the MOCK adapter. */
export class StrategyReviewConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "StrategyReviewConfigurationError";
  }
}

export class StrategyReviewAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "StrategyReviewAuthenticationError";
  }
}

export class StrategyReviewRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "StrategyReviewRateLimitError";
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

export class StrategyReviewTimeoutError extends Error {
  constructor(message, timeoutMs) {
    super(message);
    this.name = "StrategyReviewTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** A non-retryable 4xx (request-construction problem), mirrors LlmClientError's own precedent (I019.1). */
export class StrategyReviewClientError extends Error {
  constructor(message, diagnostic) {
    super(message);
    this.name = "StrategyReviewClientError";
    this.diagnostic = diagnostic ?? null;
  }
}

/** Network failure or an HTTP 5xx server error. */
export class StrategyReviewTransportError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "StrategyReviewTransportError";
  }
}

export class InvalidStrategyReviewAgentAdapterError extends Error {
  constructor() {
    super("A Strategy Review Agent adapter must be shaped { name: string, reviewDelivery({ workOrder, deliveryReport, evidence, policy }): Promise<ReviewProposal> }");
    this.name = "InvalidStrategyReviewAgentAdapterError";
  }
}

/** The adapter's returned proposal does not match the normalised Review Proposal contract. */
export class MalformedReviewProposalError extends Error {
  constructor(reason) {
    super(`Strategy Review Agent returned a malformed proposal — ${reason}`);
    this.name = "MalformedReviewProposalError";
  }
}

/** The adapter itself threw, timed out, or a transport/config/auth failure occurred. */
export class ReviewAdapterExecutionFailedError extends Error {
  constructor(reason, cause) {
    super(`Strategy Review Agent execution failed — ${reason}`, { cause });
    this.name = "ReviewAdapterExecutionFailedError";
  }
}

export class InvalidStrategyReviewLockIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid delivery report identifier — expected the form dr_<alphanumeric>`);
    this.name = "InvalidStrategyReviewLockIdentifierError";
  }
}

export class StrategyReviewLockAlreadyHeldError extends Error {
  constructor(deliveryReportId, acquiredAt) {
    super(`A review lock is already held for "${deliveryReportId}" (acquired at ${acquiredAt}) — it is not acquired again`);
    this.name = "StrategyReviewLockAlreadyHeldError";
    this.deliveryReportId = deliveryReportId;
  }
}

export class StrategyReviewLockNotHeldError extends Error {
  constructor(deliveryReportId) {
    super(`No review lock is currently held for "${deliveryReportId}"`);
    this.name = "StrategyReviewLockNotHeldError";
    this.deliveryReportId = deliveryReportId;
  }
}

export class StrategyReviewLockOwnershipError extends Error {
  constructor(deliveryReportId) {
    super(`The supplied lock token does not match the current review lock for "${deliveryReportId}" — refusing to release a lock this caller does not own`);
    this.name = "StrategyReviewLockOwnershipError";
    this.deliveryReportId = deliveryReportId;
  }
}

export class StrategyReviewLockPersistenceError extends Error {
  constructor(deliveryReportId, operation, cause) {
    super(`Review lock ${operation} failed for "${deliveryReportId}"`, { cause });
    this.name = "StrategyReviewLockPersistenceError";
    this.deliveryReportId = deliveryReportId;
    this.operation = operation;
  }
}

/** The Delivery Report is not eligible for automated review right now (wrong status, already reviewed, etc.). */
export class DeliveryReportNotEligibleForReviewError extends Error {
  constructor(deliveryReportId, reasons) {
    super(`Delivery Report "${deliveryReportId}" is not eligible for automated Strategy Review:\n${reasons.map((r) => `  - ${r}`).join("\n")}`);
    this.name = "DeliveryReportNotEligibleForReviewError";
    this.deliveryReportId = deliveryReportId;
    this.reasons = reasons;
  }
}

export class InvalidAutomatedStrategyReviewDependenciesError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidAutomatedStrategyReviewDependenciesError";
  }
}

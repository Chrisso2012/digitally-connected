// DC-003-I029.2 — all structured errors for the Automated Delivery Office:
// the Execution Lock, the Delivery Runner Adapter contract, the Execution
// Policy, and the Automated Delivery Office Service itself — combined in
// one file, deliberately, mirroring bridge-transport-errors.mjs's own
// "lean extension point, not a new business capability" precedent. Every
// message here is written on the assumption it may be shown to an
// external caller — never a raw filesystem path, a raw Node error
// message, a stack trace, or a credential is ever interpolated; only
// already-public identifiers (work_order_id, delivery_report_id) are
// named.

export class InvalidExecutionLockIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid work order identifier — expected the form wo_<alphanumeric>`);
    this.name = "InvalidExecutionLockIdentifierError";
  }
}

/** A lock is already held for this Work Order and is not stale. */
export class ExecutionLockAlreadyHeldError extends Error {
  constructor(workOrderId, acquiredAt) {
    super(`An execution lock is already held for "${workOrderId}" (acquired at ${acquiredAt}) — it is not acquired again`);
    this.name = "ExecutionLockAlreadyHeldError";
    this.workOrderId = workOrderId;
  }
}

/** release()/inspect() was asked about a Work Order with no lock file on disk. */
export class ExecutionLockNotHeldError extends Error {
  constructor(workOrderId) {
    super(`No execution lock is currently held for "${workOrderId}"`);
    this.name = "ExecutionLockNotHeldError";
    this.workOrderId = workOrderId;
  }
}

/**
 * release() was called with a lockToken that does not match the lock
 * file's own recorded token — refuses to remove a lock this caller does
 * not own. Never a silent no-op: the caller always learns the release did
 * not happen.
 */
export class ExecutionLockOwnershipError extends Error {
  constructor(workOrderId) {
    super(`The supplied lock token does not match the current execution lock for "${workOrderId}" — refusing to release a lock this caller does not own`);
    this.name = "ExecutionLockOwnershipError";
    this.workOrderId = workOrderId;
  }
}

export class ExecutionLockPersistenceError extends Error {
  constructor(workOrderId, operation, cause) {
    super(`Execution lock ${operation} failed for "${workOrderId}"`, { cause });
    this.name = "ExecutionLockPersistenceError";
    this.workOrderId = workOrderId;
    this.operation = operation;
  }
}

export class InvalidDeliveryOfficeRunnerAdapterError extends Error {
  constructor() {
    super(
      "A Delivery Office Runner adapter must be shaped { name: string, executeWorkOrder({ workOrder, repository, executionPolicy }): Promise<RunnerResult> }"
    );
    this.name = "InvalidDeliveryOfficeRunnerAdapterError";
  }
}

export class InvalidExecutionPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidExecutionPolicyError";
  }
}

/**
 * The Work Order failed one or more eligibility checks (§4 of the
 * DC-003-I029.2 brief) — never reaches the runner adapter. `reasons` is
 * an array of short, non-conversational strings, one per failed check.
 */
export class WorkOrderNotEligibleError extends Error {
  constructor(workOrderId, reasons) {
    super(`Work Order "${workOrderId}" is not eligible for automated execution:\n${reasons.map((r) => `  - ${r}`).join("\n")}`);
    this.name = "WorkOrderNotEligibleError";
    this.workOrderId = workOrderId;
    this.reasons = reasons;
  }
}

/** A successful (status "completed") Delivery Report already exists for this Work Order. */
export class DuplicateDeliveryError extends Error {
  constructor(workOrderId, existingDeliveryReportId) {
    super(`Work Order "${workOrderId}" already has a completed Delivery Report ("${existingDeliveryReportId}") — it is not executed again`);
    this.name = "DuplicateDeliveryError";
    this.workOrderId = workOrderId;
    this.existingDeliveryReportId = existingDeliveryReportId;
  }
}

/** The runner adapter itself threw, timed out, or was interrupted. */
export class RunnerExecutionFailedError extends Error {
  constructor(workOrderId, reason, cause) {
    super(`Delivery Office Runner execution failed for "${workOrderId}" — ${reason}`, { cause });
    this.name = "RunnerExecutionFailedError";
    this.workOrderId = workOrderId;
  }
}

/** The runner adapter returned a result that does not match the normalised Structured Runner Result contract (§7). */
export class MalformedRunnerResultError extends Error {
  constructor(workOrderId, reason) {
    super(`Delivery Office Runner returned a malformed result for "${workOrderId}" — ${reason}`);
    this.name = "MalformedRunnerResultError";
    this.workOrderId = workOrderId;
  }
}

export class InvalidAutomatedDeliveryOfficeDependenciesError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidAutomatedDeliveryOfficeDependenciesError";
  }
}

// DC-003-I029.2 — Automated Delivery Office Service: the only module that
// executes one approved Engineering Work Order through a Delivery Office
// Runner Adapter (mock by default, real Claude Code CLI subprocess only
// when explicitly configured) and records one Engineering Delivery
// Report. Composes I029's own stores unmodified and I029.1's own Bridge
// Transport Service unmodified — this service never calls
// deliveryReportStore.save() directly; the ONLY way a Delivery Report this
// service produces ever reaches the store is through I029.1's own
// importDeliveryReport(), exactly mirroring how a Delivery Report already
// reaches the store for a manually-performed delivery (see
// tests/validation/bridge.mjs's own `import` subcommand) — "Do not bypass
// the existing Bridge Transport Store."
//
// This service NEVER approves a Delivery Report — every status it can
// produce ("completed"/"partial"/"failed") is delivery EVIDENCE, not a
// Strategy Office decision. A "completed" runner process is not
// automatically an approved implementation (§8 of the brief).
//
// Independent verification, not blind trust: after the runner adapter
// returns (or throws), this service re-reads real git state itself
// (readGitState/computeChangedFiles/readUpstreamCommit from
// repository-git-evidence.mjs) and uses THAT — never the runner's own
// self-reported repository.* fields — to decide the Delivery Report's own
// commit/push_status/working_tree/files_created/files_modified. The
// runner's own verification.testsPassed/fixturesPassed/testsSummary/
// fixturesSummary self-report IS still trusted for test/fixture evidence
// (re-running the whole Docker test suite from inside this service on
// every execution was considered and rejected — it would make every unit
// test in this milestone itself require Docker, and duplicate rather than
// verify what the runner's own subprocess already ran) — but a
// "completed" verdict additionally REQUIRES independent corroboration
// (clean working tree, intended branch, a real new commit, and — when the
// policy allows pushing — a push that actually landed) before this
// service will ever write status "completed"; any mismatch downgrades to
// "partial" (real progress, not fully verified) or "failed" (no progress
// captured in git history at all).
//
// Execution Lock (§5) is always released via `finally` — a normal
// exception anywhere in this flow (including a store validation bug) is
// exactly the "handled failure" case the brief's own §5 describes; only a
// process-level crash could leave a lock orphaned, an inherent limitation
// of any lock-file mechanism (see README "Automated Delivery Office —
// limitations").

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createEngineeringDeliveryReport } from "./engineering-delivery-report.mjs";
import { importDeliveryReport } from "./bridge-transport-service.mjs";
import { assertValidDeliveryOfficeRunnerAdapter, assertValidRunnerResult } from "./delivery-office-runner-adapter.mjs";
import { readGitState, readUpstreamCommit, computeChangedFiles, defaultRunGit } from "./repository-git-evidence.mjs";
import {
  WorkOrderNotEligibleError,
  DuplicateDeliveryError,
  InvalidAutomatedDeliveryOfficeDependenciesError,
} from "./delivery-office-errors.mjs";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function assertDependencies({ workOrderStore, deliveryReportStore, transportStore, transportAdapter, runnerAdapter, lock, executionPolicy, deliveryReportDropDir }) {
  if (!workOrderStore || typeof workOrderStore.get !== "function") {
    throw new InvalidAutomatedDeliveryOfficeDependenciesError("fields.workOrderStore must be an Engineering Work Order Store");
  }
  if (!deliveryReportStore || typeof deliveryReportStore.findByWorkOrder !== "function") {
    throw new InvalidAutomatedDeliveryOfficeDependenciesError("fields.deliveryReportStore must be an Engineering Delivery Report Store");
  }
  if (!transportStore || typeof transportStore.save !== "function" || typeof transportStore.findByObject !== "function") {
    throw new InvalidAutomatedDeliveryOfficeDependenciesError("fields.transportStore must be a Bridge Transport Store");
  }
  if (!transportAdapter || typeof transportAdapter.receiveDeliveryReport !== "function") {
    throw new InvalidAutomatedDeliveryOfficeDependenciesError("fields.transportAdapter must be a Bridge Transport Adapter");
  }
  assertValidDeliveryOfficeRunnerAdapter(runnerAdapter);
  if (!lock || typeof lock.acquire !== "function" || typeof lock.release !== "function" || typeof lock.inspect !== "function") {
    throw new InvalidAutomatedDeliveryOfficeDependenciesError("fields.lock must be a Delivery Execution Lock — see createDeliveryExecutionLock()");
  }
  if (!executionPolicy || !isNonEmptyString(executionPolicy.repositoryPath) || !isNonEmptyString(executionPolicy.permittedBranch)) {
    throw new InvalidAutomatedDeliveryOfficeDependenciesError("fields.executionPolicy must be a real Execution Policy — see createExecutionPolicy()");
  }
  if (!isNonEmptyString(deliveryReportDropDir)) {
    throw new InvalidAutomatedDeliveryOfficeDependenciesError("fields.deliveryReportDropDir is required and must be a non-empty string");
  }
}

function checkDependenciesSatisfied(workOrder, deliveryReportStore) {
  const unsatisfied = [];
  for (const dependencyId of workOrder.dependencies) {
    const reports = deliveryReportStore.findByWorkOrder(dependencyId);
    if (!reports.some((r) => r.status === "completed")) {
      unsatisfied.push(dependencyId);
    }
  }
  return unsatisfied;
}

function derivePushStatus({ executionPolicy, upstreamCommit, commit }) {
  if (!executionPolicy.allowPush) return "not_applicable";
  if (commit === null) return "not_applicable";
  if (upstreamCommit === null) return "not_pushed";
  return upstreamCommit === commit ? "pushed" : "not_pushed";
}

function deriveDeliveryStatus({ runnerResult, postGitState, executionPolicy, committedSomething, pushStatus }) {
  const selfReportsSuccess = runnerResult.status === "completed" && runnerResult.verification.testsPassed && runnerResult.verification.fixturesPassed;
  const independentlyClean = postGitState.workingTreeClean && postGitState.branch === executionPolicy.permittedBranch;
  const pushOk = pushStatus === "pushed" || pushStatus === "not_applicable";

  if (selfReportsSuccess && independentlyClean && committedSomething && pushOk) return "completed";
  if (committedSomething) return "partial";
  return "failed";
}

function buildRepositoryFindings({ runnerResult, postGitState, executionPolicy, pushStatus }) {
  const findings = [`Runner report: ${runnerResult.deliveryEvidence.summary}`];
  if (!postGitState.workingTreeClean) {
    findings.push("Independent check found the working tree dirty after execution.");
  }
  if (postGitState.branch !== executionPolicy.permittedBranch) {
    findings.push(`Independent check found the repository on branch "${postGitState.branch}", expected "${executionPolicy.permittedBranch}".`);
  }
  if (executionPolicy.allowPush && pushStatus === "not_pushed") {
    findings.push("A commit exists locally but does not match the remote tracking branch — not pushed.");
  }
  return findings;
}

/**
 * Builds an Automated Delivery Office Service.
 *
 * fields.workOrderStore — required, an Engineering Work Order Store (I029).
 * fields.deliveryReportStore — required, an Engineering Delivery Report
 *   Store (I029).
 * fields.transportStore — required, a Bridge Transport Store (I029.1).
 * fields.transportAdapter — required, a Bridge Transport Adapter (I029.1) —
 *   the mock adapter in every automated test, per this milestone's own
 *   §12 requirement.
 * fields.runnerAdapter — required, a Delivery Office Runner Adapter — the
 *   mock adapter by default; the real Claude Code CLI adapter only when
 *   the caller explicitly constructs and supplies one.
 * fields.lock — required, a Delivery Execution Lock (see
 *   createDeliveryExecutionLock()).
 * fields.executionPolicy — required, a real Execution Policy (see
 *   createExecutionPolicy()).
 * fields.deliveryReportDropDir — required, explicit directory the
 *   constructed Delivery Report is written to before being imported
 *   through Bridge Transport — mirrors Bridge Transport's own
 *   `destinationDir` "outgoing queue drop" convention (I029.1).
 *
 * options.now / runGit / validator / rootDir / idGenerator — injectable
 *   for tests.
 *
 * Returns { executeApprovedWorkOrder, getExecutionStatus }.
 */
export function createAutomatedDeliveryOfficeService(fields = {}, options = {}) {
  const { workOrderStore, deliveryReportStore, transportStore, transportAdapter, runnerAdapter, lock, executionPolicy, deliveryReportDropDir } = fields;
  assertDependencies(fields);

  const now = options.now ?? (() => new Date().toISOString());
  const runGit = options.runGit ?? defaultRunGit;

  async function executeApprovedWorkOrder({ workOrderId, allowNewerStartingCommit = false }) {
    const workOrder = workOrderStore.get(workOrderId);
    const currentGitState = readGitState(executionPolicy.repositoryPath, runGit);

    const reasons = [];
    if (workOrder.status !== "ready") reasons.push(`status is "${workOrder.status}", expected "ready"`);
    if (workOrder.approved_at === null) reasons.push("approved_at is not set");
    if (workOrder.repository_commit !== null && workOrder.repository_commit !== currentGitState.commit && !allowNewerStartingCommit) {
      reasons.push(`repository is at commit "${currentGitState.commit}" but the Work Order expects "${workOrder.repository_commit}"`);
    }
    // §10 Git Safety, "before execution" — checked here, not merely after
    // the fact, so an unsafe starting state fails eligibility before the
    // lock is ever acquired or the runner ever invoked.
    if (currentGitState.branch !== executionPolicy.permittedBranch) {
      reasons.push(`repository is on branch "${currentGitState.branch}", expected "${executionPolicy.permittedBranch}"`);
    }
    if (!currentGitState.workingTreeClean) {
      reasons.push("repository working tree is not clean");
    }
    for (const unsatisfied of checkDependenciesSatisfied(workOrder, deliveryReportStore)) {
      reasons.push(`dependency "${unsatisfied}" has no completed Delivery Report`);
    }
    if (reasons.length > 0) {
      throw new WorkOrderNotEligibleError(workOrderId, reasons);
    }

    const existingCompleted = deliveryReportStore.findByWorkOrder(workOrderId).find((r) => r.status === "completed");
    if (existingCompleted) {
      throw new DuplicateDeliveryError(workOrderId, existingCompleted.delivery_report_id);
    }

    // Throws ExecutionLockAlreadyHeldError if another execution already
    // holds a non-stale lock — this is what makes "no previous transport
    // record proves it is currently in progress" (§4) true without a new
    // Bridge Transport record type: the lock itself is the one and only
    // "currently in progress" signal this milestone needs.
    const lockHandle = lock.acquire(workOrderId);

    try {
      let runnerResult = null;
      let runnerFailure = null;
      try {
        const rawResult = await runnerAdapter.executeWorkOrder({
          workOrder,
          repository: { startingCommit: currentGitState.commit },
          executionPolicy,
        });
        runnerResult = assertValidRunnerResult(rawResult, workOrderId);
      } catch (cause) {
        runnerFailure = cause;
      }

      const postGitState = readGitState(executionPolicy.repositoryPath, runGit);
      const committedSomething = postGitState.commit !== currentGitState.commit;
      const commit = committedSomething ? postGitState.commit : null;
      const { filesCreated, filesModified } = computeChangedFiles(executionPolicy.repositoryPath, currentGitState.commit, postGitState.commit, runGit);
      const upstreamCommit = executionPolicy.allowPush ? readUpstreamCommit(executionPolicy.repositoryPath, runGit) : null;
      const pushStatus = derivePushStatus({ executionPolicy, upstreamCommit, commit });

      const deliveryReport = runnerFailure
        ? createEngineeringDeliveryReport(
            {
              workOrderId,
              milestone: workOrder.milestone,
              status: committedSomething ? "partial" : "failed",
              commit,
              pushStatus,
              workingTree: postGitState.workingTreeClean ? "clean" : "dirty",
              tests: { passed: 0, failed: 0, total: 0 },
              fixtures: { passed: 0, failed: 0, total: 0 },
              filesCreated,
              filesModified,
              repositoryFindings: [`Runner execution failed before returning a result: ${runnerFailure.message}`],
              compatibility: [],
              liveRequests: { occurred: false, details: null },
              followUpRequired: ["Delivery did not complete — Strategy Office review required before any further automated execution of this Work Order."],
              notes: null,
            },
            options
          )
        : createEngineeringDeliveryReport(
            {
              workOrderId,
              milestone: workOrder.milestone,
              status: deriveDeliveryStatus({ runnerResult, postGitState, executionPolicy, committedSomething, pushStatus }),
              commit,
              pushStatus,
              workingTree: postGitState.workingTreeClean ? "clean" : "dirty",
              tests: runnerResult.verification.testsSummary,
              fixtures: runnerResult.verification.fixturesSummary,
              filesCreated,
              filesModified,
              repositoryFindings: buildRepositoryFindings({ runnerResult, postGitState, executionPolicy, pushStatus }),
              compatibility: [],
              liveRequests: executionPolicy.prohibitLiveExternalCalls
                ? { occurred: false, details: null }
                : { occurred: true, details: "prohibitLiveExternalCalls was disabled by policy for this execution — occurrence is not independently verifiable" },
              followUpRequired:
                runnerResult.status === "completed" && committedSomething && postGitState.workingTreeClean
                  ? []
                  : ["Delivery did not reach a fully completed, independently-verified state — Strategy Office review required before any further automated execution of this Work Order."],
              notes: null,
            },
            options
          );

      mkdirSync(deliveryReportDropDir, { recursive: true });
      const dropPath = path.join(deliveryReportDropDir, `${deliveryReport.delivery_report_id}.json`);
      writeFileSync(dropPath, JSON.stringify(deliveryReport), "utf-8");

      const transportResult = await importDeliveryReport(
        { sourcePath: dropPath },
        { deliveryReportStore, transportStore, adapter: transportAdapter, now, rootDir: options.rootDir, validator: options.validator }
      );

      return {
        workOrderId,
        deliveryReportId: deliveryReport.delivery_report_id,
        status: deliveryReport.status,
        commit: deliveryReport.commit,
        transportRecordId: transportResult.transportRecordId,
      };
    } finally {
      lock.release(workOrderId, lockHandle.lockToken);
    }
  }

  /** Read-only. Work Order + its Delivery Reports + current lock state — for the CLI's `status` subcommand and Control Centre's Delivery Office section. */
  function getExecutionStatus(workOrderId) {
    const workOrder = workOrderStore.get(workOrderId);
    const deliveryReports = deliveryReportStore.findByWorkOrder(workOrderId);
    const lockInfo = lock.inspect(workOrderId);
    return { workOrder, deliveryReports, lock: lockInfo };
  }

  return { executeApprovedWorkOrder, getExecutionStatus };
}

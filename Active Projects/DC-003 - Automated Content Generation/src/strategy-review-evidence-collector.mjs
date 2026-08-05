// DC-003-I029.3 — Strategy Review Evidence Collector: assembles one
// bounded, provider-neutral evidence package for one Work Order +
// Delivery Report pair. Reuses I029.2's own repository-git-evidence.mjs
// helpers unmodified — no duplicated git-inspection logic.
//
// Never relies solely on the Delivery Report for facts this collector can
// independently check itself: branch, commit, working-tree cleanliness,
// upstream/push state, changed-file scope, unresolved merge conflicts,
// and (best-effort) whether the Work Order's own starting commit is still
// a real ancestor of the current commit (a non-fast-forward history
// rewrite signature) are ALL re-derived from a live `git` inspection at
// review time — the repository can have moved since the delivery was
// recorded. Test/fixture evidence is the one deliberate exception: a
// fresh re-run is expensive (this project's own test suite takes ~2
// minutes even in Docker) and is therefore POLICY-gated
// (policy.rerunTests/rerunFixtures), not automatic — when not rerun, the
// Delivery Report's own self-reported counts are used, but every such
// evidence entry is labelled `source: "delivery-report"` (never
// "independent-verification") so the distinction is never lost or
// silently upgraded.

import { readGitState, readUpstreamCommit, computeChangedFiles, isAncestorCommit, defaultRunGit } from "./repository-git-evidence.mjs";
import { EvidenceRelationshipMismatchError } from "./strategy-review-errors.mjs";

const CREDENTIAL_FILENAME_PATTERN = /(^|\/)(\.env(\..+)?|.*\.pem|.*\.key|id_rsa.*|.*credentials.*|.*secret.*)$/i;
const INFRASTRUCTURE_PATH_PATTERN = /(^|\/)(Dockerfile|docker-compose.*\.ya?ml|\.github\/workflows\/.*)$/i;
const ARCHITECTURE_SENSITIVE_PATTERN = /(^|\/)(schemas\/.*\.json|src\/execution-policy\.mjs|src\/delivery-execution-lock\.mjs|src\/strategy-review-policy\.mjs|src\/strategy-review-lock\.mjs|package\.json)$/i;

const MAX_FILE_LIST_LENGTH = 200;

function boundedList(list) {
  if (list.length <= MAX_FILE_LIST_LENGTH) return { items: list, truncated: false };
  return { items: list.slice(0, MAX_FILE_LIST_LENGTH), truncated: true };
}

function countSummaryFrom(counts, source) {
  return {
    status: counts.failed === 0 && counts.total > 0 ? "passed" : "failed",
    passed: counts.passed,
    failed: counts.failed,
    total: counts.total,
    source,
  };
}

/**
 * Collects independent Strategy Review evidence for one Work Order +
 * Delivery Report pair.
 *
 * fields.workOrder — required, a real Engineering Work Order.
 * fields.deliveryReport — required, a real Engineering Delivery Report.
 * fields.transportStore — optional, a Bridge Transport Store (best-effort
 *   only — a read failure here never fails evidence collection).
 * fields.policy — required, a Strategy Review Policy.
 *
 * options.runGit / runTests / runFixtures — injectable (tests).
 * options.runTests()/runFixtures() — only ever called when
 *   policy.rerunTests/rerunFixtures is true; must return
 *   { passed, failed, total }.
 *
 * Throws EvidenceRelationshipMismatchError if the Delivery Report does
 * not reference the supplied Work Order. Never throws for an
 * uninspectable repository — that is represented as
 * `repository.verifiable: false` in the returned package, a fact for the
 * caller's own authority gates to act on.
 */
export function collectStrategyReviewEvidence(fields = {}, options = {}) {
  const { workOrder, deliveryReport, transportStore = null, policy } = fields;
  const runGit = options.runGit ?? defaultRunGit;

  if (deliveryReport.work_order_id !== workOrder.work_order_id) {
    throw new EvidenceRelationshipMismatchError(workOrder.work_order_id, deliveryReport.delivery_report_id);
  }

  let gitState;
  let verifiable = true;
  try {
    gitState = readGitState(policy.repositoryPath, runGit);
  } catch {
    verifiable = false;
    gitState = { commit: null, branch: null, workingTreeClean: false, untrackedFiles: [], conflictedFiles: [] };
  }

  const startingCommit = workOrder.repository_commit;
  const endingCommit = verifiable ? gitState.commit : null;

  const { filesCreated, filesModified } = verifiable ? computeChangedFiles(policy.repositoryPath, startingCommit, endingCommit, runGit) : { filesCreated: [], filesModified: [] };

  const possibleHistoryRewrite = verifiable && startingCommit && endingCommit ? !isAncestorCommit(policy.repositoryPath, startingCommit, endingCommit, runGit) : false;

  const upstreamCommit = verifiable ? readUpstreamCommit(policy.repositoryPath, runGit) : null;
  const pushStatus = !verifiable ? "unknown" : upstreamCommit === null ? "unknown" : upstreamCommit === endingCommit ? "pushed" : "not_pushed";

  const allTouchedFiles = [...filesCreated, ...filesModified, ...gitState.untrackedFiles];
  const credentialFilesDetected = allTouchedFiles.filter((f) => CREDENTIAL_FILENAME_PATTERN.test(f));
  const infrastructureFilesChanged = allTouchedFiles.filter((f) => INFRASTRUCTURE_PATH_PATTERN.test(f));
  const architectureSensitiveFilesChanged = allTouchedFiles.filter((f) => ARCHITECTURE_SENSITIVE_PATTERN.test(f));

  let tests;
  if (policy.rerunTests && typeof options.runTests === "function") {
    tests = countSummaryFrom(options.runTests(), "independent-verification");
  } else {
    tests = countSummaryFrom(deliveryReport.tests, "delivery-report");
  }

  let fixtures;
  if (policy.rerunFixtures && typeof options.runFixtures === "function") {
    fixtures = countSummaryFrom(options.runFixtures(), "independent-verification");
  } else {
    fixtures = countSummaryFrom(deliveryReport.fixtures, "delivery-report");
  }

  let transportHistoryCount = null;
  if (transportStore) {
    try {
      transportHistoryCount = transportStore.findByObject(workOrder.work_order_id).length + transportStore.findByObject(deliveryReport.delivery_report_id).length;
    } catch {
      transportHistoryCount = null;
    }
  }

  const boundedCreated = boundedList(filesCreated);
  const boundedModified = boundedList(filesModified);
  const boundedUntracked = boundedList(gitState.untrackedFiles);

  return {
    workOrderId: workOrder.work_order_id,
    deliveryReportId: deliveryReport.delivery_report_id,
    repository: {
      startingCommit,
      endingCommit,
      branch: gitState.branch,
      workingTreeClean: gitState.workingTreeClean,
      pushStatus,
      verifiable,
    },
    filesCreated: boundedCreated.items,
    filesCreatedTruncated: boundedCreated.truncated,
    filesModified: boundedModified.items,
    filesModifiedTruncated: boundedModified.truncated,
    untrackedFiles: boundedUntracked.items,
    untrackedFilesTruncated: boundedUntracked.truncated,
    hasUnresolvedConflict: gitState.conflictedFiles.length > 0,
    possibleHistoryRewrite,
    credentialFilesDetected,
    infrastructureFilesChanged,
    architectureSensitiveFilesChanged,
    tests,
    fixtures,
    deliveryReportLiveRequestsOccurred: deliveryReport.live_requests.occurred,
    deliveryReportStatus: deliveryReport.status,
    transportHistoryCount,
  };
}

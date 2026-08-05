import test from "node:test";
import assert from "node:assert/strict";
import { collectStrategyReviewEvidence } from "../../src/strategy-review-evidence-collector.mjs";
import { createStrategyReviewPolicy } from "../../src/strategy-review-policy.mjs";
import { EvidenceRelationshipMismatchError } from "../../src/strategy-review-errors.mjs";

const WORK_ORDER = { work_order_id: "wo_evidencetest0001", repository_commit: "aaa1111" };
const DELIVERY_REPORT = {
  work_order_id: "wo_evidencetest0001",
  delivery_report_id: "dr_evidencetest0001",
  status: "completed",
  tests: { passed: 10, failed: 0, total: 10 },
  fixtures: { passed: 5, failed: 0, total: 5 },
  live_requests: { occurred: false, details: null },
};
const POLICY = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main" });

function fakeRunGit({ commit = "bbb2222", branch = "main", statusLines = [], diffLines = [], upstream = "__NONE__" } = {}) {
  return (args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") return commit;
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return branch;
    if (args[0] === "status") return statusLines.join("\n");
    if (args[0] === "rev-parse" && args[1] === "@{u}") {
      if (upstream === "__NONE__") throw new Error("no upstream");
      return upstream;
    }
    if (args[0] === "diff") return diffLines.join("\n");
    if (args[0] === "merge-base") return "";
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
}

test("collectStrategyReviewEvidence(): throws EvidenceRelationshipMismatchError for a mismatched pair", () => {
  const mismatched = { ...DELIVERY_REPORT, work_order_id: "wo_someoneelse0001" };
  assert.throws(
    () => collectStrategyReviewEvidence({ workOrder: WORK_ORDER, deliveryReport: mismatched, policy: POLICY }, { runGit: fakeRunGit() }),
    EvidenceRelationshipMismatchError
  );
});

test("collectStrategyReviewEvidence(): a healthy repository produces verifiable=true, clean tree, no risk flags", () => {
  const evidence = collectStrategyReviewEvidence({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, policy: POLICY }, { runGit: fakeRunGit() });
  assert.equal(evidence.repository.verifiable, true);
  assert.equal(evidence.repository.workingTreeClean, true);
  assert.equal(evidence.hasUnresolvedConflict, false);
  assert.equal(evidence.credentialFilesDetected.length, 0);
});

test("collectStrategyReviewEvidence(): a totally unreachable repository degrades to verifiable=false, never throws", () => {
  const runGit = () => {
    throw new Error("not a git repository");
  };
  const evidence = collectStrategyReviewEvidence({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, policy: POLICY }, { runGit });
  assert.equal(evidence.repository.verifiable, false);
  assert.equal(evidence.repository.endingCommit, null);
});

test("collectStrategyReviewEvidence(): detects unresolved conflict markers", () => {
  const evidence = collectStrategyReviewEvidence(
    { workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, policy: POLICY },
    { runGit: fakeRunGit({ statusLines: ["UU conflicted.mjs"] }) }
  );
  assert.equal(evidence.hasUnresolvedConflict, true);
});

test("collectStrategyReviewEvidence(): detects credential-shaped untracked files", () => {
  const evidence = collectStrategyReviewEvidence(
    { workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, policy: POLICY },
    { runGit: fakeRunGit({ statusLines: ["?? .env"] }) }
  );
  assert.deepEqual(evidence.credentialFilesDetected, [".env"]);
});

test("collectStrategyReviewEvidence(): detects infrastructure and architecture-sensitive changed files", () => {
  const evidence = collectStrategyReviewEvidence(
    { workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, policy: POLICY },
    { runGit: fakeRunGit({ diffLines: ["A\tDockerfile", "M\tschemas/foo.schema.json"] }) }
  );
  assert.deepEqual(evidence.infrastructureFilesChanged, ["Dockerfile"]);
  assert.deepEqual(evidence.architectureSensitiveFilesChanged, ["schemas/foo.schema.json"]);
});

test("collectStrategyReviewEvidence(): tests/fixtures come from the Delivery Report by default, labelled 'delivery-report'", () => {
  const evidence = collectStrategyReviewEvidence({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, policy: POLICY }, { runGit: fakeRunGit() });
  assert.equal(evidence.tests.source, "delivery-report");
  assert.equal(evidence.tests.passed, 10);
});

test("collectStrategyReviewEvidence(): policy.rerunTests=true uses the injected runTests() instead, labelled 'independent-verification'", () => {
  const policy = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main", rerunTests: true });
  const evidence = collectStrategyReviewEvidence(
    { workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, policy },
    { runGit: fakeRunGit(), runTests: () => ({ passed: 1, failed: 1, total: 2 }) }
  );
  assert.equal(evidence.tests.source, "independent-verification");
  assert.equal(evidence.tests.status, "failed");
});

test("collectStrategyReviewEvidence(): reports pushStatus 'pushed' when the upstream matches the ending commit", () => {
  const evidence = collectStrategyReviewEvidence(
    { workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, policy: POLICY },
    { runGit: fakeRunGit({ commit: "bbb2222", upstream: "bbb2222" }) }
  );
  assert.equal(evidence.repository.pushStatus, "pushed");
});

test("collectStrategyReviewEvidence(): reports pushStatus 'unknown' when no upstream is configured", () => {
  const evidence = collectStrategyReviewEvidence({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, policy: POLICY }, { runGit: fakeRunGit() });
  assert.equal(evidence.repository.pushStatus, "unknown");
});

test("collectStrategyReviewEvidence(): passes through the Delivery Report's own live_requests.occurred flag", () => {
  const withLiveRequest = { ...DELIVERY_REPORT, live_requests: { occurred: true, details: "x" } };
  const evidence = collectStrategyReviewEvidence({ workOrder: WORK_ORDER, deliveryReport: withLiveRequest, policy: POLICY }, { runGit: fakeRunGit() });
  assert.equal(evidence.deliveryReportLiveRequestsOccurred, true);
});

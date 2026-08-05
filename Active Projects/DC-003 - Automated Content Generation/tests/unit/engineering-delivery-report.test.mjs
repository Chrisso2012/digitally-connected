import test from "node:test";
import assert from "node:assert/strict";
import { createEngineeringDeliveryReport } from "../../src/engineering-delivery-report.mjs";
import { InvalidEngineeringDeliveryReportInputError, EngineeringDeliveryReportValidationError } from "../../src/engineering-delivery-report-errors.mjs";

function baseFields(overrides = {}) {
  return {
    workOrderId: "wo_test0000000001",
    milestone: "DC-003-I029",
    status: "completed",
    commit: "7d88509",
    pushStatus: "pushed",
    workingTree: "clean",
    tests: { passed: 100, failed: 0, total: 100 },
    fixtures: { passed: 10, failed: 0, total: 10 },
    liveRequests: { occurred: false, details: null },
    ...overrides,
  };
}

test("builds a valid, immutable completed Delivery Report with sensible defaults", () => {
  const report = createEngineeringDeliveryReport(baseFields(), { idGenerator: () => "dr_test0000000001", now: () => "2026-08-05T12:00:00.000Z" });
  assert.equal(report.delivery_report_id, "dr_test0000000001");
  assert.equal(report.delivery_timestamp, "2026-08-05T12:00:00.000Z");
  assert.deepEqual(report.files_created, []);
  assert.deepEqual(report.files_modified, []);
  assert.deepEqual(report.repository_findings, []);
  assert.deepEqual(report.compatibility, []);
  assert.deepEqual(report.follow_up_required, []);
  assert.equal(report.notes, null);
  assert.throws(() => {
    report.status = "failed";
  }, TypeError);
});

test("a 'completed' report requires a real commit and pushed/not_applicable push_status", () => {
  assert.throws(() => createEngineeringDeliveryReport(baseFields({ commit: null })), InvalidEngineeringDeliveryReportInputError);
  assert.throws(() => createEngineeringDeliveryReport(baseFields({ pushStatus: "not_pushed" })), InvalidEngineeringDeliveryReportInputError);
  const report = createEngineeringDeliveryReport(baseFields({ pushStatus: "not_applicable" }), { idGenerator: () => "dr_test0000000002" });
  assert.equal(report.push_status, "not_applicable");
});

test("a 'failed' report allows a null commit and any push_status", () => {
  const report = createEngineeringDeliveryReport(baseFields({ status: "failed", commit: null, pushStatus: "not_pushed" }), {
    idGenerator: () => "dr_test0000000003",
  });
  assert.equal(report.commit, null);
  assert.equal(report.status, "failed");
});

test("a 'partial' report allows a real commit alongside an incomplete outcome", () => {
  const report = createEngineeringDeliveryReport(baseFields({ status: "partial", pushStatus: "pushed" }), {
    idGenerator: () => "dr_test0000000004",
  });
  assert.equal(report.status, "partial");
});

test("rejects an invalid workOrderId / milestone / status / workingTree", () => {
  assert.throws(() => createEngineeringDeliveryReport(baseFields({ workOrderId: "not-a-real-id" })), InvalidEngineeringDeliveryReportInputError);
  assert.throws(() => createEngineeringDeliveryReport(baseFields({ milestone: "I029" })), InvalidEngineeringDeliveryReportInputError);
  assert.throws(() => createEngineeringDeliveryReport(baseFields({ status: "bogus" })), InvalidEngineeringDeliveryReportInputError);
  assert.throws(() => createEngineeringDeliveryReport(baseFields({ workingTree: "messy" })), InvalidEngineeringDeliveryReportInputError);
});

test("rejects malformed tests/fixtures count summaries", () => {
  assert.throws(() => createEngineeringDeliveryReport(baseFields({ tests: { passed: -1, failed: 0, total: 0 } })), InvalidEngineeringDeliveryReportInputError);
  assert.throws(() => createEngineeringDeliveryReport(baseFields({ fixtures: null })), InvalidEngineeringDeliveryReportInputError);
});

test("rejects a liveRequests object missing occurred", () => {
  assert.throws(() => createEngineeringDeliveryReport(baseFields({ liveRequests: { details: null } })), InvalidEngineeringDeliveryReportInputError);
});

test("preserves files_created/files_modified/repository_findings arrays verbatim", () => {
  const report = createEngineeringDeliveryReport(
    baseFields({
      filesCreated: ["src/a.mjs", "src/b.mjs"],
      filesModified: ["README.md"],
      repositoryFindings: ["no prior structured object existed"],
      compatibility: ["I015 unchanged"],
      followUpRequired: ["future bridge layer"],
    }),
    { idGenerator: () => "dr_test0000000005" }
  );
  assert.deepEqual(report.files_created, ["src/a.mjs", "src/b.mjs"]);
  assert.deepEqual(report.files_modified, ["README.md"]);
  assert.deepEqual(report.repository_findings, ["no prior structured object existed"]);
  assert.deepEqual(report.compatibility, ["I015 unchanged"]);
  assert.deepEqual(report.follow_up_required, ["future bridge layer"]);
});

test("does not mutate the supplied fields object", () => {
  const fields = baseFields();
  const before = JSON.stringify(fields);
  createEngineeringDeliveryReport(fields, { idGenerator: () => "dr_test0000000006" });
  assert.equal(JSON.stringify(fields), before);
});

test("throws EngineeringDeliveryReportValidationError if a caller-supplied idGenerator produces a malformed id", () => {
  assert.throws(() => createEngineeringDeliveryReport(baseFields(), { idGenerator: () => "not-a-real-id" }), EngineeringDeliveryReportValidationError);
});

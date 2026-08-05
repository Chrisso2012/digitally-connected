import test from "node:test";
import assert from "node:assert/strict";
import { createEngineeringWorkOrder } from "../../src/engineering-work-order.mjs";
import { InvalidEngineeringWorkOrderInputError, EngineeringWorkOrderValidationError } from "../../src/engineering-work-order-errors.mjs";

function baseFields(overrides = {}) {
  return {
    milestone: "DC-003-I029",
    title: "Engineering Work Management",
    objective: "Formalise Strategy Office <-> Delivery Office communication.",
    reviewCriteria: ["Immutable objects", "Read-only Control Centre"],
    ...overrides,
  };
}

test("builds a valid, immutable draft Work Order with sensible defaults", () => {
  const workOrder = createEngineeringWorkOrder(baseFields(), { idGenerator: () => "wo_test0000000001", now: () => "2026-08-05T00:00:00.000Z" });
  assert.equal(workOrder.work_order_id, "wo_test0000000001");
  assert.equal(workOrder.status, "draft");
  assert.equal(workOrder.approved_at, null);
  assert.equal(workOrder.priority, "medium");
  assert.deepEqual(workOrder.constraints, []);
  assert.deepEqual(workOrder.dependencies, []);
  assert.equal(workOrder.repository_commit, null);
  assert.equal(workOrder.notes, null);
  assert.throws(() => {
    workOrder.status = "approved";
  }, TypeError);
});

test("a 'ready' Work Order requires approvedAt", () => {
  assert.throws(() => createEngineeringWorkOrder(baseFields({ status: "ready" })), InvalidEngineeringWorkOrderInputError);
  const workOrder = createEngineeringWorkOrder(baseFields({ status: "ready", approvedAt: "2026-08-05T00:05:00.000Z" }), {
    idGenerator: () => "wo_test0000000002",
  });
  assert.equal(workOrder.status, "ready");
  assert.equal(workOrder.approved_at, "2026-08-05T00:05:00.000Z");
});

test("a 'draft' Work Order rejects an explicit approvedAt", () => {
  assert.throws(
    () => createEngineeringWorkOrder(baseFields({ status: "draft", approvedAt: "2026-08-05T00:05:00.000Z" })),
    InvalidEngineeringWorkOrderInputError
  );
});

test("the factory accepts every schema status (draft/ready/in_progress/completed/approved/archived) — CLI-level restriction is not enforced here", () => {
  for (const status of ["in_progress", "completed", "approved", "archived"]) {
    const workOrder = createEngineeringWorkOrder(baseFields({ status, approvedAt: "2026-08-05T00:05:00.000Z" }), {
      idGenerator: () => "wo_test0000000003",
    });
    assert.equal(workOrder.status, status);
  }
});

test("rejects a malformed milestone", () => {
  assert.throws(() => createEngineeringWorkOrder(baseFields({ milestone: "I029" })), InvalidEngineeringWorkOrderInputError);
  assert.doesNotThrow(() => createEngineeringWorkOrder(baseFields({ milestone: "DC-003-I029" }), { idGenerator: () => "wo_test0000000008" }));
});

test("accepts a dotted sub-milestone (e.g. DC-003-I019.1)", () => {
  const workOrder = createEngineeringWorkOrder(baseFields({ milestone: "DC-003-I019.1" }), { idGenerator: () => "wo_test0000000004" });
  assert.equal(workOrder.milestone, "DC-003-I019.1");
});

test("rejects an empty title/objective", () => {
  assert.throws(() => createEngineeringWorkOrder(baseFields({ title: "" })), InvalidEngineeringWorkOrderInputError);
  assert.throws(() => createEngineeringWorkOrder(baseFields({ objective: "" })), InvalidEngineeringWorkOrderInputError);
});

test("requires at least one review criterion", () => {
  assert.throws(() => createEngineeringWorkOrder(baseFields({ reviewCriteria: [] })), InvalidEngineeringWorkOrderInputError);
});

test("rejects a malformed repositoryCommit but allows null", () => {
  assert.throws(() => createEngineeringWorkOrder(baseFields({ repositoryCommit: "not-hex!!" })), InvalidEngineeringWorkOrderInputError);
  const workOrder = createEngineeringWorkOrder(baseFields({ repositoryCommit: null }), { idGenerator: () => "wo_test0000000005" });
  assert.equal(workOrder.repository_commit, null);
});

test("rejects an invalid status/priority", () => {
  assert.throws(() => createEngineeringWorkOrder(baseFields({ status: "bogus" })), InvalidEngineeringWorkOrderInputError);
  assert.throws(() => createEngineeringWorkOrder(baseFields({ priority: "urgent" })), InvalidEngineeringWorkOrderInputError);
});

test("rejects a malformed dependency identifier", () => {
  assert.throws(() => createEngineeringWorkOrder(baseFields({ dependencies: ["not-a-wo-id"] })), InvalidEngineeringWorkOrderInputError);
  const workOrder = createEngineeringWorkOrder(baseFields({ dependencies: ["wo_abc123"] }), { idGenerator: () => "wo_test0000000006" });
  assert.deepEqual(workOrder.dependencies, ["wo_abc123"]);
});

test("does not mutate the supplied fields object", () => {
  const fields = baseFields();
  const before = JSON.stringify(fields);
  createEngineeringWorkOrder(fields, { idGenerator: () => "wo_test0000000007" });
  assert.equal(JSON.stringify(fields), before);
});

test("throws EngineeringWorkOrderValidationError if a caller-supplied idGenerator produces a malformed id", () => {
  assert.throws(() => createEngineeringWorkOrder(baseFields(), { idGenerator: () => "not-a-real-id" }), EngineeringWorkOrderValidationError);
});

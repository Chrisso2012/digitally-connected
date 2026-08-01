import test from "node:test";
import assert from "node:assert/strict";
import { createInvocationResponse } from "../../src/invocation-response.mjs";
import { InvocationResponseValidationError } from "../../src/invocation-errors.mjs";

test("builds a well-formed, immutable rejected response with every optional field defaulted", () => {
  const response = createInvocationResponse({ accepted: false, status: "rejected" });
  assert.deepEqual(response, {
    accepted: false,
    request_id: null,
    execution_id: null,
    status: "rejected",
    finished_carousel: null,
    warnings: [],
    error: null,
    correlation_metadata: null,
  });
  assert.throws(() => {
    response.accepted = true;
  }, TypeError);
});

test("builds a well-formed completed response with explicit fields", () => {
  const finishedCarouselStub = { carousel_id: "car_1", overall_status: "completed" };
  const response = createInvocationResponse({
    accepted: true,
    request_id: "req-1",
    execution_id: "exec_20260801_9f3a2e1c8b4d",
    status: "completed",
    finished_carousel: finishedCarouselStub,
    warnings: ["w1"],
    correlation_metadata: { source: "n8n" },
  });
  assert.equal(response.execution_id, "exec_20260801_9f3a2e1c8b4d");
  assert.deepEqual(response.finished_carousel, finishedCarouselStub);
  assert.deepEqual(response.warnings, ["w1"]);
});

test("throws InvocationResponseValidationError for an invalid status", () => {
  assert.throws(() => createInvocationResponse({ accepted: true, status: "not-a-real-status" }), InvocationResponseValidationError);
});

test("throws InvocationResponseValidationError for an execution_id not matching the documented pattern", () => {
  assert.throws(
    () => createInvocationResponse({ accepted: true, status: "completed", execution_id: "not-a-valid-id" }),
    InvocationResponseValidationError
  );
});

test("throws InvocationResponseValidationError for an error object missing a required field", () => {
  assert.throws(
    () => createInvocationResponse({ accepted: true, status: "failed", error: { code: "X" } }),
    InvocationResponseValidationError
  );
});

test("throws InvocationResponseValidationError for an error object with an extra, non-allowlisted field", () => {
  assert.throws(
    () =>
      createInvocationResponse({
        accepted: true,
        status: "failed",
        error: { code: "X", message: "m", retryable: false, stack: "leaked stack trace" },
      }),
    InvocationResponseValidationError
  );
});

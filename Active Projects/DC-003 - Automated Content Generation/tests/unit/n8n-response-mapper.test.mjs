import test from "node:test";
import assert from "node:assert/strict";
import { mapInvocationResponseToN8nOutput } from "../../src/n8n-response-mapper.mjs";

function baseInvocationResponse(overrides = {}) {
  return {
    accepted: true,
    request_id: "req-1",
    execution_id: "exec_20260801_9f3a2e1c8b4d",
    status: "completed",
    finished_carousel: { carousel_id: "car_1", overall_status: "completed" },
    warnings: [],
    error: null,
    correlation_metadata: { workflow: "daily" },
    ...overrides,
  };
}

test("maps a completed response with success true", () => {
  const output = mapInvocationResponseToN8nOutput(baseInvocationResponse());
  assert.deepEqual(output, {
    success: true,
    executionId: "exec_20260801_9f3a2e1c8b4d",
    requestId: "req-1",
    status: "completed",
    finishedCarousel: { carousel_id: "car_1", overall_status: "completed" },
    warnings: [],
    error: null,
  });
});

test("only exposes the seven documented fields — no correlation_metadata, no internal fields", () => {
  const output = mapInvocationResponseToN8nOutput(baseInvocationResponse());
  assert.deepEqual(Object.keys(output).sort(), [
    "error",
    "executionId",
    "finishedCarousel",
    "requestId",
    "status",
    "success",
    "warnings",
  ]);
});

test("success is false for a failed (but accepted) response — accepted alone is not success", () => {
  const output = mapInvocationResponseToN8nOutput(
    baseInvocationResponse({
      status: "failed",
      finished_carousel: null,
      error: { code: "TopicPackageNotFoundError", message: "Topic Package file not found", retryable: false },
    })
  );
  assert.equal(output.success, false);
  assert.equal(output.status, "failed");
  assert.deepEqual(output.error, { code: "TopicPackageNotFoundError", message: "Topic Package file not found", retryable: false });
});

test("success is false for a rejected response", () => {
  const output = mapInvocationResponseToN8nOutput(
    baseInvocationResponse({
      accepted: false,
      execution_id: null,
      status: "rejected",
      finished_carousel: null,
      error: { code: "InvocationRequestValidationError", message: "bad request", retryable: false },
    })
  );
  assert.equal(output.success, false);
  assert.equal(output.executionId, null);
});

test("warnings are passed through unchanged", () => {
  const output = mapInvocationResponseToN8nOutput(baseInvocationResponse({ warnings: ["w1", "w2"] }));
  assert.deepEqual(output.warnings, ["w1", "w2"]);
});

test("mapping is deterministic — the same input always produces the same output", () => {
  const response = baseInvocationResponse();
  const first = mapInvocationResponseToN8nOutput(response);
  const second = mapInvocationResponseToN8nOutput(response);
  assert.deepEqual(first, second);
});

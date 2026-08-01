import test from "node:test";
import assert from "node:assert/strict";
import { prepareInvocationRequest } from "../../src/invocation-request.mjs";
import { InvocationRequestValidationError } from "../../src/invocation-errors.mjs";

function baseRequest(overrides = {}) {
  return {
    request_id: "n8n-exec-1",
    topic_package_reference: { file_path: "tests/fixtures/topic-package.example.json" },
    ...overrides,
  };
}

test("a well-formed request with file_path is accepted and returned immutable", () => {
  const request = prepareInvocationRequest(baseRequest());
  assert.equal(request.request_id, "n8n-exec-1");
  assert.throws(() => {
    request.request_id = "tampered";
  }, TypeError);
});

test("a well-formed request with data is accepted", () => {
  const request = prepareInvocationRequest(
    baseRequest({ topic_package_reference: { data: { topic_id: "topic_1" } } })
  );
  assert.deepEqual(request.topic_package_reference, { data: { topic_id: "topic_1" } });
});

test("execution_options and correlation_metadata default is preserved when explicitly null", () => {
  const request = prepareInvocationRequest(baseRequest({ execution_options: null, correlation_metadata: null }));
  assert.equal(request.execution_options, null);
  assert.equal(request.correlation_metadata, null);
});

test("correlation_metadata is stored unchanged, opaque, regardless of shape", () => {
  const metadata = { anything: "goes", nested: { a: 1 } };
  const request = prepareInvocationRequest(baseRequest({ correlation_metadata: metadata }));
  assert.deepEqual(request.correlation_metadata, metadata);
});

test("throws InvocationRequestValidationError for a missing request_id", () => {
  const request = baseRequest();
  delete request.request_id;
  assert.throws(() => prepareInvocationRequest(request), InvocationRequestValidationError);
});

test("throws InvocationRequestValidationError for a missing topic_package_reference", () => {
  const request = baseRequest();
  delete request.topic_package_reference;
  assert.throws(() => prepareInvocationRequest(request), InvocationRequestValidationError);
});

test("throws InvocationRequestValidationError when topic_package_reference has neither file_path nor data", () => {
  assert.throws(
    () => prepareInvocationRequest(baseRequest({ topic_package_reference: {} })),
    InvocationRequestValidationError
  );
});

test("throws InvocationRequestValidationError when topic_package_reference has both file_path and data", () => {
  assert.throws(
    () =>
      prepareInvocationRequest(
        baseRequest({ topic_package_reference: { file_path: "x.json", data: { topic_id: "topic_1" } } })
      ),
    InvocationRequestValidationError
  );
});

test("throws InvocationRequestValidationError for an empty request_id", () => {
  assert.throws(() => prepareInvocationRequest(baseRequest({ request_id: "" })), InvocationRequestValidationError);
});

test("throws InvocationRequestValidationError for an unknown top-level field", () => {
  assert.throws(() => prepareInvocationRequest(baseRequest({ unexpected_field: true })), InvocationRequestValidationError);
});

test("the validation error's .errors carries structured detail, never a bare message", () => {
  try {
    prepareInvocationRequest({});
    assert.fail("expected to throw");
  } catch (error) {
    assert.ok(error instanceof InvocationRequestValidationError);
    assert.ok(Array.isArray(error.errors));
    assert.ok(error.errors.length > 0);
    assert.equal(typeof error.errors[0].path, "string");
    assert.equal(typeof error.errors[0].message, "string");
  }
});

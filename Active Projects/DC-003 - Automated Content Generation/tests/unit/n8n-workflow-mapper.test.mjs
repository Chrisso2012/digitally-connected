import test from "node:test";
import assert from "node:assert/strict";
import { mapWorkflowInputToInvocationRequest } from "../../src/n8n-workflow-mapper.mjs";

test("maps a file_path-based workflow input to the InvocationRequest shape", () => {
  const mapped = mapWorkflowInputToInvocationRequest({
    requestId: "wf-1",
    topicPackageFilePath: "tests/fixtures/topic-package.example.json",
  });
  assert.deepEqual(mapped, {
    request_id: "wf-1",
    topic_package_reference: { file_path: "tests/fixtures/topic-package.example.json" },
    execution_options: null,
    correlation_metadata: null,
  });
});

test("maps a data-based workflow input to the InvocationRequest shape", () => {
  const data = { topic_id: "topic_1" };
  const mapped = mapWorkflowInputToInvocationRequest({ requestId: "wf-2", topicPackageData: data });
  assert.deepEqual(mapped.topic_package_reference, { data });
});

test("maps executionOptions and correlationMetadata through unchanged", () => {
  const mapped = mapWorkflowInputToInvocationRequest({
    requestId: "wf-3",
    topicPackageFilePath: "x.json",
    executionOptions: { future: "reserved" },
    correlationMetadata: { workflow: "daily" },
  });
  assert.deepEqual(mapped.execution_options, { future: "reserved" });
  assert.deepEqual(mapped.correlation_metadata, { workflow: "daily" });
});

test("omitted executionOptions/correlationMetadata default to null", () => {
  const mapped = mapWorkflowInputToInvocationRequest({ requestId: "wf-4", topicPackageFilePath: "x.json" });
  assert.equal(mapped.execution_options, null);
  assert.equal(mapped.correlation_metadata, null);
});

test("does not validate — a missing requestId maps through as undefined, not rejected here", () => {
  const mapped = mapWorkflowInputToInvocationRequest({ topicPackageFilePath: "x.json" });
  assert.equal(mapped.request_id, undefined);
});

test("does not validate — both file_path and data present both pass through, to be rejected downstream", () => {
  const mapped = mapWorkflowInputToInvocationRequest({
    requestId: "wf-5",
    topicPackageFilePath: "x.json",
    topicPackageData: { topic_id: "topic_1" },
  });
  assert.deepEqual(mapped.topic_package_reference, { file_path: "x.json", data: { topic_id: "topic_1" } });
});

test("neither file_path nor data present produces an empty reference object, not a thrown error", () => {
  const mapped = mapWorkflowInputToInvocationRequest({ requestId: "wf-6" });
  assert.deepEqual(mapped.topic_package_reference, {});
});

test("never throws for garbage input (null, undefined, a primitive)", () => {
  assert.doesNotThrow(() => mapWorkflowInputToInvocationRequest(null));
  assert.doesNotThrow(() => mapWorkflowInputToInvocationRequest(undefined));
  assert.doesNotThrow(() => mapWorkflowInputToInvocationRequest("not an object"));
  assert.doesNotThrow(() => mapWorkflowInputToInvocationRequest(42));
});

test("mapping is deterministic — the same input always produces the same output", () => {
  const input = { requestId: "wf-7", topicPackageFilePath: "x.json", correlationMetadata: { a: 1 } };
  const first = mapWorkflowInputToInvocationRequest(input);
  const second = mapWorkflowInputToInvocationRequest(input);
  assert.deepEqual(first, second);
});

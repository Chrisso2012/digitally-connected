import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInvocationRequest } from "../../src/invocation-normalizer.mjs";
import { prepareInvocationRequest } from "../../src/invocation-request.mjs";

test("normalizes a file_path reference into configuration.topicPackageSource.filePath", () => {
  const request = prepareInvocationRequest({
    request_id: "req-1",
    topic_package_reference: { file_path: "tests/fixtures/topic-package.example.json" },
  });
  const normalized = normalizeInvocationRequest(request);
  assert.deepEqual(normalized, {
    configuration: { topicPackageSource: { filePath: "tests/fixtures/topic-package.example.json" } },
  });
});

test("normalizes a data reference into configuration.topicPackageSource.data", () => {
  const data = { topic_id: "topic_1" };
  const request = prepareInvocationRequest({
    request_id: "req-1",
    topic_package_reference: { data },
  });
  const normalized = normalizeInvocationRequest(request);
  assert.deepEqual(normalized, { configuration: { topicPackageSource: { data } } });
});

test("produces exactly the shape orchestrator.run() expects as its first argument", () => {
  const request = prepareInvocationRequest({
    request_id: "req-1",
    topic_package_reference: { file_path: "x.json" },
  });
  const normalized = normalizeInvocationRequest(request);
  assert.deepEqual(Object.keys(normalized), ["configuration"]);
  assert.deepEqual(Object.keys(normalized.configuration), ["topicPackageSource"]);
});

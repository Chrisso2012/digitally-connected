import test from "node:test";
import assert from "node:assert/strict";
import { mapContentRequestToProductionWorkflowInput } from "../../src/content-request-workflow-mapper.mjs";

test("maps request_id onto requestId and passes the resolved Topic Package through as topicPackageData", () => {
  const contentRequest = { request_id: "req_abc123", source_reference: "GS01" };
  const resolvedTopicPackage = { topic_id: "topic_xyz", backlog_reference_id: "GS01" };

  const input = mapContentRequestToProductionWorkflowInput(contentRequest, resolvedTopicPackage);

  assert.deepEqual(input, {
    requestId: "req_abc123",
    topicPackageData: resolvedTopicPackage,
  });
});

test("invents no new fields — output has exactly requestId and topicPackageData", () => {
  const input = mapContentRequestToProductionWorkflowInput({ request_id: "req_1" }, { topic_id: "topic_1" });
  assert.deepEqual(Object.keys(input).sort(), ["requestId", "topicPackageData"]);
});

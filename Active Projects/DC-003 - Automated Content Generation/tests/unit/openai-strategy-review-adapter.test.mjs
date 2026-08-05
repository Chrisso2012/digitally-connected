// Unit tests for openai-strategy-review-adapter.mjs and
// strategy-review-instruction.mjs (DC-003-I029.3). NEVER makes a real
// network call — every reviewDelivery() test injects a fake `fetchFn`
// returning a hand-built Response-like object.

import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewInstruction, REVIEW_PROPOSAL_JSON_SCHEMA } from "../../src/strategy-review-instruction.mjs";
import { createOpenAiStrategyReviewAdapter } from "../../src/openai-strategy-review-adapter.mjs";
import { createStrategyReviewPolicy } from "../../src/strategy-review-policy.mjs";
import {
  StrategyReviewConfigurationError,
  StrategyReviewAuthenticationError,
  StrategyReviewRateLimitError,
  StrategyReviewTransportError,
  StrategyReviewClientError,
  MalformedReviewProposalError,
} from "../../src/strategy-review-errors.mjs";

const WORK_ORDER = {
  milestone: "DC-003-I029.3",
  title: "Ship the thing",
  objective: "Do the thing safely.",
  constraints: ["only touch src/foo.mjs"],
  dependencies: [],
  review_criteria: ["tests pass", "no scope creep"],
};
const DELIVERY_REPORT = {
  status: "completed",
  tests: { passed: 10, failed: 0, total: 10 },
  fixtures: { passed: 5, failed: 0, total: 5 },
  repository_findings: ["did the thing"],
};
const EVIDENCE = {
  repository: { startingCommit: "aaa1111", endingCommit: "bbb2222", branch: "main", workingTreeClean: true, pushStatus: "unknown", verifiable: true },
  tests: { source: "delivery-report", passed: 10, total: 10 },
  fixtures: { source: "delivery-report", passed: 5, total: 5 },
  filesCreated: [],
  filesModified: [],
};
const POLICY = createStrategyReviewPolicy({ repositoryPath: "/repo", permittedBranch: "main" });

// --- buildReviewInstruction ----------------------------------------------

test("buildReviewInstruction(): includes Work Order fields, criteria in order, and authority rules", () => {
  const instruction = buildReviewInstruction({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY });
  assert.match(instruction, /Ship the thing/);
  assert.match(instruction, /1\. tests pass/);
  assert.match(instruction, /2\. no scope creep/);
  assert.match(instruction, /You review evidence\. You do not trust prose alone/);
  assert.match(instruction, /Never waive a failed test/);
});

// --- REVIEW_PROPOSAL_JSON_SCHEMA ----------------------------------------

test("REVIEW_PROPOSAL_JSON_SCHEMA: is a strict object schema covering every Review Proposal field", () => {
  assert.equal(REVIEW_PROPOSAL_JSON_SCHEMA.type, "object");
  assert.equal(REVIEW_PROPOSAL_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual([...REVIEW_PROPOSAL_JSON_SCHEMA.required].sort(), ["ceoEscalation", "correction", "criteria", "decision", "risks", "summary"].sort());
});

// --- createOpenAiStrategyReviewAdapter() — fake fetch ----------------------

function fakeResponse({ status = 200, headers = {}, jsonBody = null, textBody = null }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => jsonBody,
    text: async () => textBody ?? JSON.stringify(jsonBody ?? {}),
  };
}

function validProposal() {
  return { decision: "approved", criteria: [{ criterionIndex: 1, result: "pass", evidence: [], reason: null }, { criterionIndex: 2, result: "pass", evidence: [], reason: null }], risks: [], correction: null, ceoEscalation: null, summary: "ok" };
}

test("createOpenAiStrategyReviewAdapter(): throws StrategyReviewConfigurationError with no API key", () => {
  assert.throws(() => createOpenAiStrategyReviewAdapter({}), StrategyReviewConfigurationError);
});

test("createOpenAiStrategyReviewAdapter(): a successful response is parsed into the raw proposal", async () => {
  const fetchFn = async () =>
    fakeResponse({
      status: 200,
      headers: { "content-type": "application/json" },
      jsonBody: { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validProposal()) }] }] },
    });
  const adapter = createOpenAiStrategyReviewAdapter({ apiKey: "sk-test", model: "gpt-4o" }, { fetchFn });
  const result = await adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY });
  assert.equal(result.decision, "approved");
});

test("createOpenAiStrategyReviewAdapter(): sends the API key only in the Authorization header, never the body", async () => {
  let capturedHeaders = null;
  let capturedBody = null;
  const fetchFn = async (url, init) => {
    capturedHeaders = init.headers;
    capturedBody = init.body;
    return fakeResponse({ status: 200, headers: { "content-type": "application/json" }, jsonBody: { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validProposal()) }] }] } });
  };
  const adapter = createOpenAiStrategyReviewAdapter({ apiKey: "sk-secret-value", model: "gpt-4o" }, { fetchFn });
  await adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY });
  assert.equal(capturedHeaders.authorization, "Bearer sk-secret-value");
  assert.doesNotMatch(capturedBody, /sk-secret-value/);
});

test("createOpenAiStrategyReviewAdapter(): 401 throws StrategyReviewAuthenticationError", async () => {
  const fetchFn = async () => fakeResponse({ status: 401 });
  const adapter = createOpenAiStrategyReviewAdapter({ apiKey: "sk-test" }, { fetchFn });
  await assert.rejects(() => adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY }), StrategyReviewAuthenticationError);
});

test("createOpenAiStrategyReviewAdapter(): 429 throws StrategyReviewRateLimitError", async () => {
  const fetchFn = async () => fakeResponse({ status: 429, headers: { "retry-after": "5" } });
  const adapter = createOpenAiStrategyReviewAdapter({ apiKey: "sk-test" }, { fetchFn });
  await assert.rejects(() => adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY }), StrategyReviewRateLimitError);
});

test("createOpenAiStrategyReviewAdapter(): 500 throws StrategyReviewTransportError", async () => {
  const fetchFn = async () => fakeResponse({ status: 500 });
  const adapter = createOpenAiStrategyReviewAdapter({ apiKey: "sk-test" }, { fetchFn });
  await assert.rejects(() => adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY }), StrategyReviewTransportError);
});

test("createOpenAiStrategyReviewAdapter(): a 400 client error includes a bounded, secret-free diagnostic", async () => {
  const fetchFn = async () =>
    fakeResponse({ status: 400, headers: { "content-type": "application/json" }, jsonBody: { error: { type: "invalid_request_error", message: "bad schema" } } });
  const adapter = createOpenAiStrategyReviewAdapter({ apiKey: "sk-test" }, { fetchFn });
  try {
    await adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY });
    assert.fail("expected rejection");
  } catch (error) {
    assert.ok(error instanceof StrategyReviewClientError);
    assert.equal(error.diagnostic.errorType, "invalid_request_error");
  }
});

test("createOpenAiStrategyReviewAdapter(): a response missing the documented output_text location throws MalformedReviewProposalError", async () => {
  const fetchFn = async () => fakeResponse({ status: 200, headers: { "content-type": "application/json" }, jsonBody: { output: [] } });
  const adapter = createOpenAiStrategyReviewAdapter({ apiKey: "sk-test" }, { fetchFn });
  await assert.rejects(() => adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY }), MalformedReviewProposalError);
});

test("createOpenAiStrategyReviewAdapter(): non-JSON output_text throws MalformedReviewProposalError", async () => {
  const fetchFn = async () =>
    fakeResponse({ status: 200, headers: { "content-type": "application/json" }, jsonBody: { output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }] } });
  const adapter = createOpenAiStrategyReviewAdapter({ apiKey: "sk-test" }, { fetchFn });
  await assert.rejects(() => adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY }), MalformedReviewProposalError);
});

test("createOpenAiStrategyReviewAdapter(): a network failure throws StrategyReviewTransportError", async () => {
  const fetchFn = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  const adapter = createOpenAiStrategyReviewAdapter({ apiKey: "sk-test" }, { fetchFn });
  await assert.rejects(() => adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY }), StrategyReviewTransportError);
});

test("createOpenAiStrategyReviewAdapter(): request body uses text.format json_schema strict and includes max_output_tokens, no tools field", async () => {
  let capturedBody = null;
  const fetchFn = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return fakeResponse({ status: 200, headers: { "content-type": "application/json" }, jsonBody: { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validProposal()) }] }] } });
  };
  const adapter = createOpenAiStrategyReviewAdapter({ apiKey: "sk-test", model: "gpt-4o" }, { fetchFn });
  await adapter.reviewDelivery({ workOrder: WORK_ORDER, deliveryReport: DELIVERY_REPORT, evidence: EVIDENCE, policy: POLICY });
  assert.equal(capturedBody.text.format.type, "json_schema");
  assert.equal(capturedBody.text.format.strict, true);
  assert.ok(capturedBody.max_output_tokens > 0);
  assert.equal(capturedBody.tools, undefined);
});

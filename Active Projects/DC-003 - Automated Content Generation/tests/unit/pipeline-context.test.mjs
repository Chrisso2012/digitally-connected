import test from "node:test";
import assert from "node:assert/strict";
import { createPipelineContext, withContext } from "../../src/pipeline-context.mjs";

test("createPipelineContext defaults every field to null/empty", () => {
  const context = createPipelineContext();
  assert.deepEqual(context, {
    executionId: null,
    configuration: null,
    topicPackage: null,
    carouselContent: null,
    templatedPayloads: null,
    renderResults: null,
    finishedCarousel: null,
    metrics: [],
    warnings: [],
  });
});

test("createPipelineContext accepts explicit fields", () => {
  const context = createPipelineContext({ executionId: "exec_20260801_aaaaaaaaaaaa", topicPackage: { topic_id: "topic_1" } });
  assert.equal(context.executionId, "exec_20260801_aaaaaaaaaaaa");
  assert.deepEqual(context.topicPackage, { topic_id: "topic_1" });
});

test("the context is deep-frozen — top-level and nested mutation both throw", () => {
  const context = createPipelineContext({ topicPackage: { topic_id: "topic_1" } });
  assert.throws(() => {
    context.executionId = "tampered";
  }, TypeError);
  assert.throws(() => {
    context.topicPackage.topic_id = "tampered";
  }, TypeError);
  assert.throws(() => {
    context.warnings.push("tampered");
  }, TypeError);
});

test("a configuration object containing live function properties (a mock transport/provider) does not throw", () => {
  // Regression test: deepFreezeClone's structuredClone() step throws
  // DataCloneError on any function anywhere in the value. PipelineContext
  // must be able to hold a mock transport/provider (context.configuration)
  // without hitting that — see pipeline-context.mjs / immutable.mjs for
  // why deepFreeze() (no cloning) is used here instead.
  const transport = { name: "mock-transport", send: async () => ({ id: "x" }) };
  assert.doesNotThrow(() => {
    const context = createPipelineContext({ configuration: { transport } });
    assert.equal(typeof context.configuration.transport.send, "function");
  });
});

test("a function-bearing configuration object is still frozen (cannot add new properties)", () => {
  const transport = { name: "mock-transport", send: async () => ({}) };
  const context = createPipelineContext({ configuration: { transport } });
  assert.throws(() => {
    context.configuration.transport.extra = "tampered";
  }, TypeError);
});

test("withContext returns a new object, not the same reference", () => {
  const context = createPipelineContext();
  const updated = withContext(context, { executionId: "exec_20260801_aaaaaaaaaaaa" });
  assert.notEqual(context, updated);
  assert.equal(context.executionId, null, "original context must be unaffected");
  assert.equal(updated.executionId, "exec_20260801_aaaaaaaaaaaa");
});

test("withContext preserves every untouched field", () => {
  const context = createPipelineContext({ executionId: "exec_20260801_aaaaaaaaaaaa", warnings: ["w1"] });
  const updated = withContext(context, { topicPackage: { topic_id: "topic_1" } });
  assert.equal(updated.executionId, "exec_20260801_aaaaaaaaaaaa");
  assert.deepEqual(updated.warnings, ["w1"]);
  assert.deepEqual(updated.topicPackage, { topic_id: "topic_1" });
});

import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionRecord, generateRecordId } from "../../src/execution-record.mjs";
import { ExecutionRecordValidationError } from "../../src/execution-ledger-errors.mjs";

const FIXED_CLOCK = () => "2026-08-01T00:00:00.000Z";
const FIXED_ID = () => "rec_fixed0000000001";

function baseFields(overrides = {}) {
  return {
    execution_id: "exec_20260801_9f3a2e1c8b4d",
    sequence: 1,
    event_type: "execution.started",
    status: "started",
    ...overrides,
  };
}

test("creates a well-formed, immutable ExecutionRecord with all fields explicit", () => {
  const record = createExecutionRecord(
    baseFields({
      record_id: "rec_explicit0001",
      stage: "topic_package",
      occurred_at: "2026-08-01T00:00:05.000Z",
      source: "cli",
      data: { topic_id: "topic_01J9X8QZ3K" },
      diagnostics: { safe_message: "ok" },
    })
  );

  assert.deepEqual(record, {
    record_id: "rec_explicit0001",
    execution_id: "exec_20260801_9f3a2e1c8b4d",
    sequence: 1,
    event_type: "execution.started",
    status: "started",
    stage: "topic_package",
    occurred_at: "2026-08-01T00:00:05.000Z",
    source: "cli",
    data: { topic_id: "topic_01J9X8QZ3K" },
    diagnostics: { safe_message: "ok" },
  });
  assert.throws(() => {
    record.status = "failed";
  }, TypeError);
});

test("auto-generates record_id and occurred_at when omitted, via injected clock/idGenerator", () => {
  const record = createExecutionRecord(baseFields(), { clock: FIXED_CLOCK, idGenerator: FIXED_ID });
  assert.equal(record.record_id, "rec_fixed0000000001");
  assert.equal(record.occurred_at, "2026-08-01T00:00:00.000Z");
});

test("stage, source, data, and diagnostics default to null when omitted", () => {
  const record = createExecutionRecord(baseFields(), { clock: FIXED_CLOCK, idGenerator: FIXED_ID });
  assert.equal(record.stage, null);
  assert.equal(record.source, null);
  assert.equal(record.data, null);
  assert.equal(record.diagnostics, null);
});

test("generateRecordId produces the documented rec_ prefix", () => {
  assert.match(generateRecordId(), /^rec_[a-f0-9]{16}$/);
});

test("two calls to generateRecordId produce different IDs", () => {
  assert.notEqual(generateRecordId(), generateRecordId());
});

test("throws ExecutionRecordValidationError for a missing execution_id", () => {
  const fields = baseFields();
  delete fields.execution_id;
  assert.throws(() => createExecutionRecord(fields), ExecutionRecordValidationError);
});

test("throws ExecutionRecordValidationError for a missing sequence", () => {
  const fields = baseFields();
  delete fields.sequence;
  assert.throws(() => createExecutionRecord(fields), ExecutionRecordValidationError);
});

test("throws ExecutionRecordValidationError for a non-integer sequence", () => {
  assert.throws(() => createExecutionRecord(baseFields({ sequence: 1.5 })), ExecutionRecordValidationError);
});

test("throws ExecutionRecordValidationError for a sequence below 1", () => {
  assert.throws(() => createExecutionRecord(baseFields({ sequence: 0 })), ExecutionRecordValidationError);
});

test("throws ExecutionRecordValidationError for an unregistered event_type", () => {
  assert.throws(
    () => createExecutionRecord(baseFields({ event_type: "something.unregistered" })),
    ExecutionRecordValidationError
  );
});

test("throws ExecutionRecordValidationError for a provider-specific status instead of the canonical vocabulary", () => {
  assert.throws(() => createExecutionRecord(baseFields({ status: "COMPLETED" })), ExecutionRecordValidationError);
});

test("accepts every documented event_type", () => {
  const eventTypes = [
    "execution.started",
    "execution.completed",
    "execution.failed",
    "topic.loaded",
    "content.generated",
    "payload.mapped",
    "render.started",
    "render.completed",
    "render.failed",
    "finished_carousel.created",
  ];
  for (const event_type of eventTypes) {
    assert.doesNotThrow(() => createExecutionRecord(baseFields({ event_type })));
  }
});

test("accepts every documented status", () => {
  for (const status of ["started", "succeeded", "failed", "cancelled"]) {
    assert.doesNotThrow(() => createExecutionRecord(baseFields({ status })));
  }
});

test("diagnostics: every allowlisted field is accepted together", () => {
  const record = createExecutionRecord(
    baseFields({
      status: "failed",
      diagnostics: {
        error_category: "provider",
        error_code: "VALIDATION_FAILED",
        retryable: false,
        attempt: 1,
        field_path: "status",
        safe_message: "response failed validation",
      },
    })
  );
  assert.equal(record.diagnostics.error_code, "VALIDATION_FAILED");
});

test("diagnostics: a field outside the allowlist is rejected — allowlist, not blacklist", () => {
  assert.throws(
    () => createExecutionRecord(baseFields({ diagnostics: { api_key: "sk-should-never-be-here" } })),
    ExecutionRecordValidationError
  );
});

test("diagnostics: a raw_response field is rejected, even though it sounds descriptive rather than secret", () => {
  assert.throws(
    () => createExecutionRecord(baseFields({ diagnostics: { raw_response: "{...}" } })),
    ExecutionRecordValidationError
  );
});

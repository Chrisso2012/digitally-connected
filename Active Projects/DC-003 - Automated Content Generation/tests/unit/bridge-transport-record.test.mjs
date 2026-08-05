import test from "node:test";
import assert from "node:assert/strict";
import { createBridgeTransportRecord } from "../../src/bridge-transport-record.mjs";
import { InvalidBridgeTransportRecordInputError, BridgeTransportRecordValidationError } from "../../src/bridge-transport-errors.mjs";

const VALID_CHECKSUM = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function baseFields(overrides = {}) {
  return {
    objectType: "engineering_work_order",
    objectId: "wo_test0000000001",
    transportType: "mock",
    status: "delivered",
    source: "engineering-work-order-store",
    destination: "/tmp/outgoing/wo_test0000000001.json",
    checksum: VALID_CHECKSUM,
    ...overrides,
  };
}

test("builds a valid, immutable record and derives direction from objectType", () => {
  const record = createBridgeTransportRecord(baseFields(), { idGenerator: () => "bt_test0000000001", now: () => "2026-08-06T00:00:00.000Z" });
  assert.equal(record.transport_record_id, "bt_test0000000001");
  assert.equal(record.direction, "outgoing");
  assert.equal(record.transported_at, "2026-08-06T00:00:00.000Z");
  assert.equal(record.notes, null);
  assert.throws(() => {
    record.status = "pending";
  }, TypeError);
});

test("engineering_delivery_report always derives direction 'incoming'", () => {
  const record = createBridgeTransportRecord(
    baseFields({ objectType: "engineering_delivery_report", objectId: "dr_test0000000001" }),
    { idGenerator: () => "bt_test0000000002" }
  );
  assert.equal(record.direction, "incoming");
});

test("rejects an objectId that doesn't match the pattern implied by objectType", () => {
  assert.throws(
    () => createBridgeTransportRecord(baseFields({ objectType: "engineering_delivery_report", objectId: "wo_wrongprefix0001" })),
    InvalidBridgeTransportRecordInputError
  );
  assert.throws(() => createBridgeTransportRecord(baseFields({ objectId: "not-a-real-id" })), InvalidBridgeTransportRecordInputError);
});

test("rejects an invalid objectType/status/transportType/checksum", () => {
  assert.throws(() => createBridgeTransportRecord(baseFields({ objectType: "bogus" })), InvalidBridgeTransportRecordInputError);
  assert.throws(() => createBridgeTransportRecord(baseFields({ status: "bogus" })), InvalidBridgeTransportRecordInputError);
  assert.throws(() => createBridgeTransportRecord(baseFields({ transportType: "" })), InvalidBridgeTransportRecordInputError);
  assert.throws(() => createBridgeTransportRecord(baseFields({ checksum: "too-short" })), InvalidBridgeTransportRecordInputError);
  assert.throws(() => createBridgeTransportRecord(baseFields({ checksum: VALID_CHECKSUM.toUpperCase() })), InvalidBridgeTransportRecordInputError);
});

test("rejects an empty source/destination", () => {
  assert.throws(() => createBridgeTransportRecord(baseFields({ source: "" })), InvalidBridgeTransportRecordInputError);
  assert.throws(() => createBridgeTransportRecord(baseFields({ destination: "" })), InvalidBridgeTransportRecordInputError);
});

test("accepts an explicit notes string", () => {
  const record = createBridgeTransportRecord(baseFields({ notes: "simulated transport failure" }), { idGenerator: () => "bt_test0000000003" });
  assert.equal(record.notes, "simulated transport failure");
});

test("does not mutate the supplied fields object", () => {
  const fields = baseFields();
  const before = JSON.stringify(fields);
  createBridgeTransportRecord(fields, { idGenerator: () => "bt_test0000000004" });
  assert.equal(JSON.stringify(fields), before);
});

test("throws BridgeTransportRecordValidationError if a caller-supplied idGenerator produces a malformed id", () => {
  assert.throws(() => createBridgeTransportRecord(baseFields(), { idGenerator: () => "not-a-real-id" }), BridgeTransportRecordValidationError);
});

// --- DC-003-I029.3 — engineering_strategy_review (additive) ---------------

test("engineering_strategy_review always derives direction 'outgoing' (Strategy Office -> Delivery Office/CEO)", () => {
  const record = createBridgeTransportRecord(
    baseFields({ objectType: "engineering_strategy_review", objectId: "esr_test0000000001", source: "engineering-strategy-review-store", destination: "/tmp/outgoing/esr_test0000000001.json" }),
    { idGenerator: () => "bt_test0000000005" }
  );
  assert.equal(record.direction, "outgoing");
  assert.equal(record.object_type, "engineering_strategy_review");
});

test("rejects an engineering_strategy_review objectId that doesn't match the esr_ pattern", () => {
  assert.throws(
    () => createBridgeTransportRecord(baseFields({ objectType: "engineering_strategy_review", objectId: "wo_wrongprefix0001" })),
    InvalidBridgeTransportRecordInputError
  );
});

test("existing engineering_work_order/engineering_delivery_report behaviour is completely unchanged by the I029.3 addition", () => {
  const workOrderRecord = createBridgeTransportRecord(baseFields(), { idGenerator: () => "bt_test0000000006" });
  assert.equal(workOrderRecord.direction, "outgoing");
  const deliveryReportRecord = createBridgeTransportRecord(
    baseFields({ objectType: "engineering_delivery_report", objectId: "dr_test0000000002" }),
    { idGenerator: () => "bt_test0000000007" }
  );
  assert.equal(deliveryReportRecord.direction, "incoming");
});

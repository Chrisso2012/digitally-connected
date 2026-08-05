// DC-003-I029.3 — Engineering Strategy Review Store: the domain layer over
// a Storage Adapter. Mirrors engineering-delivery-report-store.mjs almost
// exactly, plus two additions this milestone's own brief asks for:
// findByDeliveryReport()/latestByWorkOrder(), and a one-review-per-
// Delivery-Report duplicate guard (no versioning exists yet).
//
// No replace()/update(): a Strategy Review is a point-in-time, immutable
// verdict — never intentionally revised in place.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { assertValidEngineeringStrategyReviewStoreAdapter } from "./engineering-strategy-review-store-adapter.mjs";
import {
  InvalidEngineeringStrategyReviewIdentifierError,
  EngineeringStrategyReviewAlreadyExistsError,
  EngineeringStrategyReviewNotFoundError,
  CorruptedEngineeringStrategyReviewError,
  EngineeringStrategyReviewPersistenceError,
  DuplicateDeliveryReportReviewError,
} from "./engineering-strategy-review-errors.mjs";

const STRATEGY_REVIEW_ID_PATTERN = /^esr_[A-Za-z0-9]+$/;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !STRATEGY_REVIEW_ID_PATTERN.test(identifier)) {
    throw new InvalidEngineeringStrategyReviewIdentifierError(identifier);
  }
}

function parseStoredContent(identifier, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptedEngineeringStrategyReviewError(identifier, "stored content is not valid JSON");
  }
}

function validateStoredReview(identifier, review, validator) {
  const validation = validator.validate("engineeringStrategyReview", review);
  if (!validation.valid) {
    throw new CorruptedEngineeringStrategyReviewError(
      identifier,
      `stored content does not match engineering-strategy-review.schema.json (${validation.errors.length} error(s))`
    );
  }
}

function summarize(record) {
  return {
    strategy_review_id: record.strategy_review_id,
    work_order_id: record.work_order_id,
    delivery_report_id: record.delivery_report_id,
    milestone: record.milestone,
    decision: record.decision,
    reviewed_at: record.reviewed_at,
  };
}

function byReviewedAtThenId(a, b) {
  return a.reviewed_at < b.reviewed_at ? -1 : a.reviewed_at > b.reviewed_at ? 1 : a.strategy_review_id < b.strategy_review_id ? -1 : 1;
}

/**
 * Builds an Engineering Strategy Review Store over the given Storage
 * Adapter. Returns { name, save, get, list, findByWorkOrder,
 * findByDeliveryReport, latestByWorkOrder, exists }.
 */
export function createEngineeringStrategyReviewStore({ adapter } = {}, options = {}) {
  assertValidEngineeringStrategyReviewStoreAdapter(adapter);
  const validator = options.validator ?? createValidator(options);

  function readAllRecords() {
    let identifiers;
    try {
      identifiers = adapter.list();
    } catch (cause) {
      throw new EngineeringStrategyReviewPersistenceError("(list)", "list", cause);
    }
    return identifiers.map((identifier) => {
      let raw;
      try {
        raw = adapter.read(identifier);
      } catch (cause) {
        throw new EngineeringStrategyReviewPersistenceError(identifier, "read", cause);
      }
      const record = parseStoredContent(identifier, raw);
      validateStoredReview(identifier, record, validator);
      return record;
    });
  }

  function save(review) {
    const validation = validator.validate("engineeringStrategyReview", review);
    if (!validation.valid) {
      throw new CorruptedEngineeringStrategyReviewError(
        review?.strategy_review_id ?? "(unknown)",
        `supplied record does not match engineering-strategy-review.schema.json (${validation.errors.length} error(s))`
      );
    }

    const identifier = review.strategy_review_id;
    checkIdentifier(identifier);

    let alreadyExists;
    try {
      alreadyExists = adapter.exists(identifier);
    } catch (cause) {
      throw new EngineeringStrategyReviewPersistenceError(identifier, "exists-check", cause);
    }
    if (alreadyExists) {
      throw new EngineeringStrategyReviewAlreadyExistsError(identifier);
    }

    const existingForDeliveryReport = readAllRecords().find((r) => r.delivery_report_id === review.delivery_report_id);
    if (existingForDeliveryReport) {
      throw new DuplicateDeliveryReportReviewError(review.delivery_report_id, existingForDeliveryReport.strategy_review_id);
    }

    const content = JSON.stringify(review);
    try {
      adapter.write(identifier, content);
    } catch (cause) {
      throw new EngineeringStrategyReviewPersistenceError(identifier, "write", cause);
    }

    return deepFreezeClone(review);
  }

  function get(identifier) {
    checkIdentifier(identifier);

    let found;
    try {
      found = adapter.exists(identifier);
    } catch (cause) {
      throw new EngineeringStrategyReviewPersistenceError(identifier, "exists-check", cause);
    }
    if (!found) {
      throw new EngineeringStrategyReviewNotFoundError(identifier);
    }

    let raw;
    try {
      raw = adapter.read(identifier);
    } catch (cause) {
      throw new EngineeringStrategyReviewPersistenceError(identifier, "read", cause);
    }

    const record = parseStoredContent(identifier, raw);
    validateStoredReview(identifier, record, validator);

    return deepFreezeClone(record);
  }

  function exists(identifier) {
    checkIdentifier(identifier);
    try {
      return adapter.exists(identifier);
    } catch (cause) {
      throw new EngineeringStrategyReviewPersistenceError(identifier, "exists-check", cause);
    }
  }

  /** Every stored review, summarised, ordered chronologically by reviewed_at ascending (ties broken by strategy_review_id). */
  function list() {
    const summaries = readAllRecords().map(summarize);
    summaries.sort(byReviewedAtThenId);
    return deepFreezeClone(summaries);
  }

  /** Every FULL stored review for one Work Order, chronological. Returns [] when none exist yet — a legitimate state, never an error. */
  function findByWorkOrder(workOrderId) {
    const matches = readAllRecords()
      .filter((record) => record.work_order_id === workOrderId)
      .sort(byReviewedAtThenId);
    return deepFreezeClone(matches);
  }

  /** Every FULL stored review for one Delivery Report, chronological — expected to be at most one under this store's own duplicate guard, but never assumed. */
  function findByDeliveryReport(deliveryReportId) {
    const matches = readAllRecords()
      .filter((record) => record.delivery_report_id === deliveryReportId)
      .sort(byReviewedAtThenId);
    return deepFreezeClone(matches);
  }

  /** The most recent FULL review for one Work Order, or null when none exist yet. */
  function latestByWorkOrder(workOrderId) {
    const matches = findByWorkOrder(workOrderId);
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  return { name: adapter.name, save, get, list, findByWorkOrder, findByDeliveryReport, latestByWorkOrder, exists };
}

// DC-003-I029.3 — Strategy Review Lock: prevents two automated reviews of
// the same Engineering Delivery Report running concurrently. A smallest
// dedicated lock, per this milestone's own brief ("reuse the I029.2 lock
// pattern where possible... if reuse would require redesigning I029.2,
// create the smallest dedicated review lock") — delivery-execution-lock.mjs
// (I029.2) hardcodes both its identifier pattern (wo_...) and its error
// message text to Work Orders; parameterising either would mean touching
// an I029.2 file the Strategy Office review of this milestone explicitly
// scoped changes away from. This file is therefore a deliberate,
// near-identical duplicate keyed on delivery_report_id (dr_... pattern)
// instead — same atomic-acquisition discipline (temp-file +
// read-back-verify + rename), same non-silent stale-lock/release rules —
// with zero risk of altering I029.2's own tested behaviour.

import { writeFileSync, readFileSync, readdirSync, existsSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  InvalidStrategyReviewLockIdentifierError,
  StrategyReviewLockAlreadyHeldError,
  StrategyReviewLockNotHeldError,
  StrategyReviewLockOwnershipError,
  StrategyReviewLockPersistenceError,
} from "./strategy-review-errors.mjs";

const DELIVERY_REPORT_ID_PATTERN = /^dr_[A-Za-z0-9]+$/;
const EXTENSION = ".review-lock.json";
const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !DELIVERY_REPORT_ID_PATTERN.test(identifier)) {
    throw new InvalidStrategyReviewLockIdentifierError(identifier);
  }
}

function lockPath(lockDir, deliveryReportId) {
  return path.join(lockDir, `${deliveryReportId}${EXTENSION}`);
}

function readLockFile(lockDir, deliveryReportId) {
  let raw;
  try {
    raw = readFileSync(lockPath(lockDir, deliveryReportId), "utf-8");
  } catch (cause) {
    if (cause.code === "ENOENT") return null;
    throw new StrategyReviewLockPersistenceError(deliveryReportId, "read", cause);
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new StrategyReviewLockPersistenceError(deliveryReportId, "parse", cause);
  }
}

function isStale(lockRecord, nowMs, staleAfterMs) {
  return nowMs - Date.parse(lockRecord.acquired_at) > staleAfterMs;
}

/**
 * Builds a Strategy Review Lock over a plain local directory.
 *
 * fields.lockDir — required, explicit directory.
 * options.now / staleAfterMs / idGenerator — injectable for tests.
 *
 * Returns { acquire, release, inspect, list }.
 */
export function createStrategyReviewLock({ lockDir } = {}, options = {}) {
  if (typeof lockDir !== "string" || lockDir.trim() === "") {
    throw new StrategyReviewLockPersistenceError("(unknown)", "configure", new Error("lockDir is required and must be a non-empty string"));
  }
  const now = options.now ?? (() => Date.now());
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const idGenerator = options.idGenerator ?? randomUUID;

  function acquire(deliveryReportId) {
    checkIdentifier(deliveryReportId);
    mkdirSync(lockDir, { recursive: true });

    const existing = readLockFile(lockDir, deliveryReportId);
    if (existing && !isStale(existing, now(), staleAfterMs)) {
      throw new StrategyReviewLockAlreadyHeldError(deliveryReportId, existing.acquired_at);
    }

    const lockToken = idGenerator();
    const record = {
      delivery_report_id: deliveryReportId,
      lock_token: lockToken,
      acquired_at: new Date(now()).toISOString(),
      superseded_stale_lock: existing ? { lock_token: existing.lock_token, acquired_at: existing.acquired_at } : null,
    };
    const content = JSON.stringify(record);
    const target = lockPath(lockDir, deliveryReportId);
    const tempPath = path.join(lockDir, `.${deliveryReportId}.tmp-${idGenerator()}${EXTENSION}`);

    try {
      writeFileSync(tempPath, content, "utf-8");
      const writtenBack = readFileSync(tempPath, "utf-8");
      if (writtenBack !== content) {
        unlinkSync(tempPath);
        throw new Error("atomic write verification failed — temp file content did not match what was written");
      }
      renameSync(tempPath, target);
    } catch (cause) {
      throw new StrategyReviewLockPersistenceError(deliveryReportId, "acquire", cause);
    }

    return { deliveryReportId, lockToken, acquiredAt: record.acquired_at, supersededStaleLock: record.superseded_stale_lock !== null };
  }

  function release(deliveryReportId, lockToken) {
    checkIdentifier(deliveryReportId);
    const existing = readLockFile(lockDir, deliveryReportId);
    if (!existing) {
      throw new StrategyReviewLockNotHeldError(deliveryReportId);
    }
    if (existing.lock_token !== lockToken) {
      throw new StrategyReviewLockOwnershipError(deliveryReportId);
    }
    try {
      unlinkSync(lockPath(lockDir, deliveryReportId));
    } catch (cause) {
      throw new StrategyReviewLockPersistenceError(deliveryReportId, "release", cause);
    }
  }

  function inspect(deliveryReportId) {
    checkIdentifier(deliveryReportId);
    const existing = readLockFile(lockDir, deliveryReportId);
    if (!existing) return null;
    return { deliveryReportId: existing.delivery_report_id, acquiredAt: existing.acquired_at, stale: isStale(existing, now(), staleAfterMs) };
  }

  function list() {
    if (!existsSync(lockDir)) return [];
    return readdirSync(lockDir)
      .filter((name) => name.endsWith(EXTENSION) && !name.startsWith("."))
      .map((name) => name.slice(0, -EXTENSION.length))
      .map((deliveryReportId) => inspect(deliveryReportId));
  }

  return { acquire, release, inspect, list };
}

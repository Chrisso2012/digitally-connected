// DC-003-I029.2 — Execution Lock: prevents two Automated Delivery Office
// Runner invocations from executing the same Engineering Work Order
// concurrently. Deliberately NOT routed through the schema/Storage-Adapter
// machinery every domain object in this repo uses — a lock is ephemeral
// concurrency-control plumbing, never authored by the Strategy Office,
// never queried as a permanent record. This is the smallest dedicated
// component the DC-003-I029.2 brief's §5 asks for, mirroring
// content-asset-repository.mjs's own (I018) precedent for departing from
// the standard pattern when justified — no general-purpose database, one
// small JSON file per locked Work Order.
//
// Atomicity: acquire() uses the same temp-file-in-the-same-directory +
// read-back-verify + rename discipline every local-json-*-adapter.mjs in
// this codebase already applies to writes.
//
// Stale-lock handling is deliberately NOT automatic/silent: inspect() and
// list() only ever report staleness, they never clear it. The only path
// that supersedes a stale lock is a subsequent acquire() call, and even
// then the new lock record's own `superseded_stale_lock` field names the
// previous lock's token/acquired_at — the override is always visible in
// the lock file itself, never a quiet delete.
//
// release() requires the exact lockToken acquire() returned — it refuses
// to remove a lock this caller does not own (ExecutionLockOwnershipError)
// and refuses to "release" a lock that was never held
// (ExecutionLockNotHeldError). No release ever silently no-ops.

import { writeFileSync, readFileSync, readdirSync, existsSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  InvalidExecutionLockIdentifierError,
  ExecutionLockAlreadyHeldError,
  ExecutionLockNotHeldError,
  ExecutionLockOwnershipError,
  ExecutionLockPersistenceError,
} from "./delivery-office-errors.mjs";

const WORK_ORDER_ID_PATTERN = /^wo_[A-Za-z0-9]+$/;
const EXTENSION = ".lock.json";
const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;

function checkIdentifier(identifier) {
  if (typeof identifier !== "string" || !WORK_ORDER_ID_PATTERN.test(identifier)) {
    throw new InvalidExecutionLockIdentifierError(identifier);
  }
}

function lockPath(lockDir, workOrderId) {
  return path.join(lockDir, `${workOrderId}${EXTENSION}`);
}

function readLockFile(lockDir, workOrderId) {
  let raw;
  try {
    raw = readFileSync(lockPath(lockDir, workOrderId), "utf-8");
  } catch (cause) {
    if (cause.code === "ENOENT") return null;
    throw new ExecutionLockPersistenceError(workOrderId, "read", cause);
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new ExecutionLockPersistenceError(workOrderId, "parse", cause);
  }
}

function isStale(lockRecord, nowMs, staleAfterMs) {
  return nowMs - Date.parse(lockRecord.acquired_at) > staleAfterMs;
}

/**
 * Builds an Execution Lock over a plain local directory.
 *
 * fields.lockDir — required, explicit directory (never hardcoded/env
 *   derived — matches every other store's "storeDirectory is always an
 *   explicit argument" convention in this codebase).
 * options.now — override the clock (tests), returns epoch ms.
 * options.staleAfterMs — override the staleness threshold (default 1 hour).
 * options.idGenerator — override lock-token generation (tests).
 *
 * Returns { acquire, release, inspect, list }.
 */
export function createDeliveryExecutionLock({ lockDir } = {}, options = {}) {
  if (typeof lockDir !== "string" || lockDir.trim() === "") {
    throw new ExecutionLockPersistenceError("(unknown)", "configure", new Error("lockDir is required and must be a non-empty string"));
  }
  const now = options.now ?? (() => Date.now());
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const idGenerator = options.idGenerator ?? randomUUID;

  function acquire(workOrderId) {
    checkIdentifier(workOrderId);
    mkdirSync(lockDir, { recursive: true });

    const existing = readLockFile(lockDir, workOrderId);
    if (existing && !isStale(existing, now(), staleAfterMs)) {
      throw new ExecutionLockAlreadyHeldError(workOrderId, existing.acquired_at);
    }

    const lockToken = idGenerator();
    const record = {
      work_order_id: workOrderId,
      lock_token: lockToken,
      acquired_at: new Date(now()).toISOString(),
      superseded_stale_lock: existing ? { lock_token: existing.lock_token, acquired_at: existing.acquired_at } : null,
    };
    const content = JSON.stringify(record);
    const target = lockPath(lockDir, workOrderId);
    const tempPath = path.join(lockDir, `.${workOrderId}.tmp-${idGenerator()}${EXTENSION}`);

    try {
      writeFileSync(tempPath, content, "utf-8");
      const writtenBack = readFileSync(tempPath, "utf-8");
      if (writtenBack !== content) {
        unlinkSync(tempPath);
        throw new Error("atomic write verification failed — temp file content did not match what was written");
      }
      renameSync(tempPath, target);
    } catch (cause) {
      throw new ExecutionLockPersistenceError(workOrderId, "acquire", cause);
    }

    return { workOrderId, lockToken, acquiredAt: record.acquired_at, supersededStaleLock: record.superseded_stale_lock !== null };
  }

  function release(workOrderId, lockToken) {
    checkIdentifier(workOrderId);
    const existing = readLockFile(lockDir, workOrderId);
    if (!existing) {
      throw new ExecutionLockNotHeldError(workOrderId);
    }
    if (existing.lock_token !== lockToken) {
      throw new ExecutionLockOwnershipError(workOrderId);
    }
    try {
      unlinkSync(lockPath(lockDir, workOrderId));
    } catch (cause) {
      throw new ExecutionLockPersistenceError(workOrderId, "release", cause);
    }
  }

  /** Read-only. Never mutates, never clears staleness as a side effect. Returns null when no lock file exists for this Work Order. */
  function inspect(workOrderId) {
    checkIdentifier(workOrderId);
    const existing = readLockFile(lockDir, workOrderId);
    if (!existing) return null;
    return { workOrderId: existing.work_order_id, acquiredAt: existing.acquired_at, stale: isStale(existing, now(), staleAfterMs) };
  }

  /** Every currently-locked Work Order, read-only — one directory scan. */
  function list() {
    if (!existsSync(lockDir)) return [];
    return readdirSync(lockDir)
      .filter((name) => name.endsWith(EXTENSION) && !name.startsWith("."))
      .map((name) => name.slice(0, -EXTENSION.length))
      .map((workOrderId) => inspect(workOrderId));
  }

  return { acquire, release, inspect, list };
}

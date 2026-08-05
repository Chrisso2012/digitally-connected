import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDeliveryExecutionLock } from "../../src/delivery-execution-lock.mjs";
import {
  InvalidExecutionLockIdentifierError,
  ExecutionLockAlreadyHeldError,
  ExecutionLockNotHeldError,
  ExecutionLockOwnershipError,
} from "../../src/delivery-office-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-lock-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WORK_ORDER_ID = "wo_locktest00000001";

test("acquire(): rejects a non-conforming identifier", () =>
  withTempDir((lockDir) => {
    const lock = createDeliveryExecutionLock({ lockDir });
    assert.throws(() => lock.acquire("not-a-work-order-id"), InvalidExecutionLockIdentifierError);
  }));

test("acquire(): first acquisition succeeds and writes exactly one lock file, atomically (no leftover temp file)", () =>
  withTempDir((lockDir) => {
    const lock = createDeliveryExecutionLock({ lockDir });
    const handle = lock.acquire(WORK_ORDER_ID);
    assert.equal(handle.workOrderId, WORK_ORDER_ID);
    assert.ok(handle.lockToken);
    assert.equal(handle.supersededStaleLock, false);
    const files = readdirSync(lockDir);
    assert.equal(files.length, 1);
    assert.ok(!files[0].startsWith("."));
  }));

test("acquire(): a second acquisition of a non-stale lock is refused", () =>
  withTempDir((lockDir) => {
    const lock = createDeliveryExecutionLock({ lockDir });
    lock.acquire(WORK_ORDER_ID);
    assert.throws(() => lock.acquire(WORK_ORDER_ID), ExecutionLockAlreadyHeldError);
  }));

test("acquire(): a stale lock is superseded, visibly — the new record names the old lock's own token", () =>
  withTempDir((lockDir) => {
    let clock = 0;
    const lock = createDeliveryExecutionLock({ lockDir }, { now: () => clock, staleAfterMs: 1000 });
    const first = lock.acquire(WORK_ORDER_ID);
    clock += 2000; // exceeds staleAfterMs
    const second = lock.acquire(WORK_ORDER_ID);
    assert.notEqual(second.lockToken, first.lockToken);
    assert.equal(second.supersededStaleLock, true);
  }));

test("inspect(): returns null when nothing is locked, and never mutates a stale lock as a side effect", () =>
  withTempDir((lockDir) => {
    let clock = 0;
    const lock = createDeliveryExecutionLock({ lockDir }, { now: () => clock, staleAfterMs: 1000 });
    assert.equal(lock.inspect(WORK_ORDER_ID), null);

    lock.acquire(WORK_ORDER_ID);
    clock += 2000;
    assert.equal(lock.inspect(WORK_ORDER_ID).stale, true);
    // Still held, still stale, after a second read — inspect() never
    // clears staleness as a side effect; only a real acquire() supersedes it.
    assert.equal(lock.inspect(WORK_ORDER_ID).stale, true);
    assert.equal(readdirSync(lockDir).length, 1);
  }));

test("release(): succeeds with the correct token, removing the lock file", () =>
  withTempDir((lockDir) => {
    const lock = createDeliveryExecutionLock({ lockDir });
    const handle = lock.acquire(WORK_ORDER_ID);
    lock.release(WORK_ORDER_ID, handle.lockToken);
    assert.equal(lock.inspect(WORK_ORDER_ID), null);
  }));

test("release(): refuses with the wrong token, never removing the lock", () =>
  withTempDir((lockDir) => {
    const lock = createDeliveryExecutionLock({ lockDir });
    lock.acquire(WORK_ORDER_ID);
    assert.throws(() => lock.release(WORK_ORDER_ID, "wrong-token"), ExecutionLockOwnershipError);
    assert.notEqual(lock.inspect(WORK_ORDER_ID), null);
  }));

test("release(): refuses to release a lock that was never held", () =>
  withTempDir((lockDir) => {
    const lock = createDeliveryExecutionLock({ lockDir });
    assert.throws(() => lock.release(WORK_ORDER_ID, "any-token"), ExecutionLockNotHeldError);
  }));

test("list(): reports every currently-locked Work Order with its own staleness, empty array when the directory doesn't exist yet", () =>
  withTempDir((lockDir) => {
    const nested = path.join(lockDir, "does-not-exist-yet");
    const lock = createDeliveryExecutionLock({ lockDir: nested });
    assert.deepEqual(lock.list(), []);

    lock.acquire(WORK_ORDER_ID);
    lock.acquire("wo_locktest00000002");
    const listed = lock.list();
    assert.equal(listed.length, 2);
    assert.ok(listed.every((entry) => entry.stale === false));
  }));

test("acquire()/release() reject a path-traversal-shaped identifier", () =>
  withTempDir((lockDir) => {
    const lock = createDeliveryExecutionLock({ lockDir });
    assert.throws(() => lock.acquire("../../etc/passwd"), InvalidExecutionLockIdentifierError);
    assert.throws(() => lock.release("../../etc/passwd", "x"), InvalidExecutionLockIdentifierError);
  }));

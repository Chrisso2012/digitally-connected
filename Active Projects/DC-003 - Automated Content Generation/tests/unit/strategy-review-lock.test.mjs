import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStrategyReviewLock } from "../../src/strategy-review-lock.mjs";
import {
  InvalidStrategyReviewLockIdentifierError,
  StrategyReviewLockAlreadyHeldError,
  StrategyReviewLockNotHeldError,
  StrategyReviewLockOwnershipError,
} from "../../src/strategy-review-errors.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-review-lock-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DELIVERY_REPORT_ID = "dr_locktest00000001";

test("acquire(): rejects a non-conforming identifier", () =>
  withTempDir((lockDir) => {
    const lock = createStrategyReviewLock({ lockDir });
    assert.throws(() => lock.acquire("wo_wrongprefix0001"), InvalidStrategyReviewLockIdentifierError);
  }));

test("acquire(): first acquisition succeeds atomically", () =>
  withTempDir((lockDir) => {
    const lock = createStrategyReviewLock({ lockDir });
    const handle = lock.acquire(DELIVERY_REPORT_ID);
    assert.equal(handle.deliveryReportId, DELIVERY_REPORT_ID);
    assert.ok(handle.lockToken);
    assert.equal(readdirSync(lockDir).length, 1);
  }));

test("acquire(): a second acquisition of a non-stale lock is refused", () =>
  withTempDir((lockDir) => {
    const lock = createStrategyReviewLock({ lockDir });
    lock.acquire(DELIVERY_REPORT_ID);
    assert.throws(() => lock.acquire(DELIVERY_REPORT_ID), StrategyReviewLockAlreadyHeldError);
  }));

test("acquire(): a stale lock is superseded visibly", () =>
  withTempDir((lockDir) => {
    let clock = 0;
    const lock = createStrategyReviewLock({ lockDir }, { now: () => clock, staleAfterMs: 1000 });
    const first = lock.acquire(DELIVERY_REPORT_ID);
    clock += 2000;
    const second = lock.acquire(DELIVERY_REPORT_ID);
    assert.notEqual(second.lockToken, first.lockToken);
    assert.equal(second.supersededStaleLock, true);
  }));

test("release(): succeeds with the correct token", () =>
  withTempDir((lockDir) => {
    const lock = createStrategyReviewLock({ lockDir });
    const handle = lock.acquire(DELIVERY_REPORT_ID);
    lock.release(DELIVERY_REPORT_ID, handle.lockToken);
    assert.equal(lock.inspect(DELIVERY_REPORT_ID), null);
  }));

test("release(): refuses with the wrong token", () =>
  withTempDir((lockDir) => {
    const lock = createStrategyReviewLock({ lockDir });
    lock.acquire(DELIVERY_REPORT_ID);
    assert.throws(() => lock.release(DELIVERY_REPORT_ID, "wrong-token"), StrategyReviewLockOwnershipError);
  }));

test("release(): refuses to release a lock never held", () =>
  withTempDir((lockDir) => {
    const lock = createStrategyReviewLock({ lockDir });
    assert.throws(() => lock.release(DELIVERY_REPORT_ID, "any"), StrategyReviewLockNotHeldError);
  }));

test("list(): reports every currently-locked Delivery Report, empty when the directory doesn't exist", () =>
  withTempDir((lockDir) => {
    const nested = path.join(lockDir, "not-yet");
    const lock = createStrategyReviewLock({ lockDir: nested });
    assert.deepEqual(lock.list(), []);
    lock.acquire(DELIVERY_REPORT_ID);
    lock.acquire("dr_locktest00000002");
    assert.equal(lock.list().length, 2);
  }));

test("acquire()/release() reject a path-traversal-shaped identifier", () =>
  withTempDir((lockDir) => {
    const lock = createStrategyReviewLock({ lockDir });
    assert.throws(() => lock.acquire("../../etc/passwd"), InvalidStrategyReviewLockIdentifierError);
  }));

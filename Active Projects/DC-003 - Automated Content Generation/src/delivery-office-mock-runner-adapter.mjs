// DC-003-I029.2 — Mock Delivery Office Runner Adapter: the ONLY runner
// adapter automated tests and the CLI's default mode ever use — no
// subprocess, no Claude Code, no network dependency. Deterministic:
// `options.mode` selects the exact scenario, no timers, no real waiting
// (a "timeout"/"interrupted" mode returns that status immediately rather
// than actually hanging — this is what makes the mock usable in a fast,
// deterministic test suite while still exercising every branch the
// service must handle).
//
// Mirrors bridge-transport-mock-adapter.mjs's own `options.mode` pattern
// (I029.1). Covers every DC-003-I029.2 §12 scenario:
//   success | failed | timeout | interrupted | adapter-error | malformed
//   | dirty-repository | tests-failed | fixtures-failed
// ("duplicate Work Order" and "lock conflict" are eligibility/lock-layer
// concerns — see automated-delivery-office-service.mjs — they never reach
// a runner adapter at all, mock or real, so they are not modes here.)

import { RunnerExecutionFailedError } from "./delivery-office-errors.mjs";

const DEFAULT_MODE = "success";

export function createMockDeliveryOfficeRunnerAdapter(options = {}) {
  const mode = options.mode ?? DEFAULT_MODE;
  const now = options.now ?? (() => new Date().toISOString());

  return {
    name: "mock-delivery-office-runner",

    async executeWorkOrder({ workOrder, repository, executionPolicy }) {
      const startedAt = now();

      if (mode === "adapter-error") {
        throw new RunnerExecutionFailedError(workOrder.work_order_id, "simulated subprocess failure [mock]");
      }

      if (mode === "malformed") {
        // Deliberately missing required Structured Runner Result fields —
        // automated-delivery-office-service.mjs's own
        // assertValidRunnerResult() must catch this, not this adapter.
        return { status: "completed", workOrderId: workOrder.work_order_id };
      }

      const completedAt = now();
      const base = {
        workOrderId: workOrder.work_order_id,
        startedAt,
        completedAt,
        sessionReference: `mock-session-${workOrder.work_order_id}`,
        repository: {
          startingCommit: repository.startingCommit,
          endingCommit: repository.startingCommit,
          branch: executionPolicy.permittedBranch,
          workingTree: "clean",
        },
        verification: {
          testsPassed: true,
          fixturesPassed: true,
          testsSummary: { passed: 10, failed: 0, total: 10 },
          fixturesSummary: { passed: 5, failed: 0, total: 5 },
        },
      };

      const zeroVerification = {
        testsPassed: false,
        fixturesPassed: false,
        testsSummary: { passed: 0, failed: 0, total: 0 },
        fixturesSummary: { passed: 0, failed: 0, total: 0 },
      };

      if (mode === "timeout") {
        return {
          ...base,
          status: "timeout",
          exitCode: null,
          verification: zeroVerification,
          deliveryEvidence: { commit: null, pushStatus: "not_applicable", summary: "runner exceeded its configured timeout [mock]" },
        };
      }
      if (mode === "interrupted") {
        return {
          ...base,
          status: "interrupted",
          exitCode: null,
          verification: zeroVerification,
          deliveryEvidence: { commit: null, pushStatus: "not_applicable", summary: "runner process was interrupted [mock]" },
        };
      }
      if (mode === "failed") {
        return {
          ...base,
          status: "failed",
          exitCode: 1,
          verification: {
            testsPassed: false,
            fixturesPassed: false,
            testsSummary: { passed: 6, failed: 4, total: 10 },
            fixturesSummary: { passed: 3, failed: 2, total: 5 },
          },
          deliveryEvidence: { commit: null, pushStatus: "not_applicable", summary: "the runner concluded the Work Order could not be completed [mock]" },
        };
      }
      if (mode === "dirty-repository") {
        return {
          ...base,
          status: "failed",
          exitCode: 0,
          repository: { ...base.repository, workingTree: "dirty" },
          deliveryEvidence: { commit: null, pushStatus: "not_applicable", summary: "the repository was left dirty after execution [mock]" },
        };
      }
      if (mode === "tests-failed") {
        return {
          ...base,
          status: "failed",
          exitCode: 0,
          repository: { ...base.repository, endingCommit: "abc1234f" },
          verification: { testsPassed: false, fixturesPassed: true, testsSummary: { passed: 8, failed: 2, total: 10 }, fixturesSummary: { passed: 5, failed: 0, total: 5 } },
          deliveryEvidence: { commit: "abc1234f", pushStatus: "not_pushed", summary: "unit tests failed after implementation [mock]" },
        };
      }
      if (mode === "fixtures-failed") {
        return {
          ...base,
          status: "failed",
          exitCode: 0,
          repository: { ...base.repository, endingCommit: "abc1234f" },
          verification: { testsPassed: true, fixturesPassed: false, testsSummary: { passed: 10, failed: 0, total: 10 }, fixturesSummary: { passed: 4, failed: 1, total: 5 } },
          deliveryEvidence: { commit: "abc1234f", pushStatus: "not_pushed", summary: "fixture validation failed after implementation [mock]" },
        };
      }

      // "success" (default)
      return {
        ...base,
        status: "completed",
        exitCode: 0,
        repository: { ...base.repository, endingCommit: "deadbee1234f" },
        deliveryEvidence: {
          commit: "deadbee1234f",
          pushStatus: executionPolicy.allowPush ? "pushed" : "not_applicable",
          summary: `Work Order ${workOrder.milestone} implemented successfully [mock]`,
        },
      };
    },
  };
}

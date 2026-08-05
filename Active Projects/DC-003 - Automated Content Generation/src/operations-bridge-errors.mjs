// DC-003-I029.4 — the one structured error this milestone introduces.
// Everything else that can go wrong during an orchestrated run is already
// a real error type from I029.2 (Automated Delivery Office) or I029.3
// (Automated Strategy Review) — this file does not re-declare or wrap any
// of them, so a caller catching (say) WorkOrderNotEligibleError still
// catches the exact same class whether it came from the Delivery Office
// Runner CLI directly or through this orchestrator.

export class InvalidAutomatedOperationsBridgeDependenciesError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidAutomatedOperationsBridgeDependenciesError";
  }
}

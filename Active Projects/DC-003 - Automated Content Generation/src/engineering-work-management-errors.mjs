// DC-003-I029 — structured errors for the Engineering Work Management
// Service (the read-only join/status layer over the two I029 stores).

export class InvalidEngineeringWorkManagementDependenciesError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidEngineeringWorkManagementDependenciesError";
  }
}

// DC-003-I029 — structured errors for the Engineering Work Order domain
// object, its Storage Adapter contract, and its Local JSON Storage
// Adapter. Mirrors production-metrics-errors.mjs's own precedent (I023)
// of combining domain-object and store errors in one file. Every message
// here is written on the assumption it may be shown to an external
// caller — never a raw filesystem path or a raw Node error message.

export class InvalidEngineeringWorkOrderInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidEngineeringWorkOrderInputError";
  }
}

export class EngineeringWorkOrderValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Engineering Work Order failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "EngineeringWorkOrderValidationError";
    this.errors = errors;
  }
}

export class InvalidEngineeringWorkOrderStoreAdapterError extends Error {
  constructor() {
    super(
      "An Engineering Work Order Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidEngineeringWorkOrderStoreAdapterError";
  }
}

export class InvalidEngineeringWorkOrderIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid work order identifier — expected the form wo_<alphanumeric>`);
    this.name = "InvalidEngineeringWorkOrderIdentifierError";
  }
}

export class EngineeringWorkOrderAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Engineering Work Order "${identifier}" already exists in the store — work orders are never overwritten`);
    this.name = "EngineeringWorkOrderAlreadyExistsError";
    this.identifier = identifier;
  }
}

export class EngineeringWorkOrderNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored Engineering Work Order found for identifier "${identifier}"`);
    this.name = "EngineeringWorkOrderNotFoundError";
    this.identifier = identifier;
  }
}

export class CorruptedEngineeringWorkOrderError extends Error {
  constructor(identifier, reason) {
    super(`Stored Engineering Work Order "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedEngineeringWorkOrderError";
    this.identifier = identifier;
  }
}

export class EngineeringWorkOrderPersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for Engineering Work Order "${identifier}"`, { cause });
    this.name = "EngineeringWorkOrderPersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

// DC-003-I029 — structured errors for the Engineering Delivery Report
// domain object, its Storage Adapter contract, and its Local JSON Storage
// Adapter. Mirrors engineering-work-order-errors.mjs exactly.

export class InvalidEngineeringDeliveryReportInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidEngineeringDeliveryReportInputError";
  }
}

export class EngineeringDeliveryReportValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Engineering Delivery Report failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "EngineeringDeliveryReportValidationError";
    this.errors = errors;
  }
}

export class InvalidEngineeringDeliveryReportStoreAdapterError extends Error {
  constructor() {
    super(
      "An Engineering Delivery Report Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidEngineeringDeliveryReportStoreAdapterError";
  }
}

export class InvalidEngineeringDeliveryReportIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid delivery report identifier — expected the form dr_<alphanumeric>`);
    this.name = "InvalidEngineeringDeliveryReportIdentifierError";
  }
}

export class EngineeringDeliveryReportAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Engineering Delivery Report "${identifier}" already exists in the store — delivery reports are never overwritten`);
    this.name = "EngineeringDeliveryReportAlreadyExistsError";
    this.identifier = identifier;
  }
}

export class EngineeringDeliveryReportNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored Engineering Delivery Report found for identifier "${identifier}"`);
    this.name = "EngineeringDeliveryReportNotFoundError";
    this.identifier = identifier;
  }
}

export class CorruptedEngineeringDeliveryReportError extends Error {
  constructor(identifier, reason) {
    super(`Stored Engineering Delivery Report "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedEngineeringDeliveryReportError";
    this.identifier = identifier;
  }
}

export class EngineeringDeliveryReportPersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for Engineering Delivery Report "${identifier}"`, { cause });
    this.name = "EngineeringDeliveryReportPersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

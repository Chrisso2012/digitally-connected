// DC-003-I029.1 — all structured errors for Bridge Transport: the domain
// object, its Storage Adapter contract, the Local JSON Storage Adapter,
// the mock transport adapter, and the Transport Service — combined in one
// file, deliberately, since this milestone is a lean extension point, not
// a new business capability (see README "Bridge Transport"). Every
// message here is written on the assumption it may be shown to an
// external caller — never a raw filesystem path or raw Node error
// message.

export class InvalidBridgeTransportRecordInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidBridgeTransportRecordInputError";
  }
}

export class BridgeTransportRecordValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Bridge Transport Record failed schema validation with ${errors.length} error(s):\n${summary}`);
    this.name = "BridgeTransportRecordValidationError";
    this.errors = errors;
  }
}

export class InvalidBridgeTransportStoreAdapterError extends Error {
  constructor() {
    super(
      "A Bridge Transport Store adapter must be shaped { name: string, write(identifier, content), read(identifier), list(), exists(identifier) }"
    );
    this.name = "InvalidBridgeTransportStoreAdapterError";
  }
}

export class InvalidBridgeTransportRecordIdentifierError extends Error {
  constructor(identifier) {
    super(`${JSON.stringify(identifier)} is not a valid transport record identifier — expected the form bt_<alphanumeric>`);
    this.name = "InvalidBridgeTransportRecordIdentifierError";
  }
}

export class BridgeTransportRecordAlreadyExistsError extends Error {
  constructor(identifier) {
    super(`Bridge Transport Record "${identifier}" already exists in the store — transport records are never overwritten`);
    this.name = "BridgeTransportRecordAlreadyExistsError";
    this.identifier = identifier;
  }
}

export class BridgeTransportRecordNotFoundError extends Error {
  constructor(identifier) {
    super(`No stored Bridge Transport Record found for identifier "${identifier}"`);
    this.name = "BridgeTransportRecordNotFoundError";
    this.identifier = identifier;
  }
}

export class CorruptedBridgeTransportRecordError extends Error {
  constructor(identifier, reason) {
    super(`Stored Bridge Transport Record "${identifier}" is corrupted — ${reason}`);
    this.name = "CorruptedBridgeTransportRecordError";
    this.identifier = identifier;
  }
}

export class BridgeTransportPersistenceError extends Error {
  constructor(identifier, operation, cause) {
    super(`Persistence ${operation} failed for Bridge Transport Record "${identifier}"`, { cause });
    this.name = "BridgeTransportPersistenceError";
    this.identifier = identifier;
    this.operation = operation;
  }
}

/** The transport adapter's own send/receive call failed — a genuine transport-layer failure, not a duplicate or corruption. */
export class BridgeTransportSendError extends Error {
  constructor(reason, cause) {
    super(`Bridge Transport export failed — ${reason}`, { cause });
    this.name = "BridgeTransportSendError";
  }
}

/** The imported payload could not be parsed/read — corruption, never silently treated as an empty/valid delivery report. */
export class BridgeTransportCorruptionError extends Error {
  constructor(reason) {
    super(`Bridge Transport import payload is corrupted — ${reason}`);
    this.name = "BridgeTransportCorruptionError";
  }
}

/**
 * The exact object (by object_id + direction) has already been
 * successfully transported — checked against Bridge Transport history
 * before any adapter call. No retry/force flag exists; a genuine
 * re-transport requires a new, distinct engineering object.
 */
export class DuplicateBridgeTransportError extends Error {
  constructor(objectId, direction) {
    super(`"${objectId}" has already been successfully transported ${direction} — it is not transported again`);
    this.name = "DuplicateBridgeTransportError";
    this.objectId = objectId;
    this.direction = direction;
  }
}

export class InvalidBridgeTransportDependenciesError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidBridgeTransportDependenciesError";
  }
}

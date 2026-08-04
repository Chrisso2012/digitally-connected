// DC-003-I026 — structured errors for the Windows Production Export
// Service. Mirrors production-asset-export-errors.mjs's own discipline
// exactly: every message here is written on the assumption it may be
// shown to an external caller (a CLI user) — none of them ever
// interpolate a raw filesystem path (Windows host path or otherwise), a
// raw Node error message, a stack trace, or credential. Only already-
// public identifiers (carousel_id, a filename) are ever named.

/**
 * A destination package already exists for this carousel_id and is
 * COMPLETE (has its own valid metadata.json), but its content does not
 * match the source archive — and `replace` was not requested. Never a
 * silent overwrite, matching DC-003-I022's own DuplicatePackageError
 * "fail by default unless --replace" precedent.
 */
export class WindowsDeliveryConflictError extends Error {
  constructor(carouselId) {
    super(`A completed Windows delivery package for "${carouselId}" already exists and does not match the current archive — pass --replace to overwrite it`);
    this.name = "WindowsDeliveryConflictError";
    this.carouselId = carouselId;
  }
}

/**
 * A destination directory exists for this carousel_id but has no valid
 * metadata.json (an incomplete/interrupted prior copy) — and `replace`
 * was not requested. Never silently resumed or overwritten.
 */
export class WindowsDeliveryPartialPackageError extends Error {
  constructor(carouselId) {
    super(`An incomplete Windows delivery package for "${carouselId}" already exists at the destination — pass --replace to overwrite it`);
    this.name = "WindowsDeliveryPartialPackageError";
    this.carouselId = carouselId;
  }
}

/**
 * The filesystem copy itself failed on a read or write — a genuine I/O
 * failure, not a validation problem. The underlying cause (which may
 * contain a raw host path) is attached as `.cause` for local debugging
 * only, never included in `.message`.
 */
export class WindowsDeliveryPersistenceError extends Error {
  constructor(carouselId, operation, cause) {
    super(`Windows delivery ${operation} failed for carousel "${carouselId}"`, { cause });
    this.name = "WindowsDeliveryPersistenceError";
    this.carouselId = carouselId;
    this.operation = operation;
  }
}

/**
 * After copying, a byte-for-byte comparison between the archive source
 * and the Windows delivery destination found a mismatch — a genuine data
 * integrity problem, not a normal failure mode. Should never happen in
 * practice; this is the safety net, not the expected path.
 */
export class WindowsDeliveryVerificationError extends Error {
  constructor(carouselId, filename) {
    super(`Windows delivery verification failed for carousel "${carouselId}" — "${filename}" does not match the archive source byte-for-byte`);
    this.name = "WindowsDeliveryVerificationError";
    this.carouselId = carouselId;
    this.filename = filename;
  }
}

// DC-003-I004 — generic retry primitive.
//
// Deliberately carousel-agnostic: operates on any async attemptFn returning
// an { ok, ... } result, so it's reusable by later stages (rendering
// retries per DC-003-T001 §6, for example) without modification. Stops as
// soon as an attempt succeeds — never wastes attempts once a good result is
// in hand, and never silently gives up without reporting every attempt
// that was made.

export async function withRetry(attemptFn, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be a positive integer, got ${maxAttempts}`);
  }

  const attempts = [];
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const outcome = await attemptFn(attemptNumber);
    attempts.push(outcome);
    if (outcome.ok) {
      return { ok: true, attempts, attemptCount: attemptNumber, result: outcome };
    }
  }

  return { ok: false, attempts, attemptCount: maxAttempts };
}

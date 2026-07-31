// DC-003-I004 — structured errors for the Carousel Content Generator.
//
// Per-attempt validation failures (parse / schema / content-shape /
// provider) are NOT their own error classes — they're plain
// { ok: false, stage, message, details } result objects returned by
// validateGeneratedCarousel() and collected by withRetry(), consistent
// with how I003's readiness checks return a result rather than throwing
// internally. Only the two genuinely exceptional, top-level conditions
// below are thrown.

export class PromptBuilderError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "PromptBuilderError";
    this.details = details;
  }
}

/**
 * Thrown when every retry attempt failed. `attempts` is the full array of
 * per-attempt result objects (see validateGeneratedCarousel), preserved in
 * full — never collapsed into a single generic message.
 */
export class CarouselGenerationFailedError extends Error {
  constructor(attempts, maxAttempts) {
    const summary = attempts
      .map((attempt, index) => `  attempt ${index + 1}: [${attempt.stage}] ${attempt.message}`)
      .join("\n");
    super(`Carousel generation failed after ${attempts.length}/${maxAttempts} attempt(s):\n${summary}`);
    this.name = "CarouselGenerationFailedError";
    this.attempts = attempts;
    this.maxAttempts = maxAttempts;
  }
}

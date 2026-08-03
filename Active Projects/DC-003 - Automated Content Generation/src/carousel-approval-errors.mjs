// DC-003-I014 — structured errors for the Carousel Approval Workflow.
// Same two-tier split DC-003-I007's Finished Carousel Builder already
// established: "the transition I was asked to perform is not legal from
// this state" (thrown before schema validation is even attempted) versus
// "the assembled object still fails schema validation."

/**
 * The requested transition (approve/reject/publish) is not legal given
 * the Finished Carousel's current `approval` state, or a required
 * argument (approvedBy, reason) was missing/malformed — thrown before any
 * mutation is attempted. Covers: double-approve, double-reject,
 * double-publish, approving a rejected carousel, rejecting an approved or
 * published carousel, and publishing anything not currently approved.
 */
export class InvalidApprovalTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidApprovalTransitionError";
  }
}

/**
 * The transition was legal and applied, but the resulting object still
 * failed schema validation. `errors` is the same
 * { path, keyword, message, params }[] shape createValidator().validate()
 * returns.
 */
export class CarouselApprovalValidationError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    super(`Finished Carousel failed schema validation after approval transition with ${errors.length} error(s):\n${summary}`);
    this.name = "CarouselApprovalValidationError";
    this.errors = errors;
  }
}

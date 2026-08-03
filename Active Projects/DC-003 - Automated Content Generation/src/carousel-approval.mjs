// DC-003-I014 — Carousel Approval Workflow.
//
// Implements the `approval` block DC-003-I007 stubbed and
// finished-carousel.schema.json has reserved since: "approved" / "rejected"
// / "published" — see DC-003-T002 §7. Pure domain logic only, per the
// approved I014 brief:
//   - no persistent storage (operates on a Finished Carousel Object the
//     caller already has, exactly like every other stage in this
//     pipeline — in-memory in, in-memory out);
//   - no n8n integration, no REST/API surface, no authentication (the
//     identity strings this module accepts are opaque, unverified labels,
//     matching the "no auth anywhere yet" status of every other module);
//   - no notifications;
//   - the Execution Ledger (DC-003-I008) is deliberately untouched —
//     approval is a separate lifecycle from pipeline execution, not an
//     extension of it.
//
// Three transitions, one function each — approve, reject, publish — each
// returning a new, independently deep-frozen Finished Carousel Object
// (never mutating the input) and re-validated against
// finished-carousel.schema.json before being returned, the same
// "assemble, then validate" discipline every prior stage in this codebase
// already applies to itself.
//
// State machine (enforced, not merely documented):
//   - approve:  illegal if already approved, illegal if already rejected.
//   - reject:   illegal if already rejected, illegal if already approved,
//               illegal if already published.
//   - publish:  illegal unless already approved, illegal if rejected,
//               illegal if already published.
// No "reset"/"un-approve"/"un-reject" transition exists — deliberately
// out of scope for this milestone (see the I014 brief's open questions).
// A wrong decision is not silently overwritten; it requires a new
// Finished Carousel Object from a fresh pipeline run.
//
// `approved_by` is stored because finished-carousel.schema.json's
// `approval` block has a field for it. There is no `rejected_by` or
// `published_by` field in that schema — this module does not invent one;
// rejectCarousel() and publishCarousel() accordingly do not accept an
// identity argument that would have nowhere valid to go.

import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { InvalidApprovalTransitionError, CarouselApprovalValidationError } from "./carousel-approval-errors.mjs";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkFinishedCarousel(finishedCarousel) {
  if (
    !finishedCarousel ||
    typeof finishedCarousel !== "object" ||
    !isNonEmptyString(finishedCarousel.carousel_id) ||
    !finishedCarousel.approval ||
    typeof finishedCarousel.approval !== "object"
  ) {
    throw new InvalidApprovalTransitionError(
      "expected a validated Finished Carousel Object (with a carousel_id and an approval block) — see finished-carousel-builder.mjs"
    );
  }
}

function validateAndFreeze(finishedCarousel, validator) {
  const validation = validator.validate("finishedCarousel", finishedCarousel);
  if (!validation.valid) {
    throw new CarouselApprovalValidationError(validation.errors);
  }
  return deepFreezeClone(finishedCarousel);
}

/**
 * Approves a Finished Carousel Object. Returns a new, immutable Finished
 * Carousel with `approval.approved: true`, `approved_by`, `approved_at`
 * set — every other field (including every other `approval` field)
 * unchanged from the input.
 *
 * fields.finishedCarousel — the Finished Carousel Object to approve.
 * fields.approvedBy — required, non-empty string identifying who approved
 *   it. Stored verbatim, unverified — this module performs no
 *   authentication.
 *
 * options.now — override the clock (used by tests).
 * options.validator — inject a pre-built validator (used by tests).
 * options.rootDir — passed through when no validator is injected.
 *
 * Throws InvalidApprovalTransitionError if the carousel is already
 * approved, already rejected, or `approvedBy` is missing/blank.
 */
export function approveCarousel(fields = {}, options = {}) {
  const { finishedCarousel, approvedBy } = fields;
  const now = options.now ?? (() => new Date().toISOString());
  const validator = options.validator ?? createValidator(options);

  checkFinishedCarousel(finishedCarousel);

  if (!isNonEmptyString(approvedBy)) {
    throw new InvalidApprovalTransitionError("approveCarousel requires a non-empty string fields.approvedBy");
  }
  if (finishedCarousel.approval.approved) {
    throw new InvalidApprovalTransitionError(
      `carousel_id "${finishedCarousel.carousel_id}" is already approved (by "${finishedCarousel.approval.approved_by}" at ${finishedCarousel.approval.approved_at}) — there is no re-approval transition`
    );
  }
  if (finishedCarousel.approval.rejected) {
    throw new InvalidApprovalTransitionError(
      `carousel_id "${finishedCarousel.carousel_id}" was already rejected (reason: "${finishedCarousel.approval.rejection_reason}") — a rejected carousel cannot be approved`
    );
  }

  const updated = {
    ...finishedCarousel,
    approval: {
      ...finishedCarousel.approval,
      approved: true,
      approved_by: approvedBy,
      approved_at: now(),
    },
  };

  return validateAndFreeze(updated, validator);
}

/**
 * Rejects a Finished Carousel Object. Returns a new, immutable Finished
 * Carousel with `approval.rejected: true`, `rejection_reason` set — every
 * other field unchanged from the input.
 *
 * fields.finishedCarousel — the Finished Carousel Object to reject.
 * fields.reason — required, non-empty string explaining the rejection.
 *   finished-carousel.schema.json has no `rejected_by` field, so this
 *   module accepts no reviewer-identity argument for rejection — there is
 *   nowhere valid in the public contract to put one.
 *
 * options.now / options.validator / options.rootDir — see approveCarousel().
 *
 * Throws InvalidApprovalTransitionError if the carousel is already
 * rejected, already approved, already published, or `reason` is
 * missing/blank.
 */
export function rejectCarousel(fields = {}, options = {}) {
  const { finishedCarousel, reason } = fields;
  const validator = options.validator ?? createValidator(options);

  checkFinishedCarousel(finishedCarousel);

  if (!isNonEmptyString(reason)) {
    throw new InvalidApprovalTransitionError("rejectCarousel requires a non-empty string fields.reason");
  }
  if (finishedCarousel.approval.rejected) {
    throw new InvalidApprovalTransitionError(
      `carousel_id "${finishedCarousel.carousel_id}" is already rejected (reason: "${finishedCarousel.approval.rejection_reason}") — there is no re-rejection transition`
    );
  }
  if (finishedCarousel.approval.published) {
    throw new InvalidApprovalTransitionError(
      `carousel_id "${finishedCarousel.carousel_id}" is already published — a published carousel cannot be rejected`
    );
  }
  if (finishedCarousel.approval.approved) {
    throw new InvalidApprovalTransitionError(
      `carousel_id "${finishedCarousel.carousel_id}" is already approved (by "${finishedCarousel.approval.approved_by}") — an approved carousel cannot be rejected`
    );
  }

  const updated = {
    ...finishedCarousel,
    approval: {
      ...finishedCarousel.approval,
      rejected: true,
      rejection_reason: reason,
    },
  };

  return validateAndFreeze(updated, validator);
}

/**
 * Publishes a Finished Carousel Object. Returns a new, immutable Finished
 * Carousel with `approval.published: true`, `published_at` set — every
 * other field unchanged from the input.
 *
 * fields.finishedCarousel — the Finished Carousel Object to publish. Must
 *   already be approved.
 *
 * finished-carousel.schema.json has no `published_by` field, so this
 * module accepts no publisher-identity argument — there is nowhere valid
 * in the public contract to put one.
 *
 * options.now / options.validator / options.rootDir — see approveCarousel().
 *
 * Throws InvalidApprovalTransitionError if the carousel is not approved,
 * is rejected, or is already published.
 */
export function publishCarousel(fields = {}, options = {}) {
  const { finishedCarousel } = fields;
  const now = options.now ?? (() => new Date().toISOString());
  const validator = options.validator ?? createValidator(options);

  checkFinishedCarousel(finishedCarousel);

  if (finishedCarousel.approval.published) {
    throw new InvalidApprovalTransitionError(`carousel_id "${finishedCarousel.carousel_id}" is already published`);
  }
  if (finishedCarousel.approval.rejected) {
    throw new InvalidApprovalTransitionError(
      `carousel_id "${finishedCarousel.carousel_id}" was rejected (reason: "${finishedCarousel.approval.rejection_reason}") — a rejected carousel cannot be published`
    );
  }
  if (!finishedCarousel.approval.approved) {
    throw new InvalidApprovalTransitionError(
      `carousel_id "${finishedCarousel.carousel_id}" is not approved yet — only an approved carousel can be published`
    );
  }

  const updated = {
    ...finishedCarousel,
    approval: {
      ...finishedCarousel.approval,
      published: true,
      published_at: now(),
    },
  };

  return validateAndFreeze(updated, validator);
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { approveCarousel, rejectCarousel, publishCarousel } from "../../src/carousel-approval.mjs";
import { InvalidApprovalTransitionError, CarouselApprovalValidationError } from "../../src/carousel-approval-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

// Fresh, all-default approval state every time — never share one loaded
// object across tests, since these functions must never need it to.
function loadFreshCarousel() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
}

// --- approveCarousel ----------------------------------------------------

test("approveCarousel sets approved/approved_by/approved_at, leaves everything else unchanged", () => {
  const finishedCarousel = loadFreshCarousel();
  const updated = approveCarousel(
    { finishedCarousel, approvedBy: "chris@digitallyconnected.net" },
    { now: () => "2026-08-04T00:00:00.000Z" }
  );

  assert.equal(updated.approval.approved, true);
  assert.equal(updated.approval.approved_by, "chris@digitallyconnected.net");
  assert.equal(updated.approval.approved_at, "2026-08-04T00:00:00.000Z");
  assert.equal(updated.approval.rejected, false);
  assert.equal(updated.approval.rejection_reason, null);
  assert.equal(updated.approval.published, false);
  assert.equal(updated.approval.published_at, null);

  // every non-approval field is untouched
  assert.equal(updated.carousel_id, finishedCarousel.carousel_id);
  assert.equal(updated.overall_status, finishedCarousel.overall_status);
  assert.deepEqual(updated.slides, finishedCarousel.slides);
});

test("approveCarousel does not mutate the input object", () => {
  const finishedCarousel = loadFreshCarousel();
  approveCarousel({ finishedCarousel, approvedBy: "chris@digitallyconnected.net" });
  assert.equal(finishedCarousel.approval.approved, false);
  assert.equal(finishedCarousel.approval.approved_by, null);
});

test("approveCarousel returns a deeply frozen object — every level rejects mutation", () => {
  const finishedCarousel = loadFreshCarousel();
  const updated = approveCarousel({ finishedCarousel, approvedBy: "chris@digitallyconnected.net" });

  assert.ok(Object.isFrozen(updated));
  assert.ok(Object.isFrozen(updated.approval));
  assert.ok(Object.isFrozen(updated.slides));
  assert.ok(Object.isFrozen(updated.slides[0]));
  assert.throws(() => {
    updated.approval.approved = false;
  }, TypeError);
});

test("approveCarousel throws InvalidApprovalTransitionError when approvedBy is missing", () => {
  const finishedCarousel = loadFreshCarousel();
  assert.throws(() => approveCarousel({ finishedCarousel }), InvalidApprovalTransitionError);
});

test("approveCarousel throws InvalidApprovalTransitionError when approvedBy is blank", () => {
  const finishedCarousel = loadFreshCarousel();
  assert.throws(() => approveCarousel({ finishedCarousel, approvedBy: "   " }), InvalidApprovalTransitionError);
});

test("approveCarousel throws InvalidApprovalTransitionError on an already-approved carousel", () => {
  const finishedCarousel = loadFreshCarousel();
  const approved = approveCarousel({ finishedCarousel, approvedBy: "chris" });
  assert.throws(() => approveCarousel({ finishedCarousel: approved, approvedBy: "someone-else" }), InvalidApprovalTransitionError);
});

test("approveCarousel throws InvalidApprovalTransitionError on an already-rejected carousel", () => {
  const finishedCarousel = loadFreshCarousel();
  const rejected = rejectCarousel({ finishedCarousel, reason: "wrong template" });
  assert.throws(() => approveCarousel({ finishedCarousel: rejected, approvedBy: "chris" }), InvalidApprovalTransitionError);
});

test("approveCarousel throws InvalidApprovalTransitionError for a missing/malformed finishedCarousel", () => {
  assert.throws(() => approveCarousel({ finishedCarousel: null, approvedBy: "chris" }), InvalidApprovalTransitionError);
  assert.throws(() => approveCarousel({ finishedCarousel: {}, approvedBy: "chris" }), InvalidApprovalTransitionError);
});

// --- rejectCarousel -------------------------------------------------------

test("rejectCarousel sets rejected/rejection_reason, leaves everything else unchanged", () => {
  const finishedCarousel = loadFreshCarousel();
  const updated = rejectCarousel({ finishedCarousel, reason: "cover slide headline is wrong" });

  assert.equal(updated.approval.rejected, true);
  assert.equal(updated.approval.rejection_reason, "cover slide headline is wrong");
  assert.equal(updated.approval.approved, false);
  assert.equal(updated.approval.approved_by, null);
  assert.equal(updated.approval.published, false);
});

test("rejectCarousel does not mutate the input object", () => {
  const finishedCarousel = loadFreshCarousel();
  rejectCarousel({ finishedCarousel, reason: "bad copy" });
  assert.equal(finishedCarousel.approval.rejected, false);
});

test("rejectCarousel returns a deeply frozen object", () => {
  const finishedCarousel = loadFreshCarousel();
  const updated = rejectCarousel({ finishedCarousel, reason: "bad copy" });
  assert.ok(Object.isFrozen(updated));
  assert.ok(Object.isFrozen(updated.approval));
});

test("rejectCarousel throws InvalidApprovalTransitionError when reason is missing", () => {
  const finishedCarousel = loadFreshCarousel();
  assert.throws(() => rejectCarousel({ finishedCarousel }), InvalidApprovalTransitionError);
});

test("rejectCarousel throws InvalidApprovalTransitionError when reason is blank", () => {
  const finishedCarousel = loadFreshCarousel();
  assert.throws(() => rejectCarousel({ finishedCarousel, reason: "  " }), InvalidApprovalTransitionError);
});

test("rejectCarousel throws InvalidApprovalTransitionError on an already-rejected carousel", () => {
  const finishedCarousel = loadFreshCarousel();
  const rejected = rejectCarousel({ finishedCarousel, reason: "first reason" });
  assert.throws(() => rejectCarousel({ finishedCarousel: rejected, reason: "second reason" }), InvalidApprovalTransitionError);
});

test("rejectCarousel throws InvalidApprovalTransitionError on an already-approved carousel", () => {
  const finishedCarousel = loadFreshCarousel();
  const approved = approveCarousel({ finishedCarousel, approvedBy: "chris" });
  assert.throws(() => rejectCarousel({ finishedCarousel: approved, reason: "changed my mind" }), InvalidApprovalTransitionError);
});

test("rejectCarousel throws InvalidApprovalTransitionError on an already-published carousel", () => {
  const finishedCarousel = loadFreshCarousel();
  const approved = approveCarousel({ finishedCarousel, approvedBy: "chris" });
  const published = publishCarousel({ finishedCarousel: approved });
  assert.throws(() => rejectCarousel({ finishedCarousel: published, reason: "too late" }), InvalidApprovalTransitionError);
});

// --- publishCarousel -------------------------------------------------------

test("publishCarousel sets published/published_at after approval, leaves everything else unchanged", () => {
  const finishedCarousel = loadFreshCarousel();
  const approved = approveCarousel({ finishedCarousel, approvedBy: "chris" }, { now: () => "2026-08-04T00:00:00.000Z" });
  const published = publishCarousel({ finishedCarousel: approved }, { now: () => "2026-08-04T01:00:00.000Z" });

  assert.equal(published.approval.published, true);
  assert.equal(published.approval.published_at, "2026-08-04T01:00:00.000Z");
  assert.equal(published.approval.approved, true);
  assert.equal(published.approval.approved_by, "chris");
  assert.equal(published.approval.approved_at, "2026-08-04T00:00:00.000Z");
});

test("publishCarousel does not mutate the input object", () => {
  const finishedCarousel = loadFreshCarousel();
  const approved = approveCarousel({ finishedCarousel, approvedBy: "chris" });
  publishCarousel({ finishedCarousel: approved });
  assert.equal(approved.approval.published, false);
});

test("publishCarousel returns a deeply frozen object", () => {
  const finishedCarousel = loadFreshCarousel();
  const approved = approveCarousel({ finishedCarousel, approvedBy: "chris" });
  const published = publishCarousel({ finishedCarousel: approved });
  assert.ok(Object.isFrozen(published));
  assert.ok(Object.isFrozen(published.approval));
});

test("publishCarousel throws InvalidApprovalTransitionError when the carousel is not approved yet", () => {
  const finishedCarousel = loadFreshCarousel();
  assert.throws(() => publishCarousel({ finishedCarousel }), InvalidApprovalTransitionError);
});

test("publishCarousel throws InvalidApprovalTransitionError on an already-published carousel", () => {
  const finishedCarousel = loadFreshCarousel();
  const approved = approveCarousel({ finishedCarousel, approvedBy: "chris" });
  const published = publishCarousel({ finishedCarousel: approved });
  assert.throws(() => publishCarousel({ finishedCarousel: published }), InvalidApprovalTransitionError);
});

test("publishCarousel throws InvalidApprovalTransitionError on a rejected carousel, even if hand-crafted as approved too", () => {
  const finishedCarousel = loadFreshCarousel();
  // Deliberately hand-crafted, invalid-in-practice state: this module
  // must defend against it directly rather than assume its own prior
  // transitions are the only way approval ever gets populated.
  const invalidState = {
    ...finishedCarousel,
    approval: { ...finishedCarousel.approval, approved: true, approved_by: "chris", rejected: true, rejection_reason: "actually no" },
  };
  assert.throws(() => publishCarousel({ finishedCarousel: invalidState }), InvalidApprovalTransitionError);
});

// --- schema validation ------------------------------------------------

test("every transition's output still validates against finished-carousel.schema.json", async () => {
  const { createValidator } = await import("../../src/validator.mjs");
  const validator = createValidator();

  const finishedCarousel = loadFreshCarousel();
  const approved = approveCarousel({ finishedCarousel, approvedBy: "chris" });
  assert.equal(validator.validate("finishedCarousel", approved).valid, true);

  const published = publishCarousel({ finishedCarousel: approved });
  assert.equal(validator.validate("finishedCarousel", published).valid, true);

  const rejected = rejectCarousel({ finishedCarousel: loadFreshCarousel(), reason: "no" });
  assert.equal(validator.validate("finishedCarousel", rejected).valid, true);
});

test("CarouselApprovalValidationError is thrown, not a silent pass, if the assembled object is somehow invalid", () => {
  const finishedCarousel = loadFreshCarousel();
  // Strip a required top-level field so the post-transition object fails
  // schema validation despite the transition itself being legal.
  const malformed = { ...finishedCarousel };
  delete malformed.overall_status;
  assert.throws(() => approveCarousel({ finishedCarousel: malformed, approvedBy: "chris" }), CarouselApprovalValidationError);
});

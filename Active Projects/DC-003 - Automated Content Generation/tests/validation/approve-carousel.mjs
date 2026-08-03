// DC-003-I014 — CLI for the Carousel Approval Workflow: applies one
// approve/reject/publish decision to a Finished Carousel Object JSON
// file. Pure domain logic, offline, no network, no ledger writes — the
// Execution Ledger is deliberately untouched by this milestone.
//
// Usage:
//   node tests/validation/approve-carousel.mjs <finishedCarouselJsonPath> approve --by=<name> [--out=<path>]
//   node tests/validation/approve-carousel.mjs <finishedCarouselJsonPath> reject --reason=<text> [--out=<path>]
//   node tests/validation/approve-carousel.mjs <finishedCarouselJsonPath> publish [--out=<path>]
//
// or: npm run approve -- <path> <decision> [flags]
//
// Without --out, the updated object is only printed to stdout — this CLI
// does not write any file by default, matching every other demonstration
// CLI in this codebase.

import { readFileSync, writeFileSync } from "node:fs";
import { approveCarousel, rejectCarousel, publishCarousel } from "../../src/carousel-approval.mjs";
import { InvalidApprovalTransitionError, CarouselApprovalValidationError } from "../../src/carousel-approval-errors.mjs";

const [filePath, decision, ...rest] = process.argv.slice(2);

function usage() {
  console.error("Usage: node tests/validation/approve-carousel.mjs <finishedCarouselJsonPath> <approve|reject|publish> [--by=<name>] [--reason=<text>] [--out=<path>]");
}

function flagValue(args, name) {
  const prefix = `--${name}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

if (!filePath || !decision) {
  usage();
  process.exit(1);
}

if (!["approve", "reject", "publish"].includes(decision)) {
  console.error(`FAIL  Unknown decision "${decision}" — must be approve, reject, or publish`);
  usage();
  process.exit(1);
}

try {
  const finishedCarousel = JSON.parse(readFileSync(filePath, "utf-8"));

  let updated;
  if (decision === "approve") {
    const approvedBy = flagValue(rest, "by");
    updated = approveCarousel({ finishedCarousel, approvedBy });
  } else if (decision === "reject") {
    const reason = flagValue(rest, "reason");
    updated = rejectCarousel({ finishedCarousel, reason });
  } else {
    updated = publishCarousel({ finishedCarousel });
  }

  console.log(`Carousel ${decision} OK`);
  console.log(`  carousel ID:   ${updated.carousel_id}`);
  console.log(`  approved:      ${updated.approval.approved}`);
  console.log(`  approved by:   ${updated.approval.approved_by}`);
  console.log(`  approved at:   ${updated.approval.approved_at}`);
  console.log(`  rejected:      ${updated.approval.rejected}`);
  console.log(`  rejection reason: ${updated.approval.rejection_reason}`);
  console.log(`  published:     ${updated.approval.published}`);
  console.log(`  published at:  ${updated.approval.published_at}`);

  const outPath = flagValue(rest, "out");
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(updated, null, 2), "utf-8");
    console.log(`  written to:    ${outPath}`);
  }

  process.exit(0);
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`FAIL  File not found: ${filePath}`);
  } else if (error instanceof SyntaxError) {
    console.error(`FAIL  Malformed JSON in ${filePath}: ${error.message}`);
  } else if (error instanceof InvalidApprovalTransitionError) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else if (error instanceof CarouselApprovalValidationError) {
    console.error(`FAIL  Finished Carousel failed schema validation (${error.errors.length} error(s))`);
    for (const e of error.errors) console.error(`  - ${e.path}: ${e.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

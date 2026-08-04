// DC-003-I024 — CLI for the Production Control Centre. The primary
// deliverable of this milestone: a read-only terminal console answering
// "what is my AI workforce doing?" by assembling information already
// stored by the Finished Carousel Store (I015) and Production Metrics
// Store (I023), plus (optionally) the Production Asset Export (I021)
// directory convention. No network calls, no writes of any kind — every
// subcommand below only ever calls createControlCentreService()'s own
// read-only getOverview()/getJobDetail().
//
// Usage:
//   node tests/validation/control-centre.mjs dashboard <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]
//   node tests/validation/control-centre.mjs health    <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]
//   node tests/validation/control-centre.mjs jobs      <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]
//   node tests/validation/control-centre.mjs activity  <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]
//   node tests/validation/control-centre.mjs job <carouselId> <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]
//
//   or: npm run control-centre -- dashboard <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]
//
// `exportsRootDir` is always optional — when omitted, every export signal
// is honestly reported as "unknown" rather than guessed (see README
// "Production Control Centre (DC-003-I024)" for why no fixed default
// export location exists anywhere in this repository's config).
//
// No ANSI colour codes anywhere in this file, per the I024 brief — plain
// text and a bare unicode checkmark/marker only, safe in any terminal.

import { createLocalJsonCarouselStoreAdapter } from "../../src/local-json-carousel-store-adapter.mjs";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import {
  InvalidCarouselStoreAdapterError,
  InvalidCarouselIdentifierError,
  CarouselNotFoundError,
  CorruptedCarouselError,
  CarouselPersistenceError,
} from "../../src/finished-carousel-store-errors.mjs";
import { createLocalJsonProductionMetricsStoreAdapter } from "../../src/local-json-production-metrics-store-adapter.mjs";
import { createProductionMetricsStore } from "../../src/production-metrics-store.mjs";
import { InvalidMetricsStoreAdapterError, MetricsPersistenceError, CorruptedMetricsRecordError } from "../../src/production-metrics-errors.mjs";
import { createControlCentreService } from "../../src/control-centre-service.mjs";
import { InvalidControlCentreDependenciesError, ControlCentreAssemblyError } from "../../src/control-centre-errors.mjs";

const KNOWN_ERRORS = [
  InvalidCarouselStoreAdapterError,
  InvalidCarouselIdentifierError,
  CarouselNotFoundError,
  CorruptedCarouselError,
  CarouselPersistenceError,
  InvalidMetricsStoreAdapterError,
  MetricsPersistenceError,
  CorruptedMetricsRecordError,
  InvalidControlCentreDependenciesError,
  ControlCentreAssemblyError,
];

const RULE = "=".repeat(50);

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/control-centre.mjs dashboard <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]");
  console.error("  node tests/validation/control-centre.mjs health    <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]");
  console.error("  node tests/validation/control-centre.mjs jobs      <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]");
  console.error("  node tests/validation/control-centre.mjs activity  <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]");
  console.error("  node tests/validation/control-centre.mjs job <carouselId> <carouselStoreDirectory> <metricsStoreDirectory> [exportsRootDir]");
  process.exit(1);
}

function marker(status) {
  return status === "ok" ? "OK " : status === "warning" ? "!  " : "?  ";
}

function formatCost(cost) {
  if (cost.records_counted === 0) return "no metrics recorded yet";
  return `${cost.amount} ${cost.currency} (from ${cost.records_counted} metrics record(s))`;
}

function formatDuration(duration) {
  if (duration.records_counted === 0) return "no metrics recorded yet";
  return `${Math.round(duration.average_ms)} ms (from ${duration.records_counted} metrics record(s))`;
}

function printHealthSection(health) {
  console.log("System Health");
  console.log();
  console.log(`  [${marker(health.anthropic.status)}] Anthropic       ${health.anthropic.detail}`);
  console.log(`  [${marker(health.templated.status)}] Templated       ${health.templated.detail}`);
  console.log(`  [${marker(health.export.status)}] Export          ${health.export.detail}`);
  console.log(`  [${marker(health.google_drive.status)}] Google Drive    ${health.google_drive.detail}`);
  console.log(`  [${marker(health.finished_carousel_store.status)}] Carousel Store  ${health.finished_carousel_store.detail}`);
  console.log(`  [${marker(health.production_metrics_store.status)}] Metrics Store   ${health.production_metrics_store.detail}`);
  console.log();
  console.log(`  Overall: ${health.overall.replace("_", " ").toUpperCase()}`);
}

function printProductionSection(dashboard) {
  console.log("Production");
  console.log();
  console.log(`  Completed          ${dashboard.completed}`);
  console.log(`  Failed             ${dashboard.failed}`);
  console.log(`  Partial            ${dashboard.partial}`);
  console.log(`  Awaiting Approval  ${dashboard.awaiting_approval}`);
  console.log(`  Approved           ${dashboard.approved}`);
  console.log(`  Rejected           ${dashboard.rejected}`);
  console.log(`  Exported           ${dashboard.exported === null ? "unknown (no exports root directory supplied)" : dashboard.exported}`);
  console.log(`  Published          ${dashboard.published}`);
  console.log();
  console.log(`  Today's Production        ${dashboard.today.produced_count} job(s)`);
  console.log(`  Today's Estimated Cost    ${formatCost(dashboard.today.estimated_cost)}`);
  console.log(`  All-time Estimated Cost   ${formatCost(dashboard.estimated_cost)}`);
  console.log(`  Average Duration          ${formatDuration(dashboard.average_duration)}`);
}

function printRecentJobsSection(jobs) {
  console.log(`Recent Jobs (${jobs.length})`);
  console.log();
  if (jobs.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const job of jobs) {
    const cost = job.estimated_cost ? `${job.estimated_cost.amount} ${job.estimated_cost.currency}` : "n/a";
    const duration = job.duration_ms === null ? "n/a" : `${job.duration_ms} ms`;
    console.log(
      `  [${job.carousel_id}] ${job.overall_status.padEnd(9)} topic=${job.topic_id} approval=${job.approval_status} ` +
        `export=${job.export_status} published=${job.published} cost=${cost} duration=${duration} completed_at=${job.completed_at}`
    );
  }
}

function printRecentActivitySection(entries) {
  console.log(`Recent Activity (${entries.length})`);
  console.log();
  if (entries.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const entry of entries) {
    const detail = entry.detail ? ` (${entry.detail})` : "";
    console.log(`  ${entry.timestamp}  ${entry.event.padEnd(9)} ${entry.carousel_id} [${entry.topic_id}]${detail}`);
  }
}

function printDashboard(overview) {
  console.log(RULE);
  console.log("DC-003 CONTROL CENTRE");
  console.log(RULE);
  console.log();
  console.log(`Generated at ${overview.generated_at}`);
  console.log();
  printHealthSection(overview.health);
  console.log();
  printProductionSection(overview.dashboard);
  console.log();
  printRecentJobsSection(overview.recent_jobs);
  console.log();
  printRecentActivitySection(overview.recent_activity);
}

function printJobDetail(detail) {
  const job = detail.job;
  const fc = job.finished_carousel;
  console.log(RULE);
  console.log(`JOB DETAIL — ${job.carousel_id}`);
  console.log(RULE);
  console.log();
  console.log("Generation & Rendering");
  console.log(`  topic_id             ${job.topic_id}`);
  console.log(`  carousel_content_id  ${fc.carousel_content_id}`);
  console.log(`  overall_status       ${fc.overall_status}`);
  console.log(`  generated_at         ${fc.generated_at}`);
  console.log(`  execution_id         ${fc.execution_metadata.execution_id}`);
  console.log(`  provider             ${fc.execution_metadata.provider}`);
  console.log(`  rendered_at          ${fc.execution_metadata.rendered_at}`);
  console.log(`  render_duration_ms   ${fc.execution_metadata.render_duration_ms}`);
  console.log(`  slides               ${fc.metadata.completed_slides}/${fc.metadata.total_slides} completed, ${fc.metadata.failed_slides} failed`);
  console.log();
  console.log("Approval");
  const approval = fc.approval ?? {};
  console.log(`  approved   ${approval.approved === true}${approval.approved ? ` (by ${approval.approved_by} at ${approval.approved_at})` : ""}`);
  console.log(`  rejected   ${approval.rejected === true}${approval.rejected ? ` (${approval.rejection_reason})` : ""}`);
  console.log();
  console.log("Export");
  if (!job.export) {
    console.log("  unknown (no exports root directory supplied to the Control Centre)");
  } else if (job.export.exported) {
    console.log("  exported     true");
    console.log(`  path         ${job.export.export_path}`);
    console.log(`  package      ${job.export.asset_package_id}`);
    console.log(`  exported_at  ${job.export.export_timestamp}`);
  } else {
    console.log("  exported     false");
  }
  console.log();
  console.log("Publishing");
  console.log(`  published     ${job.publishing.published}`);
  console.log(`  published_at  ${job.publishing.published_at ?? "n/a"}`);
  console.log(`  note          ${job.publishing.note}`);
  console.log();
  console.log("Metrics");
  if (!job.metrics) {
    console.log("  no Production Metrics Record found for this carousel's execution_id");
  } else {
    const m = job.metrics;
    console.log(`  status        ${m.status}`);
    console.log(`  requests      anthropic=${m.requests.anthropic} templated=${m.requests.templated} google_drive=${m.requests.google_drive}`);
    console.log(
      `  durations_ms  generation=${m.durations_ms.generation} render=${m.durations_ms.render} export=${m.durations_ms.export} ` +
        `publish=${m.durations_ms.publish} total=${m.durations_ms.total}`
    );
    console.log(
      `  costs (${m.costs.currency})  anthropic=${m.costs.anthropic.amount}(${m.costs.anthropic.calculation_type}) ` +
        `templated=${m.costs.templated.amount}(${m.costs.templated.calculation_type}) ` +
        `google_drive=${m.costs.google_drive.amount}(${m.costs.google_drive.calculation_type}) total=${m.costs.total}`
    );
  }
}

function buildService(carouselStoreDirectory, metricsStoreDirectory, exportsRootDir) {
  const finishedCarouselStore = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselStoreDirectory }) });
  const productionMetricsStore = createProductionMetricsStore({ adapter: createLocalJsonProductionMetricsStoreAdapter({ storageDir: metricsStoreDirectory }) });
  return createControlCentreService({ finishedCarouselStore, productionMetricsStore, exportsRootDir: exportsRootDir ?? null });
}

const [subcommand, ...rest] = process.argv.slice(2);
if (!subcommand) usageAndExit();

try {
  if (subcommand === "dashboard") {
    const [carouselStoreDirectory, metricsStoreDirectory, exportsRootDir] = rest;
    if (!carouselStoreDirectory || !metricsStoreDirectory) usageAndExit();
    const service = buildService(carouselStoreDirectory, metricsStoreDirectory, exportsRootDir);
    printDashboard(service.getOverview());
  } else if (subcommand === "health") {
    const [carouselStoreDirectory, metricsStoreDirectory, exportsRootDir] = rest;
    if (!carouselStoreDirectory || !metricsStoreDirectory) usageAndExit();
    const service = buildService(carouselStoreDirectory, metricsStoreDirectory, exportsRootDir);
    printHealthSection(service.getOverview().health);
  } else if (subcommand === "jobs") {
    const [carouselStoreDirectory, metricsStoreDirectory, exportsRootDir] = rest;
    if (!carouselStoreDirectory || !metricsStoreDirectory) usageAndExit();
    const service = buildService(carouselStoreDirectory, metricsStoreDirectory, exportsRootDir);
    printRecentJobsSection(service.getOverview().recent_jobs);
  } else if (subcommand === "activity") {
    const [carouselStoreDirectory, metricsStoreDirectory, exportsRootDir] = rest;
    if (!carouselStoreDirectory || !metricsStoreDirectory) usageAndExit();
    const service = buildService(carouselStoreDirectory, metricsStoreDirectory, exportsRootDir);
    printRecentActivitySection(service.getOverview().recent_activity);
  } else if (subcommand === "job") {
    const [carouselId, carouselStoreDirectory, metricsStoreDirectory, exportsRootDir] = rest;
    if (!carouselId || !carouselStoreDirectory || !metricsStoreDirectory) usageAndExit();
    const service = buildService(carouselStoreDirectory, metricsStoreDirectory, exportsRootDir);
    printJobDetail(service.getJobDetail(carouselId));
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (KNOWN_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}

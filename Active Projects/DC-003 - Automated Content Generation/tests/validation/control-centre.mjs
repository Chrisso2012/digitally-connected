// DC-003-I024, extended by DC-003-I025 — CLI for the Production Control
// Centre. The primary deliverable of I024: a read-only terminal console
// answering "what is my AI workforce doing?" by assembling information
// already stored by the Finished Carousel Store (I015), Production
// Metrics Store (I023), and Publisher Result Store (I025), plus
// (optionally) the Production Asset Export (I021) directory convention.
// No network calls, no writes of any kind — every subcommand below only
// ever calls createControlCentreService()'s own read-only
// getOverview()/getJobDetail().
//
// Usage:
//   node tests/validation/control-centre.mjs dashboard <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]
//   node tests/validation/control-centre.mjs health    <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]
//   node tests/validation/control-centre.mjs jobs      <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]
//   node tests/validation/control-centre.mjs activity  <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]
//   node tests/validation/control-centre.mjs job <carouselId> <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]
//
//   or: npm run control-centre -- dashboard <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]
//
// DC-003-I025 — `publisherResultStoreDirectory` is now a required
// argument (a breaking change from I024's own original 2-argument
// signature, made deliberately: publication evidence is this milestone's
// whole purpose, so unlike `exportsRootDir` it is never optional).
// `exportsRootDir` remains optional — when omitted, every export signal
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
import { createLocalJsonPublisherResultStoreAdapter } from "../../src/local-json-publisher-result-store-adapter.mjs";
import { createPublisherResultStore } from "../../src/publisher-result-store.mjs";
import {
  InvalidPublisherResultStoreAdapterError,
  CorruptedPublisherResultError,
  PublisherResultPersistenceError,
} from "../../src/publisher-result-errors.mjs";
import { createLocalJsonSocialAnalyticsStoreAdapter } from "../../src/local-json-social-analytics-store-adapter.mjs";
import { createSocialAnalyticsStore } from "../../src/social-analytics-store.mjs";
import {
  InvalidSocialAnalyticsStoreAdapterError,
  CorruptedSocialAnalyticsSnapshotError,
  SocialAnalyticsPersistenceError,
} from "../../src/social-analytics-errors.mjs";
import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import {
  InvalidEngineeringWorkOrderStoreAdapterError,
  CorruptedEngineeringWorkOrderError,
  EngineeringWorkOrderPersistenceError,
} from "../../src/engineering-work-order-errors.mjs";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import {
  InvalidEngineeringDeliveryReportStoreAdapterError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
} from "../../src/engineering-delivery-report-errors.mjs";
import { createLocalJsonBridgeTransportStoreAdapter } from "../../src/local-json-bridge-transport-store-adapter.mjs";
import { createBridgeTransportStore } from "../../src/bridge-transport-store.mjs";
import {
  InvalidBridgeTransportStoreAdapterError,
  CorruptedBridgeTransportRecordError,
  BridgeTransportPersistenceError,
} from "../../src/bridge-transport-errors.mjs";
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
  InvalidPublisherResultStoreAdapterError,
  CorruptedPublisherResultError,
  PublisherResultPersistenceError,
  InvalidControlCentreDependenciesError,
  ControlCentreAssemblyError,
  InvalidSocialAnalyticsStoreAdapterError,
  CorruptedSocialAnalyticsSnapshotError,
  SocialAnalyticsPersistenceError,
  InvalidEngineeringWorkOrderStoreAdapterError,
  CorruptedEngineeringWorkOrderError,
  EngineeringWorkOrderPersistenceError,
  InvalidEngineeringDeliveryReportStoreAdapterError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
  InvalidBridgeTransportStoreAdapterError,
  CorruptedBridgeTransportRecordError,
  BridgeTransportPersistenceError,
];

// DC-003-I028/I029/I029.1 — named flags, not more positionals, so each can
// be supplied independently of the already-optional [exportsRootDir]
// positional without any ordering ambiguity.
const NAMED_FLAG_PREFIXES = {
  socialAnalyticsStoreDirectory: "--social-analytics=",
  engineeringWorkOrdersDirectory: "--engineering-work-orders=",
  engineeringDeliveryReportsDirectory: "--engineering-delivery-reports=",
  bridgeTransportStoreDirectory: "--bridge=",
};

function extractNamedFlags(args) {
  const flags = {};
  let rest = args;
  for (const [key, prefix] of Object.entries(NAMED_FLAG_PREFIXES)) {
    const flagArg = rest.find((a) => a.startsWith(prefix));
    flags[key] = flagArg ? flagArg.slice(prefix.length) : null;
    rest = rest.filter((a) => !a.startsWith(prefix));
  }
  return { flags, rest };
}

const RULE = "=".repeat(50);

function usageAndExit() {
  console.error("Usage:");
  console.error("  (append --social-analytics=<dir> to any command below to include Social Performance, DC-003-I028)");
  console.error(
    "  (append --engineering-work-orders=<dir> --engineering-delivery-reports=<dir> to the dashboard command to include Engineering, DC-003-I029)"
  );
  console.error("  (append --bridge=<dir> to the dashboard command to include Bridge Transport, DC-003-I029.1)");
  console.error("  node tests/validation/control-centre.mjs dashboard <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]");
  console.error("  node tests/validation/control-centre.mjs health    <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]");
  console.error("  node tests/validation/control-centre.mjs jobs      <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]");
  console.error("  node tests/validation/control-centre.mjs activity  <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]");
  console.error("  node tests/validation/control-centre.mjs job <carouselId> <carouselStoreDirectory> <metricsStoreDirectory> <publisherResultStoreDirectory> [exportsRootDir]");
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
  console.log(`  [${marker(health.anthropic.status)}] Anthropic          ${health.anthropic.detail}`);
  console.log(`  [${marker(health.templated.status)}] Templated          ${health.templated.detail}`);
  console.log(`  [${marker(health.export.status)}] Export             ${health.export.detail}`);
  console.log(`  [${marker(health.google_drive.status)}] Google Drive       ${health.google_drive.detail}`);
  console.log(`  [${marker(health.finished_carousel_store.status)}] Carousel Store     ${health.finished_carousel_store.detail}`);
  console.log(`  [${marker(health.production_metrics_store.status)}] Metrics Store      ${health.production_metrics_store.detail}`);
  console.log(`  [${marker(health.publisher_result_store.status)}] Publisher Results  ${health.publisher_result_store.detail}`);
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
  if (dashboard.social_analytics === null) {
    console.log("  Social Analytics   unknown (no --social-analytics=<dir> supplied)");
  } else {
    const ig = dashboard.social_analytics.instagram;
    const li = dashboard.social_analytics.linkedin;
    console.log(`  Social Analytics   instagram: ${ig.posts_with_analytics}/${ig.posts_published} posts with analytics   linkedin: ${li.posts_with_analytics}/${li.posts_published} posts with analytics`);
  }
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

function printEngineeringSection(engineering) {
  console.log("Engineering");
  console.log();
  if (engineering === null) {
    console.log("  unknown (no --engineering-work-orders=<dir> --engineering-delivery-reports=<dir> supplied)");
    return;
  }
  console.log(`  Current Milestone          ${engineering.current_milestone ?? "(none)"}`);
  console.log(`  Last Completed Milestone   ${engineering.last_completed_milestone ?? "(none)"}`);
  console.log(`  Outstanding Work Orders    ${engineering.outstanding_work_orders}`);
  console.log(`  Awaiting Review            ${engineering.awaiting_review}`);
  console.log(
    `  Repository Status          ${engineering.repository_status ? `commit=${engineering.repository_status.commit} push=${engineering.repository_status.push_status} tree=${engineering.repository_status.working_tree}` : "(no delivery reports yet)"}`
  );
  console.log(`  Latest Delivery Report     ${engineering.latest_delivery_report?.delivery_report_id ?? "(none)"}`);
}

function printBridgeSection(bridge) {
  console.log("Bridge Transport");
  console.log();
  if (bridge === null) {
    console.log("  unknown (no --bridge=<dir> supplied)");
    return;
  }
  console.log(`  Pending Exports            ${bridge.pending_exports}`);
  console.log(`  Pending Imports            ${bridge.pending_imports}`);
  console.log(`  Transport History Count    ${bridge.history_count}`);
  console.log(`  Last Transport             ${bridge.last_transport?.transport_record_id ?? "(none)"}`);
  console.log(`  Bridge Healthy             ${bridge.healthy}`);
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
  console.log();
  printEngineeringSection(overview.engineering);
  console.log();
  printBridgeSection(overview.bridge);
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
  console.log(`  published        ${job.publishing.published}`);
  console.log(`  Google Drive     ${job.publishing.by_provider.google_drive}`);
  console.log(`  Instagram        ${job.publishing.by_provider.instagram}`);
  console.log(`  LinkedIn         ${job.publishing.by_provider.linkedin}`);
  if (job.publishing.publisher_results.length === 0) {
    console.log("  no Publisher Result found for this carousel");
  } else {
    for (const result of job.publishing.publisher_results) {
      console.log(`  - [${result.publisher_result_id}] provider=${result.provider} destination=${result.destination} published_at=${result.published_at}`);
    }
  }
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
  console.log();
  console.log("Social Performance");
  printSocialPerformanceBlock(job.social_performance);
}

function printSocialPerformanceBlock(socialPerformance) {
  if (socialPerformance === null) {
    console.log("  unknown (no --social-analytics=<dir> supplied to the Control Centre)");
    return;
  }
  for (const provider of ["instagram", "linkedin"]) {
    const platform = socialPerformance[provider];
    console.log(`  ${provider}  collected=${platform.collected}`);
    if (platform.latest_snapshot) {
      const s = platform.latest_snapshot;
      const metricSummary = Object.entries(s.metrics)
        .map(([name, m]) => `${name}=${m.availability === "available" ? m.value : m.availability}`)
        .join(" ");
      const totalEngagement = s.engagement.total.availability === "available" ? s.engagement.total.value : s.engagement.total.availability;
      console.log(`    latest_collected_at=${s.collected_at} ${metricSummary} total_engagement=${totalEngagement}`);
    }
  }
}

function buildService(
  carouselStoreDirectory,
  metricsStoreDirectory,
  publisherResultStoreDirectory,
  exportsRootDir,
  socialAnalyticsStoreDirectory,
  engineeringWorkOrdersDirectory,
  engineeringDeliveryReportsDirectory,
  bridgeTransportStoreDirectory
) {
  const finishedCarouselStore = createFinishedCarouselStore({ adapter: createLocalJsonCarouselStoreAdapter({ storageDir: carouselStoreDirectory }) });
  const productionMetricsStore = createProductionMetricsStore({ adapter: createLocalJsonProductionMetricsStoreAdapter({ storageDir: metricsStoreDirectory }) });
  const publisherResultStore = createPublisherResultStore({ adapter: createLocalJsonPublisherResultStoreAdapter({ storageDir: publisherResultStoreDirectory }) });
  const socialAnalyticsStore = socialAnalyticsStoreDirectory
    ? createSocialAnalyticsStore({ adapter: createLocalJsonSocialAnalyticsStoreAdapter({ storageDir: socialAnalyticsStoreDirectory }) })
    : null;
  const engineeringWorkOrderStore = engineeringWorkOrdersDirectory
    ? createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: engineeringWorkOrdersDirectory }) })
    : null;
  const engineeringDeliveryReportStore = engineeringDeliveryReportsDirectory
    ? createEngineeringDeliveryReportStore({ adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: engineeringDeliveryReportsDirectory }) })
    : null;
  const bridgeTransportStore = bridgeTransportStoreDirectory
    ? createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: bridgeTransportStoreDirectory }) })
    : null;
  return createControlCentreService({
    finishedCarouselStore,
    productionMetricsStore,
    publisherResultStore,
    socialAnalyticsStore,
    engineeringWorkOrderStore,
    engineeringDeliveryReportStore,
    bridgeTransportStore,
    exportsRootDir: exportsRootDir ?? null,
  });
}

const [subcommand, ...rawRest] = process.argv.slice(2);
if (!subcommand) usageAndExit();
const {
  flags: { socialAnalyticsStoreDirectory, engineeringWorkOrdersDirectory, engineeringDeliveryReportsDirectory, bridgeTransportStoreDirectory },
  rest,
} = extractNamedFlags(rawRest);

try {
  if (subcommand === "dashboard") {
    const [carouselStoreDirectory, metricsStoreDirectory, publisherResultStoreDirectory, exportsRootDir] = rest;
    if (!carouselStoreDirectory || !metricsStoreDirectory || !publisherResultStoreDirectory) usageAndExit();
    const service = buildService(
      carouselStoreDirectory,
      metricsStoreDirectory,
      publisherResultStoreDirectory,
      exportsRootDir,
      socialAnalyticsStoreDirectory,
      engineeringWorkOrdersDirectory,
      engineeringDeliveryReportsDirectory,
      bridgeTransportStoreDirectory
    );
    printDashboard(service.getOverview());
  } else if (subcommand === "health") {
    const [carouselStoreDirectory, metricsStoreDirectory, publisherResultStoreDirectory, exportsRootDir] = rest;
    if (!carouselStoreDirectory || !metricsStoreDirectory || !publisherResultStoreDirectory) usageAndExit();
    const service = buildService(
      carouselStoreDirectory,
      metricsStoreDirectory,
      publisherResultStoreDirectory,
      exportsRootDir,
      socialAnalyticsStoreDirectory,
      engineeringWorkOrdersDirectory,
      engineeringDeliveryReportsDirectory,
      bridgeTransportStoreDirectory
    );
    printHealthSection(service.getOverview().health);
  } else if (subcommand === "jobs") {
    const [carouselStoreDirectory, metricsStoreDirectory, publisherResultStoreDirectory, exportsRootDir] = rest;
    if (!carouselStoreDirectory || !metricsStoreDirectory || !publisherResultStoreDirectory) usageAndExit();
    const service = buildService(
      carouselStoreDirectory,
      metricsStoreDirectory,
      publisherResultStoreDirectory,
      exportsRootDir,
      socialAnalyticsStoreDirectory,
      engineeringWorkOrdersDirectory,
      engineeringDeliveryReportsDirectory,
      bridgeTransportStoreDirectory
    );
    printRecentJobsSection(service.getOverview().recent_jobs);
  } else if (subcommand === "activity") {
    const [carouselStoreDirectory, metricsStoreDirectory, publisherResultStoreDirectory, exportsRootDir] = rest;
    if (!carouselStoreDirectory || !metricsStoreDirectory || !publisherResultStoreDirectory) usageAndExit();
    const service = buildService(
      carouselStoreDirectory,
      metricsStoreDirectory,
      publisherResultStoreDirectory,
      exportsRootDir,
      socialAnalyticsStoreDirectory,
      engineeringWorkOrdersDirectory,
      engineeringDeliveryReportsDirectory,
      bridgeTransportStoreDirectory
    );
    printRecentActivitySection(service.getOverview().recent_activity);
  } else if (subcommand === "job") {
    const [carouselId, carouselStoreDirectory, metricsStoreDirectory, publisherResultStoreDirectory, exportsRootDir] = rest;
    if (!carouselId || !carouselStoreDirectory || !metricsStoreDirectory || !publisherResultStoreDirectory) usageAndExit();
    const service = buildService(
      carouselStoreDirectory,
      metricsStoreDirectory,
      publisherResultStoreDirectory,
      exportsRootDir,
      socialAnalyticsStoreDirectory,
      engineeringWorkOrdersDirectory,
      engineeringDeliveryReportsDirectory,
      bridgeTransportStoreDirectory
    );
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

// DC-003-I024, extended by DC-003-I025 — Production Control Centre
// Service: the only module responsible for assembling operational
// information. Observes the existing Finished Carousel Store (I015),
// Production Metrics Store (I023), Publisher Result Store (I025), and —
// only when a caller supplies one — the Production Asset Export (I021)
// directory convention on disk. Never owns, never mutates, never persists
// anything; every value in the returned read model already exists
// somewhere else in the system. No network calls, no provider pings —
// "configured" health signals read env-derived config objects only
// (loadLlmProviderConfig/loadRendererConfig/loadGoogleDrivePublisherConfig),
// exactly the same config loaders the live CLIs already use, never a
// fetch().
//
// One genuine repository gap this module does NOT invent around (see
// README "Production Control Centre (DC-003-I024)"/"Publisher Result
// Store (DC-003-I025)" for the full account): Production Asset Export
// (I021) has no store/query API and no fixed default destination
// anywhere in config — every `npm run export:assets` invocation supplies
// its own destination directory by hand. This service can only report
// export status when the caller explicitly supplies `exportsRootDir`;
// otherwise every export signal is honestly "unknown", never a
// guessed/assumed "not exported".
//
// The equivalent I024-era "published" gap is now CLOSED by I025: every
// `published`/`publishing` value below is sourced from the Publisher
// Result Store — the repository's own authoritative record of a
// successful publish, written by production-asset-publisher-service.mjs
// immediately after each real upload — never from
// finished-carousel.schema.json's disconnected `approval.published`
// field (that DC-003-I014 approval-lifecycle field is a distinct,
// manually-triggered concept and is no longer consulted by this module).
//
// Bounded reads, not a new index: aggregate dashboard counts are computed
// from each store's own list() (cheap summaries, already produced by
// I015/I023/I025). Anything that needs a FULL record (recent activity's
// real timestamps, per-provider render health, per-job cost/duration,
// per-job publisher results) is only fetched for a bounded "recent"
// window, never the whole store — the same "full scan is proportional to
// this milestone's own scope" reasoning production-metrics-store.mjs's
// own findByExecutionId() already applies to itself (and
// publisher-result-store.mjs's own findByCarousel()/findByExecution() now
// mirror). Export-directory reads reuse the exact "metadata.json present
// + parseable + carousel_id matches" identification rule
// production-asset-publisher-service.mjs (I022) already established for
// reading a completed export package back — not a new convention.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { loadLlmProviderConfig } from "./llm-provider-config.mjs";
import { loadRendererConfig } from "./renderer-config.mjs";
import { loadGoogleDrivePublisherConfig } from "./google-drive-publisher-config.mjs";
import { InvalidControlCentreDependenciesError, ControlCentreAssemblyError } from "./control-centre-errors.mjs";

const DEFAULT_RECENT_JOBS_LIMIT = 10;
const DEFAULT_RECENT_ACTIVITY_LIMIT = 20;
const METADATA_FILENAME = "metadata.json";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function toDateOnly(isoString) {
  return typeof isoString === "string" ? isoString.slice(0, 10) : null;
}

function mostRecentIso(isoStrings) {
  const present = isoStrings.filter((value) => typeof value === "string" && value.length > 0);
  if (present.length === 0) return null;
  return present.reduce((latest, current) => (current > latest ? current : latest));
}

function assertDependencies({ finishedCarouselStore, productionMetricsStore, publisherResultStore }) {
  if (
    !finishedCarouselStore ||
    typeof finishedCarouselStore.list !== "function" ||
    typeof finishedCarouselStore.get !== "function"
  ) {
    throw new InvalidControlCentreDependenciesError(
      "fields.finishedCarouselStore must be a Finished Carousel Store — see createFinishedCarouselStore() in finished-carousel-store.mjs"
    );
  }
  if (
    !productionMetricsStore ||
    typeof productionMetricsStore.list !== "function" ||
    typeof productionMetricsStore.get !== "function" ||
    typeof productionMetricsStore.findByExecutionId !== "function"
  ) {
    throw new InvalidControlCentreDependenciesError(
      "fields.productionMetricsStore must be a Production Metrics Store — see createProductionMetricsStore() in production-metrics-store.mjs"
    );
  }
  if (
    !publisherResultStore ||
    typeof publisherResultStore.list !== "function" ||
    typeof publisherResultStore.findByCarousel !== "function"
  ) {
    throw new InvalidControlCentreDependenciesError(
      "fields.publisherResultStore must be a Publisher Result Store — see createPublisherResultStore() in publisher-result-store.mjs"
    );
  }
}

// Reuses I022's own "metadata.json present, parseable, carousel_id
// matches" rule for recognizing a completed export package — see this
// module's own header comment. Returns null only when exportsRootDir
// itself was never supplied (status genuinely never checked); otherwise
// always returns a definitive { exported, ... } object, including for a
// carousel that was never exported.
function readExportStatus(exportsRootDir, carouselId) {
  if (!exportsRootDir) return null;

  const exportDir = path.join(exportsRootDir, carouselId);
  const metadataPath = path.join(exportDir, METADATA_FILENAME);
  const notExported = { exported: false, export_path: null, asset_package_id: null, export_timestamp: null };

  if (!existsSync(metadataPath)) return notExported;

  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
  } catch {
    return notExported;
  }
  if (metadata.carousel_id !== carouselId) return notExported;

  return {
    exported: true,
    export_path: exportDir,
    asset_package_id: metadata.asset_package_id ?? null,
    export_timestamp: metadata.export_timestamp ?? null,
  };
}

function sumCost(metricsSummaries) {
  if (metricsSummaries.length === 0) {
    return { currency: null, amount: 0, records_counted: 0 };
  }
  const currency = metricsSummaries[0].currency ?? null;
  const rawTotal = metricsSummaries.reduce((sum, record) => sum + (record.total_cost ?? 0), 0);
  return { currency, amount: Math.round(rawTotal * 1e6) / 1e6, records_counted: metricsSummaries.length };
}

/**
 * Builds a Control Centre Service.
 *
 * fields.finishedCarouselStore — required, an I015 Finished Carousel Store
 *   instance.
 * fields.productionMetricsStore — required, an I023 Production Metrics
 *   Store instance.
 * fields.publisherResultStore — required (DC-003-I025), a Publisher
 *   Result Store instance — see publisher-result-store.mjs. The
 *   authoritative source for every `published`/`publishing` value this
 *   service returns.
 * fields.exportsRootDir — optional string. When omitted, every export
 *   signal in the read model is honestly "unknown" — see this module's own
 *   header comment.
 *
 * options.now — override the clock (used by tests).
 * options.env — override process.env (used by tests, and by the health
 *   checks' config loaders).
 * options.validator — inject a pre-built validator (used by tests).
 * options.rootDir — passed through when no validator is injected.
 * options.recentJobsLimit — how many most-recently-generated carousels
 *   `getOverview().recent_jobs` returns (default 10).
 * options.recentActivityLimit — how many activity entries
 *   `getOverview().recent_activity` returns (default 20).
 *
 * Returns { getOverview, getJobDetail }.
 */
export function createControlCentreService(fields = {}, options = {}) {
  const { finishedCarouselStore, productionMetricsStore, publisherResultStore, exportsRootDir = null } = fields;
  assertDependencies({ finishedCarouselStore, productionMetricsStore, publisherResultStore });

  const now = options.now ?? (() => new Date().toISOString());
  const env = options.env ?? process.env;
  const validator = options.validator ?? createValidator(options);
  const recentJobsLimit = options.recentJobsLimit ?? DEFAULT_RECENT_JOBS_LIMIT;
  const recentActivityLimit = options.recentActivityLimit ?? DEFAULT_RECENT_ACTIVITY_LIMIT;
  const recentWindowSize = Math.max(recentJobsLimit, recentActivityLimit);

  function readCarouselStore() {
    try {
      return { ok: true, summaries: finishedCarouselStore.list() };
    } catch (cause) {
      return { ok: false, summaries: [], error: cause };
    }
  }

  function readMetricsStore() {
    try {
      return { ok: true, summaries: productionMetricsStore.list() };
    } catch (cause) {
      return { ok: false, summaries: [], error: cause };
    }
  }

  function readPublisherResultStore() {
    try {
      return { ok: true, summaries: publisherResultStore.list() };
    } catch (cause) {
      return { ok: false, summaries: [], error: cause };
    }
  }

  function findMetricsForExecution(executionId) {
    if (!isNonEmptyString(executionId)) return null;
    try {
      const matches = productionMetricsStore.findByExecutionId(executionId);
      return matches[0] ?? null;
    } catch {
      return null;
    }
  }

  // Best-effort, mirroring findMetricsForExecution()'s own "tolerate a
  // secondary store's own failure, never let it crash the whole read
  // model" discipline — a Publisher Result Store hiccup degrades to "no
  // publisher results found" rather than throwing.
  function findPublisherResultsForCarousel(carouselId) {
    try {
      return publisherResultStore.findByCarousel(carouselId);
    } catch {
      return [];
    }
  }

  // Assembles everything both getOverview() and its own sub-sections need,
  // in one pass — a single read of each store, plus full records for a
  // bounded "recent" window only (see header comment).
  function assembleCore() {
    const carouselRead = readCarouselStore();
    const metricsRead = readMetricsStore();
    const publisherResultRead = readPublisherResultStore();
    // One cheap list() scan builds a membership set for O(1) "has this
    // carousel_id been published" lookups in the dashboard/job-summary
    // aggregations below — no per-carousel findByCarousel() call, no
    // second index invented.
    const publishedCarouselIds = new Set(publisherResultRead.summaries.map((s) => s.carousel_id));

    const sortedSummaries = [...carouselRead.summaries].sort((a, b) =>
      a.generated_at < b.generated_at ? 1 : a.generated_at > b.generated_at ? -1 : 0
    );
    const recentSummaries = sortedSummaries.slice(0, recentWindowSize);
    const recentFull = recentSummaries
      .map((summary) => {
        try {
          return finishedCarouselStore.get(summary.carousel_id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Duration averaging needs durations_ms, which list() summaries don't
    // carry (only total_cost does) — full-record fetch bounded by store
    // size, mirroring findByExecutionId()'s own full-scan precedent.
    const metricsFull = metricsRead.summaries
      .map((summary) => {
        try {
          return productionMetricsStore.get(summary.metrics_id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return { carouselRead, metricsRead, publisherResultRead, publishedCarouselIds, sortedSummaries, recentSummaries, recentFull, metricsFull };
  }

  function checkExportHealth(recentFull) {
    if (!exportsRootDir) {
      return { status: "unknown", detail: "no exports root directory supplied to the Control Centre", last_success_at: null };
    }
    let entryCount;
    try {
      entryCount = existsSync(exportsRootDir) ? readdirSync(exportsRootDir).length : 0;
    } catch (cause) {
      return { status: "warning", detail: `exports root directory is not readable (${cause.code ?? "error"})`, last_success_at: null };
    }
    const exportTimestamps = recentFull
      .map((carousel) => readExportStatus(exportsRootDir, carousel.carousel_id))
      .filter((info) => info?.exported)
      .map((info) => info.export_timestamp);
    return {
      status: "ok",
      detail: `exports root directory is readable (${entryCount} entrie(s))`,
      last_success_at: mostRecentIso(exportTimestamps),
    };
  }

  function checkAnthropicHealth(recentFull) {
    const config = loadLlmProviderConfig(env);
    const configured = isNonEmptyString(config.apiKey);
    // Finished Carousel Object carries no llm_model/provider field (a
    // documented gap — see backlog B001), so this cannot distinguish a
    // live Anthropic generation from a mock one; it reports the most
    // recent completion of any provider. Scoped to the bounded recent
    // window, not a full-store scan.
    return {
      status: configured ? "ok" : "warning",
      detail: configured ? "LLM_API_KEY is set" : "LLM_API_KEY is not set",
      last_success_at: mostRecentIso(recentFull.map((carousel) => carousel.generated_at)),
    };
  }

  function checkTemplatedHealth(recentFull) {
    const config = loadRendererConfig(env);
    const configured = isNonEmptyString(config.apiKey);
    // execution_metadata.provider IS a reliable real-vs-mock signal
    // (renderer-transport-http.mjs stamps "templated-http"; the mock
    // transport stamps "mock-transport") — scoped to the bounded recent
    // window, not a full-store scan.
    const realRenders = recentFull.filter((carousel) => carousel.execution_metadata?.provider === "templated-http");
    return {
      status: configured ? "ok" : "warning",
      detail: configured ? "TEMPLATED_API_KEY is set" : "TEMPLATED_API_KEY is not set",
      last_success_at: mostRecentIso(realRenders.map((carousel) => carousel.execution_metadata.rendered_at)),
    };
  }

  function checkGoogleDriveHealth(publisherResultSummaries) {
    const config = loadGoogleDrivePublisherConfig(env);
    const configured =
      isNonEmptyString(config.clientId) &&
      isNonEmptyString(config.clientSecret) &&
      isNonEmptyString(config.refreshToken) &&
      isNonEmptyString(config.rootFolderId);
    // DC-003-I025 closed the gap I024 left here: `last_success_at` is now
    // the newest Publisher Result timestamp for provider "google-drive" —
    // real repository evidence of a completed upload, not a permanent
    // null. Scans all Publisher Result summaries (cheap — provider/
    // published_at are both already on the summary), not just the recent
    // window, since this store's own list() is already a single scan.
    const driveResults = publisherResultSummaries.filter((s) => s.provider === "google-drive");
    return {
      status: configured ? "ok" : "warning",
      detail: configured
        ? "Google Drive credentials and root folder are configured"
        : "Google Drive is not fully configured (client ID/secret, refresh token, or root folder ID missing)",
      last_success_at: mostRecentIso(driveResults.map((s) => s.published_at)),
    };
  }

  function rollupOverallHealth({ finishedCarouselStoreHealth, productionMetricsStoreHealth, publisherResultStoreHealth, ...rest }) {
    if (
      finishedCarouselStoreHealth.status === "warning" ||
      productionMetricsStoreHealth.status === "warning" ||
      publisherResultStoreHealth.status === "warning"
    ) {
      return "attention_required";
    }
    if (Object.values(rest).some((check) => check.status === "warning")) {
      return "warning";
    }
    return "healthy";
  }

  function computeHealth({ carouselRead, metricsRead, publisherResultRead, recentFull }) {
    const finishedCarouselStoreHealth = carouselRead.ok
      ? { status: "ok", detail: `store directory is readable (${carouselRead.summaries.length} record(s))`, last_success_at: null }
      : { status: "warning", detail: `store is not readable (${carouselRead.error.code ?? "error"})`, last_success_at: null };

    const productionMetricsStoreHealth = metricsRead.ok
      ? { status: "ok", detail: `store directory is readable (${metricsRead.summaries.length} record(s))`, last_success_at: null }
      : { status: "warning", detail: `store is not readable (${metricsRead.error.code ?? "error"})`, last_success_at: null };

    const publisherResultStoreHealth = publisherResultRead.ok
      ? { status: "ok", detail: `store directory is readable (${publisherResultRead.summaries.length} record(s))`, last_success_at: null }
      : { status: "warning", detail: `store is not readable (${publisherResultRead.error.code ?? "error"})`, last_success_at: null };

    const anthropic = checkAnthropicHealth(recentFull);
    const templated = checkTemplatedHealth(recentFull);
    const exportHealth = checkExportHealth(recentFull);
    const googleDrive = checkGoogleDriveHealth(publisherResultRead.summaries);

    return {
      anthropic,
      templated,
      export: exportHealth,
      google_drive: googleDrive,
      finished_carousel_store: finishedCarouselStoreHealth,
      production_metrics_store: productionMetricsStoreHealth,
      publisher_result_store: publisherResultStoreHealth,
      overall: rollupOverallHealth({
        finishedCarouselStoreHealth,
        productionMetricsStoreHealth,
        publisherResultStoreHealth,
        anthropic,
        templated,
        export: exportHealth,
        googleDrive,
      }),
    };
  }

  function computeDashboard({ carouselRead, metricsRead, metricsFull, publishedCarouselIds }) {
    const summaries = carouselRead.summaries;
    const completed = summaries.filter((s) => s.overall_status === "completed").length;
    const failed = summaries.filter((s) => s.overall_status === "failed").length;
    const partial = summaries.filter((s) => s.overall_status === "partial").length;
    const approved = summaries.filter((s) => s.approved === true).length;
    const rejected = summaries.filter((s) => s.rejected === true).length;
    // DC-003-I025 — "published" now means "at least one Publisher Result
    // exists for this carousel_id," not the disconnected
    // approval.published summary field (still present on the summary but
    // no longer consulted here).
    const published = summaries.filter((s) => publishedCarouselIds.has(s.carousel_id)).length;
    const awaitingApproval = summaries.filter(
      (s) => s.overall_status === "completed" && s.approved !== true && s.rejected !== true
    ).length;

    let exported = null;
    if (exportsRootDir) {
      const eligible = summaries.filter((s) => s.overall_status === "completed" && s.approved === true);
      exported = eligible.filter((s) => readExportStatus(exportsRootDir, s.carousel_id)?.exported === true).length;
    }

    const today = toDateOnly(now());
    const todaysMetrics = metricsRead.summaries.filter((m) => toDateOnly(m.recorded_at) === today);
    const todaysProducedCount = summaries.filter((s) => toDateOnly(s.generated_at) === today).length;

    const totalDurations = metricsFull.map((record) => record.durations_ms.total).filter((v) => typeof v === "number");
    const averageDuration = {
      average_ms: totalDurations.length > 0 ? totalDurations.reduce((a, b) => a + b, 0) / totalDurations.length : null,
      records_counted: totalDurations.length,
    };

    return {
      completed,
      failed,
      partial,
      awaiting_approval: awaitingApproval,
      approved,
      rejected,
      exported,
      published,
      today: { produced_count: todaysProducedCount, estimated_cost: sumCost(todaysMetrics) },
      estimated_cost: sumCost(metricsRead.summaries),
      average_duration: averageDuration,
    };
  }

  function computeJobSummary(summary, publishedCarouselIds) {
    const metrics = findMetricsForExecution(summary.execution_id);
    const exportInfo = readExportStatus(exportsRootDir, summary.carousel_id);
    const approvalStatus = summary.rejected ? "rejected" : summary.approved ? "approved" : "awaiting_approval";

    return {
      carousel_id: summary.carousel_id,
      topic_id: summary.topic_id,
      execution_id: summary.execution_id,
      overall_status: summary.overall_status,
      completed_at: summary.generated_at,
      approval_status: approvalStatus,
      export_status: exportInfo === null ? "unknown" : exportInfo.exported ? "exported" : "not_exported",
      // DC-003-I025 — sourced from the Publisher Result Store, not the
      // disconnected approval.published summary field.
      published: publishedCarouselIds.has(summary.carousel_id),
      estimated_cost: metrics ? { amount: metrics.costs.total, currency: metrics.costs.currency } : null,
      duration_ms: metrics ? metrics.durations_ms.total : null,
    };
  }

  function computeActivity(recentFull) {
    const entries = [];
    for (const carousel of recentFull) {
      entries.push({
        timestamp: carousel.generated_at,
        event: "generated",
        carousel_id: carousel.carousel_id,
        topic_id: carousel.topic_id,
        detail: null,
      });
      if (carousel.execution_metadata?.rendered_at) {
        entries.push({
          timestamp: carousel.execution_metadata.rendered_at,
          event: "rendered",
          carousel_id: carousel.carousel_id,
          topic_id: carousel.topic_id,
          detail: `provider=${carousel.execution_metadata.provider}`,
        });
      }
      if (carousel.approval?.approved && carousel.approval.approved_at) {
        entries.push({
          timestamp: carousel.approval.approved_at,
          event: "approved",
          carousel_id: carousel.carousel_id,
          topic_id: carousel.topic_id,
          detail: carousel.approval.approved_by ? `approved_by=${carousel.approval.approved_by}` : null,
        });
      }
      // DC-003-I025 — one activity entry per real Publisher Result found
      // (a carousel can legitimately be published more than once, e.g.
      // re-published, or to more than one provider once a non-Drive
      // publisher exists) — sourced from the Publisher Result Store, not
      // the disconnected approval.published field.
      for (const publisherResult of findPublisherResultsForCarousel(carousel.carousel_id)) {
        entries.push({
          timestamp: publisherResult.published_at,
          event: "published",
          carousel_id: carousel.carousel_id,
          topic_id: carousel.topic_id,
          detail: `provider=${publisherResult.provider}`,
        });
      }
      const exportInfo = readExportStatus(exportsRootDir, carousel.carousel_id);
      if (exportInfo?.exported && exportInfo.export_timestamp) {
        entries.push({
          timestamp: exportInfo.export_timestamp,
          event: "exported",
          carousel_id: carousel.carousel_id,
          topic_id: carousel.topic_id,
          detail: exportInfo.asset_package_id ? `asset_package_id=${exportInfo.asset_package_id}` : null,
        });
      }
    }
    entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
    return entries.slice(0, recentActivityLimit);
  }

  function validateAndFreeze(model) {
    const validation = validator.validate("controlCentre", model);
    if (!validation.valid) {
      throw new ControlCentreAssemblyError(validation.errors);
    }
    return deepFreezeClone(model);
  }

  /**
   * Assembles the full "overview" read model: system health, dashboard
   * totals, recent jobs, and recent activity, all from one consistent
   * snapshot of the stores. Never throws for a broken store — a store read
   * failure is folded into that store's own health check instead (see
   * computeHealth()); it only throws ControlCentreAssemblyError if this
   * module's own assembly logic produces something that doesn't match
   * control-centre.schema.json (a bug in this file, not a data problem).
   */
  function getOverview() {
    const core = assembleCore();

    const overview = {
      kind: "overview",
      generated_at: now(),
      health: computeHealth(core),
      dashboard: computeDashboard(core),
      recent_jobs: core.recentSummaries.slice(0, recentJobsLimit).map((summary) => computeJobSummary(summary, core.publishedCarouselIds)),
      recent_activity: computeActivity(core.recentFull),
    };

    return validateAndFreeze(overview);
  }

  // DC-003-I027 — breaks the same Publisher Result evidence down by
  // platform, since the general `published` boolean alone can no longer
  // distinguish "published to Google Drive" from "published to Instagram"
  // once more than one provider exists. No live provider/social-platform
  // query — purely a grouping over `publisherResults`, already fetched.
  function computeByProvider(publisherResults) {
    const publishedProviders = new Set(publisherResults.map((result) => result.provider));
    return {
      google_drive: publishedProviders.has("google-drive") ? "completed" : "not_recorded",
      instagram: publishedProviders.has("instagram") ? "completed" : "not_recorded",
      linkedin: publishedProviders.has("linkedin") ? "completed" : "not_recorded",
    };
  }

  /**
   * Assembles one carousel's full operational picture — generation,
   * rendering, and approval (embedded whole as `finished_carousel`, itself
   * re-validated against finished-carousel.schema.json), metrics (embedded
   * whole when a matching record exists, else null), export status, and
   * publishing (DC-003-I025, extended by DC-003-I027 — every Publisher
   * Result found for this carousel_id, embedded whole, plus a
   * per-provider completed/not_recorded breakdown).
   *
   * Propagates whatever error finishedCarouselStore.get(carouselId) itself
   * throws (InvalidCarouselIdentifierError, CarouselNotFoundError,
   * CorruptedCarouselError, CarouselPersistenceError) — this service
   * invents no new "carousel not found" concept of its own.
   */
  function getJobDetail(carouselId) {
    const finishedCarousel = finishedCarouselStore.get(carouselId);
    const metrics = findMetricsForExecution(finishedCarousel.execution_metadata.execution_id);
    const exportInfo = readExportStatus(exportsRootDir, carouselId);
    const publisherResults = findPublisherResultsForCarousel(carouselId);

    const detail = {
      kind: "job_detail",
      generated_at: now(),
      job: {
        carousel_id: finishedCarousel.carousel_id,
        topic_id: finishedCarousel.topic_id,
        finished_carousel: finishedCarousel,
        metrics,
        export: exportInfo,
        publishing: {
          published: publisherResults.length > 0,
          publisher_results: publisherResults,
          by_provider: computeByProvider(publisherResults),
        },
      },
    };

    return validateAndFreeze(detail);
  }

  return { getOverview, getJobDetail };
}

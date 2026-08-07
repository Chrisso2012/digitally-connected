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
import { createEngineeringWorkManagementService } from "./engineering-work-management-service.mjs";
import { getQueue as getBridgeQueue } from "./bridge-transport-service.mjs";
import { createDeliveryExecutionLock } from "./delivery-execution-lock.mjs";
import { loadDeliveryOfficeRunnerConfig } from "./delivery-office-runner-config.mjs";
import { createStrategyReviewLock } from "./strategy-review-lock.mjs";
import { describeAuthenticationAvailability as describeOpenAiAuthenticationAvailability } from "./strategy-review-config.mjs";
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

function assertDependencies({
  finishedCarouselStore,
  productionMetricsStore,
  publisherResultStore,
  socialAnalyticsStore,
  engineeringWorkOrderStore,
  engineeringDeliveryReportStore,
  bridgeTransportStore,
  strategyReviewStore,
  ingestedContentStore,
  editorialPackageStore,
}) {
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
  // DC-003-I028 — optional, like exportsRootDir: when omitted, every
  // social-performance signal is honestly "unknown" rather than checked.
  // When supplied, it must actually be a Social Analytics Store.
  if (
    socialAnalyticsStore !== null &&
    socialAnalyticsStore !== undefined &&
    (typeof socialAnalyticsStore.list !== "function" || typeof socialAnalyticsStore.findByCarousel !== "function")
  ) {
    throw new InvalidControlCentreDependenciesError(
      "fields.socialAnalyticsStore, when supplied, must be a Social Analytics Store — see createSocialAnalyticsStore() in social-analytics-store.mjs"
    );
  }
  // DC-003-I029 — optional, like socialAnalyticsStore: the Engineering
  // section is supplied as a matched pair (both stores together, or
  // neither) since the read model always joins them — a caller supplying
  // only one is a wiring bug, not a legitimate partial configuration.
  const engineeringStoresSupplied = Boolean(engineeringWorkOrderStore) || Boolean(engineeringDeliveryReportStore);
  if (engineeringStoresSupplied) {
    if (
      !engineeringWorkOrderStore ||
      typeof engineeringWorkOrderStore.list !== "function" ||
      typeof engineeringWorkOrderStore.get !== "function"
    ) {
      throw new InvalidControlCentreDependenciesError(
        "fields.engineeringWorkOrderStore must be supplied together with fields.engineeringDeliveryReportStore, and must be an Engineering Work Order Store"
      );
    }
    if (
      !engineeringDeliveryReportStore ||
      typeof engineeringDeliveryReportStore.list !== "function" ||
      typeof engineeringDeliveryReportStore.findByWorkOrder !== "function"
    ) {
      throw new InvalidControlCentreDependenciesError(
        "fields.engineeringDeliveryReportStore must be supplied together with fields.engineeringWorkOrderStore, and must be an Engineering Delivery Report Store"
      );
    }
  }
  // DC-003-I029.1 — optional, standalone (not paired) — the Bridge
  // section needs only the Bridge Transport Store itself.
  if (
    bridgeTransportStore !== null &&
    bridgeTransportStore !== undefined &&
    (typeof bridgeTransportStore.list !== "function" || typeof bridgeTransportStore.get !== "function")
  ) {
    throw new InvalidControlCentreDependenciesError(
      "fields.bridgeTransportStore, when supplied, must be a Bridge Transport Store — see createBridgeTransportStore() in bridge-transport-store.mjs"
    );
  }
  // DC-003-I029.3 — optional, standalone (not paired with the Engineering
  // pair) — decision counts only need the Strategy Review Store itself;
  // reviews_awaiting_execution additionally uses the Engineering pair
  // when that is ALSO supplied, but never requires it.
  if (
    strategyReviewStore !== null &&
    strategyReviewStore !== undefined &&
    (typeof strategyReviewStore.list !== "function" || typeof strategyReviewStore.get !== "function")
  ) {
    throw new InvalidControlCentreDependenciesError(
      "fields.strategyReviewStore, when supplied, must be an Engineering Strategy Review Store — see createEngineeringStrategyReviewStore() in engineering-strategy-review-store.mjs"
    );
  }
  // DC-003-I030 — optional, standalone (not paired with anything above) —
  // the Content Ingestion section needs only the Ingested Content Store
  // itself.
  if (
    ingestedContentStore !== null &&
    ingestedContentStore !== undefined &&
    (typeof ingestedContentStore.list !== "function" || typeof ingestedContentStore.get !== "function")
  ) {
    throw new InvalidControlCentreDependenciesError(
      "fields.ingestedContentStore, when supplied, must be an Ingested Content Store — see createIngestedContentStore() in ingested-content-store.mjs"
    );
  }
  // DC-003-I031 — optional, standalone (not paired with anything above) —
  // the Editorial Package section needs only the Editorial Package Store
  // itself.
  if (
    editorialPackageStore !== null &&
    editorialPackageStore !== undefined &&
    (typeof editorialPackageStore.list !== "function" || typeof editorialPackageStore.get !== "function")
  ) {
    throw new InvalidControlCentreDependenciesError(
      "fields.editorialPackageStore, when supplied, must be an Editorial Package Store — see createEditorialPackageStore() in editorial-package-store.mjs"
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
 * fields.socialAnalyticsStore — optional (DC-003-I028), a Social Analytics
 *   Store instance — see social-analytics-store.mjs. When omitted, every
 *   `social_performance`/`dashboard.social_analytics` signal is honestly
 *   null (never checked), mirroring exportsRootDir's own "unknown, not
 *   zero" convention.
 * fields.engineeringWorkOrderStore / engineeringDeliveryReportStore —
 *   optional (DC-003-I029), supplied together or not at all — see
 *   engineering-work-order-store.mjs / engineering-delivery-report-store.mjs.
 *   When omitted, `engineering` is null.
 * fields.bridgeTransportStore — optional (DC-003-I029.1), standalone (not
 *   paired) — see bridge-transport-store.mjs. When omitted, `bridge` is
 *   null.
 * fields.deliveryOfficeLockDir — optional (DC-003-I029.2) string, an
 *   Execution Lock directory (see delivery-execution-lock.mjs). When
 *   omitted, `delivery_office.lock_status.checked` is honestly false.
 *   `delivery_office` itself is null unless the Engineering store pair
 *   above is also supplied.
 * fields.strategyReviewStore — optional (DC-003-I029.3), standalone (not
 *   paired) — see engineering-strategy-review-store.mjs. Decision counts
 *   need only this store; `reviews_awaiting_execution` additionally uses
 *   the Engineering pair above when that is ALSO supplied. `strategy_review`
 *   itself is null unless this store is supplied.
 * fields.strategyReviewLockDir — optional (DC-003-I029.3) string, a
 *   Strategy Review Lock directory (see strategy-review-lock.mjs). When
 *   omitted, `strategy_review.review_currently_locked` is honestly null.
 * fields.ingestedContentStore — optional (DC-003-I030), standalone — see
 *   ingested-content-store.mjs. When omitted, `content_ingestion` is
 *   null. A lean summary only (counts, latest record's own small fields)
 *   — never embeds a record's full_article_text, unlike the Engineering
 *   section's full latest_delivery_report embed, since article bodies
 *   are unbounded in size and would bloat the read model — see README
 *   "Control Centre".
 * fields.editorialPackageStore — optional (DC-003-I031), standalone — see
 *   editorial-package-store.mjs. When omitted, `editorial_package` is
 *   null. Also a lean summary only, mirroring `content_ingestion`'s own
 *   precedent exactly.
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
  const {
    finishedCarouselStore,
    productionMetricsStore,
    publisherResultStore,
    socialAnalyticsStore = null,
    engineeringWorkOrderStore = null,
    engineeringDeliveryReportStore = null,
    bridgeTransportStore = null,
    deliveryOfficeLockDir = null,
    strategyReviewStore = null,
    strategyReviewLockDir = null,
    ingestedContentStore = null,
    editorialPackageStore = null,
    exportsRootDir = null,
  } = fields;
  assertDependencies({
    finishedCarouselStore,
    productionMetricsStore,
    publisherResultStore,
    socialAnalyticsStore,
    engineeringWorkOrderStore,
    engineeringDeliveryReportStore,
    bridgeTransportStore,
    strategyReviewStore,
    ingestedContentStore,
    editorialPackageStore,
  });

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

    const analyticsSummaries = readSocialAnalyticsSummaries();

    return {
      carouselRead,
      metricsRead,
      publisherResultRead,
      analyticsSummaries,
      publishedCarouselIds,
      sortedSummaries,
      recentSummaries,
      recentFull,
      metricsFull,
    };
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

  // DC-003-I028 — best-effort, mirroring findPublisherResultsForCarousel()'s
  // own "tolerate a secondary store's own failure" discipline. null when
  // no Social Analytics Store was supplied — every caller of this must
  // treat null as "never checked", never as "zero".
  function readSocialAnalyticsSummaries() {
    if (!socialAnalyticsStore) return null;
    try {
      return socialAnalyticsStore.list();
    } catch {
      return [];
    }
  }

  function computeSocialAnalyticsDashboard(publisherResultSummaries, analyticsSummaries) {
    if (analyticsSummaries === null) return null;
    const withAnalytics = new Set(analyticsSummaries.map((s) => `${s.provider}:${s.publisher_result_id}`));
    const forProvider = (provider) => {
      const published = publisherResultSummaries.filter((s) => s.provider === provider);
      const withAnalyticsCount = published.filter((s) => withAnalytics.has(`${provider}:${s.publisher_result_id}`)).length;
      return { posts_published: published.length, posts_with_analytics: withAnalyticsCount };
    };
    return { instagram: forProvider("instagram"), linkedin: forProvider("linkedin") };
  }

  // DC-003-I028 — the latest snapshot per provider for one carousel,
  // sourced entirely from the Social Analytics Store's own findByCarousel()
  // (already chronologically ordered). null when no store was supplied.
  function computeSocialPerformance(carouselId) {
    if (!socialAnalyticsStore) return null;
    let snapshots;
    try {
      snapshots = socialAnalyticsStore.findByCarousel(carouselId);
    } catch {
      snapshots = [];
    }
    const latestFor = (provider) => {
      const matches = snapshots.filter((s) => s.provider === provider);
      return matches.length > 0 ? matches[matches.length - 1] : null;
    };
    const instagramLatest = latestFor("instagram");
    const linkedinLatest = latestFor("linkedin");
    return {
      instagram: { collected: instagramLatest !== null, latest_snapshot: instagramLatest },
      linkedin: { collected: linkedinLatest !== null, latest_snapshot: linkedinLatest },
    };
  }

  function computeDashboard({ carouselRead, metricsRead, metricsFull, publishedCarouselIds, publisherResultRead, analyticsSummaries }) {
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
      social_analytics: computeSocialAnalyticsDashboard(publisherResultRead.summaries, analyticsSummaries),
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

  // DC-003-I029 — read-only, additive. Delegates the actual join/derive
  // logic entirely to createEngineeringWorkManagementService() (the same
  // module tests/validation/engineering.mjs's own `status` subcommand
  // uses) rather than re-implementing it here — one source of truth for
  // "what does Engineering status mean." null when either store was never
  // supplied; on a genuine read failure from an already-supplied store,
  // degrades to an honest all-zero/null summary rather than throwing —
  // mirrors this module's own "a secondary store's own failure never
  // crashes the whole read model" discipline (see
  // findPublisherResultsForCarousel()'s own comment above).
  function computeEngineering() {
    if (!engineeringWorkOrderStore || !engineeringDeliveryReportStore) return null;
    try {
      // DC-003-I029.3 — getStatus() gained additive review-status fields
      // (approved_by_review/etc., latest_strategy_review) once a
      // strategyReviewStore is passed to createEngineeringWorkManagementService().
      // This section deliberately never passes one and explicitly picks
      // only its own original fields, so engineeringSummary's own schema
      // (additionalProperties: false) never has to change — review status
      // belongs in the separate strategy_review section (computeStrategyReview()
      // below), not duplicated here.
      const status = createEngineeringWorkManagementService({
        workOrderStore: engineeringWorkOrderStore,
        deliveryReportStore: engineeringDeliveryReportStore,
      }).getStatus();
      return {
        current_milestone: status.current_milestone,
        last_completed_milestone: status.last_completed_milestone,
        outstanding_work_orders: status.outstanding_work_orders,
        awaiting_review: status.awaiting_review,
        repository_status: status.repository_status,
        latest_delivery_report: status.latest_delivery_report,
      };
    } catch {
      return {
        current_milestone: null,
        last_completed_milestone: null,
        outstanding_work_orders: 0,
        awaiting_review: 0,
        repository_status: null,
        latest_delivery_report: null,
      };
    }
  }

  // DC-003-I029.1 — read-only, additive, standalone (not paired with
  // anything). Delegates counting to getQueue() from
  // bridge-transport-service.mjs — one source of truth, not a second
  // implementation. `last_transport` is re-fetched as a FULL record (the
  // store's own list() only returns summaries) to match every other
  // "embed the full latest record" precedent in this schema
  // (social_performance, engineering.latest_delivery_report). Degrades to
  // an honest zeroed/unhealthy summary on a store read failure, mirroring
  // computeEngineering()'s own discipline.
  function computeBridge() {
    if (!bridgeTransportStore) return null;
    try {
      const queue = getBridgeQueue({ transportStore: bridgeTransportStore });
      const lastTransport = queue.last_transport ? bridgeTransportStore.get(queue.last_transport.transport_record_id) : null;
      return {
        pending_exports: queue.pending_exports,
        pending_imports: queue.pending_imports,
        history_count: queue.history_count,
        last_transport: lastTransport,
        healthy: true,
      };
    } catch {
      return { pending_exports: 0, pending_imports: 0, history_count: 0, last_transport: null, healthy: false };
    }
  }

  // DC-003-I029.2 — read-only, additive. `deliveryOfficeLockDir` is not
  // paired with the Engineering stores the way engineeringDeliveryReportStore
  // is paired with engineeringWorkOrderStore — it is its own independent
  // optional signal (mirrors exportsRootDir's own "checked, not zero"
  // discipline): when omitted, lock_status.checked is honestly false
  // rather than 0 active locks being reported as fact.
  function computeLockStatus() {
    if (!deliveryOfficeLockDir) return { checked: false, activeLocks: 0, staleLocks: 0, runningWorkOrder: null };
    try {
      const locks = createDeliveryExecutionLock({ lockDir: deliveryOfficeLockDir }).list();
      const active = locks.filter((l) => !l.stale);
      const stale = locks.filter((l) => l.stale);
      return { checked: true, activeLocks: active.length, staleLocks: stale.length, runningWorkOrder: active.length > 0 ? active[0].workOrderId : null };
    } catch {
      return { checked: false, activeLocks: 0, staleLocks: 0, runningWorkOrder: null };
    }
  }

  // DC-003-I029.2 — read-only, additive, paired with the SAME Engineering
  // store pair engineeringSummary already requires (null when that pair
  // was never supplied — no separate opt-in). No Claude Code invocation
  // of any kind — runner_availability is a structural env-presence signal
  // only, exactly mirroring checkAnthropicHealth()'s own "read config,
  // never a live call" discipline above.
  function computeDeliveryOffice() {
    if (!engineeringWorkOrderStore || !engineeringDeliveryReportStore) return null;
    try {
      const workOrders = createEngineeringWorkManagementService({
        workOrderStore: engineeringWorkOrderStore,
        deliveryReportStore: engineeringDeliveryReportStore,
      }).listWorkOrders();
      const queuedWorkOrders = workOrders.filter((w) => w.derived_state === "Ready").length;
      const awaitingReview = workOrders.filter((w) => w.derived_state === "Awaiting Review").length;

      const deliveryReportSummaries = engineeringDeliveryReportStore.list();
      const failedExecutions = deliveryReportSummaries.filter((r) => r.status === "failed").length;
      const latestReportSummary = deliveryReportSummaries.length > 0 ? deliveryReportSummaries[deliveryReportSummaries.length - 1] : null;
      const lastDeliveryReport = latestReportSummary ? engineeringDeliveryReportStore.get(latestReportSummary.delivery_report_id) : null;

      const lockStatus = computeLockStatus();
      const runnerConfig = loadDeliveryOfficeRunnerConfig(env);

      return {
        queued_work_orders: queuedWorkOrders,
        running_work_order: lockStatus.runningWorkOrder,
        last_delivery_report: lastDeliveryReport,
        awaiting_review: awaitingReview,
        failed_executions: failedExecutions,
        lock_status: { checked: lockStatus.checked, active_locks: lockStatus.activeLocks, stale_locks: lockStatus.staleLocks },
        runner_availability: { configured: runnerConfig.configured, mechanism: `${runnerConfig.command} (${runnerConfig.source})` },
      };
    } catch {
      return {
        queued_work_orders: 0,
        running_work_order: null,
        last_delivery_report: null,
        awaiting_review: 0,
        failed_executions: 0,
        lock_status: { checked: false, active_locks: 0, stale_locks: 0 },
        runner_availability: { configured: false, mechanism: "unknown" },
      };
    }
  }

  // DC-003-I029.3 — read-only, additive, standalone. Decision counts come
  // straight from strategyReviewStore.list() (already includes every
  // review's own decision on its summary); reviews_awaiting_execution is
  // only computed when the Engineering pair is ALSO supplied (delegates
  // to Engineering Work Management's own "Awaiting Review" derived-state
  // count — one source of truth, not a second implementation). No OpenAI
  // invocation of any kind — reviewer_availability is a structural
  // env-presence signal only, mirroring computeDeliveryOffice()'s own
  // runner_availability discipline.
  function computeReviewLockStatus() {
    if (!strategyReviewLockDir) return { checked: false, locked: null };
    try {
      const locks = createStrategyReviewLock({ lockDir: strategyReviewLockDir }).list();
      const active = locks.find((l) => !l.stale);
      return { checked: true, locked: active ? active.deliveryReportId : null };
    } catch {
      return { checked: false, locked: null };
    }
  }

  function computeStrategyReview() {
    if (!strategyReviewStore) return null;
    try {
      const summaries = strategyReviewStore.list();
      const approvedDeliveries = summaries.filter((r) => r.decision === "approved").length;
      const correctionsRequired = summaries.filter((r) => r.decision === "correction_required").length;
      const ceoDecisionsRequired = summaries.filter((r) => r.decision === "ceo_decision_required").length;
      const rejectedDeliveries = summaries.filter((r) => r.decision === "rejected").length;
      const latestReview = summaries.length > 0 ? strategyReviewStore.get(summaries[summaries.length - 1].strategy_review_id) : null;

      let reviewsAwaitingExecution = null;
      if (engineeringWorkOrderStore && engineeringDeliveryReportStore) {
        try {
          const workOrders = createEngineeringWorkManagementService({
            workOrderStore: engineeringWorkOrderStore,
            deliveryReportStore: engineeringDeliveryReportStore,
            strategyReviewStore,
          }).listWorkOrders();
          reviewsAwaitingExecution = workOrders.filter((w) => w.derived_state === "Awaiting Review").length;
        } catch {
          reviewsAwaitingExecution = null;
        }
      }

      const lockStatus = computeReviewLockStatus();
      const openAiAuth = describeOpenAiAuthenticationAvailability(env);

      return {
        reviews_awaiting_execution: reviewsAwaitingExecution,
        review_currently_locked: lockStatus.checked ? lockStatus.locked : null,
        latest_review: latestReview,
        approved_deliveries: approvedDeliveries,
        corrections_required: correctionsRequired,
        ceo_decisions_required: ceoDecisionsRequired,
        rejected_deliveries: rejectedDeliveries,
        reviewer_availability: { configured: openAiAuth.available, mechanism: openAiAuth.mechanism },
      };
    } catch {
      return {
        reviews_awaiting_execution: null,
        review_currently_locked: null,
        latest_review: null,
        approved_deliveries: 0,
        corrections_required: 0,
        ceo_decisions_required: 0,
        rejected_deliveries: 0,
        reviewer_availability: { configured: false, mechanism: "OPENAI_API_KEY" },
      };
    }
  }

  // DC-003-I030 — read-only, additive, standalone (not paired with
  // anything above). A LEAN summary only — count, breakdowns by
  // source_type/approval_state, and the latest record's own small fields
  // (id/title/word_count/created_at) — deliberately never the latest
  // record's full_article_text, unlike engineeringSummary's full
  // latest_delivery_report embed, since an article body is unbounded in
  // size and a Delivery Report is not. See README "Control Centre" for
  // the full investigation finding behind this choice.
  function computeContentIngestion() {
    if (!ingestedContentStore) return null;
    try {
      const summaries = ingestedContentStore.list();
      const bySourceType = {};
      const byApprovalState = {};
      for (const summary of summaries) {
        bySourceType[summary.source_type] = (bySourceType[summary.source_type] ?? 0) + 1;
        byApprovalState[summary.approval_state] = (byApprovalState[summary.approval_state] ?? 0) + 1;
      }
      const latest = summaries.length > 0 ? summaries[summaries.length - 1] : null;

      return {
        total_ingested: summaries.length,
        by_source_type: bySourceType,
        by_approval_state: byApprovalState,
        latest_ingestion:
          latest === null
            ? null
            : {
                ingested_content_id: latest.ingested_content_id,
                source_type: latest.source_type,
                title: latest.title,
                approval_state: latest.approval_state,
                word_count: latest.word_count,
                created_at: latest.created_at,
              },
      };
    } catch {
      return { total_ingested: 0, by_source_type: {}, by_approval_state: {}, latest_ingestion: null };
    }
  }

  // DC-003-I031 — read-only, additive, standalone. Mirrors
  // computeContentIngestion()'s own lean-summary precedent exactly:
  // count, and the latest record's own small fields
  // (id/ingested_content_id/primary_headline/status/generated_at) —
  // never the full editorial fields (executive_summary, key_insights,
  // etc.), consistent with never embedding unbounded/verbose content in
  // this read model.
  function computeEditorialPackage() {
    if (!editorialPackageStore) return null;
    try {
      const summaries = editorialPackageStore.list();
      const latest = summaries.length > 0 ? summaries[summaries.length - 1] : null;

      return {
        total_editorial_packages: summaries.length,
        latest_package:
          latest === null
            ? null
            : {
                editorial_package_id: latest.editorial_package_id,
                ingested_content_id: latest.ingested_content_id,
                primary_headline: latest.primary_headline,
                status: latest.status,
                generated_at: latest.generated_at,
              },
        latest_status: latest === null ? null : latest.status,
      };
    } catch {
      return { total_editorial_packages: 0, latest_package: null, latest_status: null };
    }
  }

  /**
   * Assembles the full "overview" read model: system health, dashboard
   * totals, recent jobs, recent activity, engineering status, bridge
   * transport status, Delivery Office status, and Strategy Review status,
   * all from one consistent snapshot of the stores. Never throws for a
   * broken store — a store read failure is folded into that store's own
   * health check instead (see computeHealth()); it only throws
   * ControlCentreAssemblyError if this module's own assembly logic
   * produces something that doesn't match control-centre.schema.json (a
   * bug in this file, not a data problem).
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
      engineering: computeEngineering(),
      bridge: computeBridge(),
      delivery_office: computeDeliveryOffice(),
      strategy_review: computeStrategyReview(),
      content_ingestion: computeContentIngestion(),
      editorial_package: computeEditorialPackage(),
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
        social_performance: computeSocialPerformance(carouselId),
      },
    };

    return validateAndFreeze(detail);
  }

  return { getOverview, getJobDetail };
}

// DC-003 — public entry point for the configuration/validation runtime.
// Later components (topic loading, LLM generation, payload mapping,
// rendering, execution logging) should import from here rather than
// reaching into individual src/ files directly.

export { loadConfig, loadTemplatesConfig, loadConstants, loadVersions } from "./config-loader.mjs";
export { loadSchemaRegistry, SCHEMA_IDS } from "./schema-registry.mjs";
export { createValidator } from "./validator.mjs";
export { runIntegrityChecks } from "./integrity-checks.mjs";
export {
  ConfigFileNotFoundError,
  ConfigParseError,
  UnknownSchemaError,
  ConfigIntegrityError,
} from "./errors.mjs";

// DC-003-I003 — Topic Package Loader
export { loadTopicPackage, prepareTopicPackage } from "./topic-package-loader.mjs";
export { checkTopicPackageReadiness } from "./topic-package-readiness.mjs";
export {
  TopicPackageNotFoundError,
  TopicPackageUnreadableError,
  TopicPackageParseError,
  TopicPackageValidationError,
  TopicPackageReadinessError,
} from "./topic-package-errors.mjs";

// DC-003-I004 — Carousel Content Generator
export { buildCarouselPrompt, PROMPT_VERSION } from "./carousel-prompt-builder.mjs";
export { createMockProvider } from "./carousel-mock-provider.mjs";
export { validateGeneratedCarousel } from "./carousel-content-validator.mjs";
export { checkCarouselContentShape } from "./carousel-content-shape.mjs";
export { SLIDE_ORDER, SLIDE_CONTENT_SPEC } from "./carousel-slide-spec.mjs";
export { withRetry } from "./retry.mjs";
export { generateCarouselFromTopicPackage } from "./carousel-generator.mjs";
export { PromptBuilderError, CarouselGenerationFailedError } from "./carousel-generator-errors.mjs";
export { deepFreezeClone } from "./immutable.mjs";

// DC-003-I005 — Carousel Payload Mapper
export {
  CAROUSEL_PAYLOAD_MAPPING,
  getSlideMapping,
  expandLayerTemplate,
  validateMappingRegistry,
} from "./carousel-payload-mapping.mjs";
export { mapCarouselToTemplatedPayload } from "./carousel-payload-mapper.mjs";
export {
  UnknownTemplateError,
  MissingLayerError,
  DuplicateLayerMappingError,
  UnsupportedContentError,
  TemplatedPayloadValidationError,
} from "./carousel-payload-errors.mjs";

// DC-003-I006 — Templated Renderer
export { renderTemplatedPayload } from "./renderer.mjs";
export { createMockTransport } from "./renderer-transport-mock.mjs";
export { createHttpTransport } from "./renderer-transport-http.mjs";
export { loadRendererConfig, resolveLiveMaxAttempts, DEFAULT_LIVE_MAX_ATTEMPTS } from "./renderer-config.mjs";
export { validateTransportResponse } from "./renderer-response-validator.mjs";
export { createRenderResult, RENDER_STATUSES } from "./render-result.mjs";
export {
  RendererError,
  AuthenticationError,
  TransportError,
  TimeoutError,
  ValidationError,
  RenderRejected,
  RetryLimitExceeded,
} from "./renderer-errors.mjs";

// DC-003-I007 — Finished Carousel Builder
export { createExecutionMetadata, generateExecutionId } from "./execution-metadata.mjs";
export { createFinishedCarousel } from "./finished-carousel-builder.mjs";
export { FinishedCarouselCompositionError, FinishedCarouselValidationError } from "./finished-carousel-errors.mjs";

// DC-003-I008 — Execution Ledger (operational layer)
export { createExecutionRecord, generateRecordId } from "./execution-record.mjs";
export { assertValidLedgerStore } from "./execution-ledger-store.mjs";
export { createJsonlLedgerStore } from "./jsonl-ledger-store.mjs";
export { createExecutionLedger } from "./execution-ledger.mjs";
export {
  ExecutionRecordValidationError,
  DuplicateSequenceError,
  InvalidLedgerStoreError,
  MalformedLedgerLineError,
  ExecutionNotFoundError,
  LedgerFileExistsError,
} from "./execution-ledger-errors.mjs";

// DC-003-I009 — Pipeline Orchestrator
export { createPipelineContext, withContext } from "./pipeline-context.mjs";
export {
  LoadTopicStage,
  GenerateCarouselStage,
  MapPayloadStage,
  RenderStage,
  BuildFinishedCarouselStage,
} from "./pipeline-stages.mjs";
export { DEFAULT_PIPELINE } from "./pipeline-definition.mjs";
export { createPipelineOrchestrator } from "./pipeline-orchestrator.mjs";
export { PipelineConfigurationError, toSafeStageError } from "./pipeline-errors.mjs";

// DC-003-I010 — External Invocation Adapter
export { prepareInvocationRequest } from "./invocation-request.mjs";
export { normalizeInvocationRequest } from "./invocation-normalizer.mjs";
export { createInvocationResponse } from "./invocation-response.mjs";
export { createExternalInvocationAdapter } from "./invocation-adapter.mjs";
export {
  InvocationRequestValidationError,
  InvocationResponseValidationError,
  toSafeInvocationError,
} from "./invocation-errors.mjs";

// DC-003-I011 — n8n Adapter
export { mapWorkflowInputToInvocationRequest } from "./n8n-workflow-mapper.mjs";
export { mapInvocationResponseToN8nOutput } from "./n8n-response-mapper.mjs";
export { createN8nAdapter } from "./n8n-adapter.mjs";

// DC-003-I012 — Production Workflow
export { createProductionWorkflow, persistWorkflowOutput } from "./production-workflow.mjs";

// DC-003-I014 — Carousel Approval Workflow
export { approveCarousel, rejectCarousel, publishCarousel } from "./carousel-approval.mjs";
export { InvalidApprovalTransitionError, CarouselApprovalValidationError } from "./carousel-approval-errors.mjs";

// DC-003-I015 — Finished Carousel Store
export { assertValidCarouselStoreAdapter } from "./finished-carousel-store-adapter.mjs";
export { createLocalJsonCarouselStoreAdapter } from "./local-json-carousel-store-adapter.mjs";
export { createFinishedCarouselStore } from "./finished-carousel-store.mjs";
export {
  InvalidCarouselStoreAdapterError,
  InvalidFinishedCarouselError,
  InvalidCarouselIdentifierError,
  CarouselAlreadyExistsError,
  CarouselNotFoundError,
  CarouselIdentifierMismatchError,
  CorruptedCarouselError,
  CarouselPersistenceError,
} from "./finished-carousel-store-errors.mjs";

// DC-003-I016 — Content Request Command
export { createContentRequest } from "./content-request.mjs";
export { parseContentRequestCommand } from "./content-request-parser.mjs";
export { mapContentRequestToProductionWorkflowInput } from "./content-request-workflow-mapper.mjs";
export { executeContentRequest } from "./content-request-service.mjs";
export {
  AmbiguousContentRequestError,
  UnsupportedDesignCountError,
  ContentRequestValidationError,
  UnknownSourceReferenceError,
  SourceResolutionError,
  ContentRequestProductionFailedError,
  ContentRequestPersistenceFailedError,
  DuplicateStoredCarouselError,
} from "./content-request-errors.mjs";

// DC-003-I018 — Content Asset Repository (replaces I016's original
// fixture-directory resolver; see content-request-service.mjs)
export { createContentAssetRepository } from "./content-asset-repository.mjs";
export { resolveContentAsset } from "./content-asset-resolver.mjs";
export {
  UnknownContentAssetError,
  DuplicateContentAssetIdError,
  ContentAssetSchemaError,
  ContentAssetReadFailureError,
  InvalidContentAssetError,
} from "./content-asset-errors.mjs";

// DC-003-I019 — Real LLM Provider Integration (Anthropic), behind the
// existing provider abstraction — the mock provider remains the default
// everywhere unless a caller explicitly injects this one.
export { createAnthropicProvider } from "./llm-provider-anthropic.mjs";
export { createHttpTransport as createLlmHttpTransport, TOOL_NAME as LLM_TOOL_NAME } from "./llm-transport-http.mjs";
export { createMockLlmTransport } from "./llm-transport-mock.mjs";
export { validateLlmTransportResponse } from "./llm-response-validator.mjs";
export { loadLlmProviderConfig, resolveLiveMaxAttempts as resolveLlmLiveMaxAttempts, DEFAULT_LIVE_MAX_ATTEMPTS as LLM_DEFAULT_LIVE_MAX_ATTEMPTS } from "./llm-provider-config.mjs";
export {
  LlmProviderError,
  LlmConfigurationError,
  LlmAuthenticationError,
  LlmRateLimitError,
  LlmTimeoutError,
  LlmTransportError,
  LlmClientError,
  LlmMalformedResponseError,
  LlmProviderRejectedError,
} from "./llm-provider-errors.mjs";

// DC-003-I019.1 — safe, secret-free diagnostics for a rejected Anthropic
// HTTP response (see LlmClientError.diagnostic above), added after the
// I019 Live Verification Gate's first live attempt failed with an
// undiagnosable HTTP 400. See README "Live Verification Gate incident".
export { buildSafeDiagnostic as buildLlmSafeDiagnostic } from "./llm-error-diagnostics.mjs";

// DC-003-I020 — Production Run Service: the one entry point that can
// compose live Anthropic generation and live Templated rendering into one
// persisted Finished Carousel. See "Live Production Run (DC-003-I020)" in
// the README.
export { executeProductionRun } from "./production-run-service.mjs";

// DC-003-I021 — Production Asset Export: converts an approved, completed
// Finished Carousel into a local, publishable asset package (six ordered
// PNGs + metadata.json). Provider-independent adapter interface, mirroring
// the Finished Carousel Store / Renderer / LLM Provider pattern — see
// "Production Asset Export (DC-003-I021)" in the README.
export { assertValidExportAdapter } from "./production-asset-export-adapter.mjs";
export { createLocalProductionAssetExportAdapter, EXPORT_VERSION as PRODUCTION_ASSET_EXPORT_VERSION } from "./local-production-asset-export-adapter.mjs";
export { executeProductionAssetExport } from "./production-asset-export-service.mjs";
export {
  InvalidExportAdapterError,
  InvalidFinishedCarouselForExportError,
  CarouselNotEligibleForExportError,
  InvalidExportDestinationError,
  SlideDownloadError,
  ExportPersistenceError,
} from "./production-asset-export-errors.mjs";

// DC-003-I022 — Production Asset Publisher: publishes an already-completed
// I021 export package to Google Drive. Provider-independent adapter
// interface, mirroring the same pattern as the Finished Carousel Store /
// Renderer / LLM Provider / Production Asset Export — see "Google Drive
// Publisher (DC-003-I022)" in the README. I022 does not generate assets
// and does not modify I021.
export { assertValidPublisherAdapter } from "./production-asset-publisher-adapter.mjs";
export { createGoogleDrivePublisherAdapter } from "./google-drive-publisher-adapter.mjs";
export { createMockPublisherAdapter } from "./production-asset-publisher-mock-adapter.mjs";
export { loadGoogleDrivePublisherConfig, resolveLiveMaxAttempts as resolveGoogleDriveLiveMaxAttempts } from "./google-drive-publisher-config.mjs";
export { executeProductionAssetPublish } from "./production-asset-publisher-service.mjs";
export {
  InvalidPublisherAdapterError,
  InvalidAssetPackageError,
  PublisherConfigurationError,
  PublisherAuthenticationError,
  PublisherTransportError,
  PublisherTimeoutError,
  PublisherClientError,
  PublisherRateLimitError,
  DuplicatePackageError,
  PublisherUploadError,
} from "./production-asset-publisher-errors.mjs";

// DC-003-I023 — Production Metrics & Cost Accounting: observes completed
// Production Run / Export / Publish results and builds one validated,
// immutable Production Metrics Record — request counts, durations,
// output counts, and estimated provider costs. Never a dashboard, never a
// real provider invoice — see "Production Metrics & Cost Accounting
// (DC-003-I023)" in the README.
export { createProductionMetrics } from "./production-metrics.mjs";
export { loadProductionCostConfig } from "./production-cost-config.mjs";
export { calculateAnthropicCost, calculateTemplatedCost, calculateGoogleDriveCost, calculateTotalCost } from "./production-cost-calculator.mjs";
export { collectProductionMetrics } from "./production-metrics-collector.mjs";
export { assertValidMetricsStoreAdapter } from "./production-metrics-store-adapter.mjs";
export { createLocalJsonProductionMetricsStoreAdapter } from "./local-json-production-metrics-store-adapter.mjs";
export { createProductionMetricsStore } from "./production-metrics-store.mjs";
export {
  InvalidProductionMetricsInputError,
  ProductionMetricsValidationError,
  InvalidMetricsStoreAdapterError,
  InvalidMetricsIdentifierError,
  MetricsRecordAlreadyExistsError,
  MetricsRecordNotFoundError,
  CorruptedMetricsRecordError,
  MetricsPersistenceError,
} from "./production-metrics-errors.mjs";

// DC-003-I024 — Production Control Centre: the first operational,
// read-only console over the existing pipeline — system health, dashboard
// totals, recent jobs, recent activity, and per-carousel job detail,
// assembled entirely from the Finished Carousel Store (I015), the
// Production Metrics Store (I023), and (optionally) the Production Asset
// Export (I021) directory convention. Never owns, mutates, or persists
// anything; no network calls. See "Production Control Centre
// (DC-003-I024)" in the README.
export { createControlCentreService } from "./control-centre-service.mjs";
export { InvalidControlCentreDependenciesError, ControlCentreAssemblyError } from "./control-centre-errors.mjs";

// DC-003-I025 — Publisher Result Store: the authoritative local record of
// every successful publish. Closes the DC-003-I024 gap where a completed
// Google Drive upload left no repository evidence — I022's publisher
// service now persists one Publisher Result after every successful
// upload (upload behaviour itself unchanged), and the Control Centre
// reports "published" from this store instead of the disconnected
// approval-lifecycle field. Provider-neutral: Google Drive is only the
// first implementation. See "Publisher Result Store (DC-003-I025)" in the
// README.
export { createPublisherResult } from "./publisher-result.mjs";
export { assertValidPublisherResultStoreAdapter } from "./publisher-result-store-adapter.mjs";
export { createLocalJsonPublisherResultStoreAdapter } from "./local-json-publisher-result-store-adapter.mjs";
export { createPublisherResultStore } from "./publisher-result-store.mjs";
export {
  InvalidPublisherResultInputError,
  PublisherResultValidationError,
  InvalidPublisherResultStoreAdapterError,
  InvalidPublisherResultIdentifierError,
  PublisherResultAlreadyExistsError,
  PublisherResultNotFoundError,
  CorruptedPublisherResultError,
  PublisherResultPersistenceError,
} from "./publisher-result-errors.mjs";

// DC-003-I026 — Windows Production Asset Export: a second, human-facing
// delivery copy of an already-completed I021 archive package, into a
// configurable Windows-visible folder bind-mounted into the container.
// The Docker archive remains the sole system of record; this is a plain,
// verified filesystem copy — never a second Templated CDN download, and
// I021 itself is completely unmodified. See "Windows Production Asset
// Export (DC-003-I026)" in the README.
export { loadWindowsProductionExportConfig } from "./windows-production-export-config.mjs";
export { executeWindowsProductionExport } from "./windows-production-export-service.mjs";
export {
  WindowsDeliveryConflictError,
  WindowsDeliveryPartialPackageError,
  WindowsDeliveryPersistenceError,
  WindowsDeliveryVerificationError,
} from "./windows-production-export-errors.mjs";

// DC-003-I027 — Social Publisher: executes an approved Social Publishing
// Manifest, publishing an approved carousel to Instagram (carousel post)
// and/or LinkedIn (multi-image post). Never generates, rewrites, or
// approves copy — it receives already-approved instructions and executes
// them exactly. Reuses the Finished Carousel Store (I015), the Carousel
// Approval workflow (I014, unchanged), and the Publisher Result Store
// (I025, unchanged) — no second publication store. See "Social Publisher
// (DC-003-I027)" in the README.
export { createSocialPublishingManifest } from "./social-publishing-manifest.mjs";
export {
  InvalidSocialPublishingManifestInputError,
  SocialPublishingManifestValidationError,
} from "./social-publishing-manifest-errors.mjs";
export { assertValidSocialPublisherAdapter } from "./social-publisher-adapter.mjs";
export { executeSocialPublish } from "./social-publisher-service.mjs";
export {
  InvalidSocialPublisherAdapterError,
  InvalidSocialPublishingManifestForPublishError,
  CarouselNotEligibleForSocialPublishError,
  SocialManifestIdentityMismatchError,
  InvalidAssetPackageForSocialPublishError,
  DuplicateSocialPublicationError,
  SocialPlatformPublishError,
} from "./social-publisher-service-errors.mjs";

// DC-003-I027 — Instagram Carousel Publisher
export { createInstagramCarouselPublisherAdapter } from "./instagram-carousel-publisher-adapter.mjs";
export { createMockInstagramPublisherAdapter } from "./instagram-mock-publisher-adapter.mjs";
export {
  loadInstagramPublisherConfig,
  resolveLiveMaxAttempts as resolveInstagramLiveMaxAttempts,
  DEFAULT_LIVE_MAX_ATTEMPTS as INSTAGRAM_DEFAULT_LIVE_MAX_ATTEMPTS,
} from "./instagram-publisher-config.mjs";
export {
  InstagramConfigurationError,
  InstagramAuthenticationError,
  InstagramTransportError,
  InstagramTimeoutError,
  InstagramClientError,
  InstagramRateLimitError,
  InstagramContainerError,
  InstagramPublishError,
} from "./instagram-publisher-errors.mjs";

// DC-003-I027 — LinkedIn Multi-Image Publisher
export { createLinkedInMultiImagePublisherAdapter } from "./linkedin-multi-image-publisher-adapter.mjs";
export { createMockLinkedInPublisherAdapter } from "./linkedin-mock-publisher-adapter.mjs";
export {
  loadLinkedInPublisherConfig,
  classifyAuthorUrn,
  resolveLiveMaxAttempts as resolveLinkedInLiveMaxAttempts,
  DEFAULT_LIVE_MAX_ATTEMPTS as LINKEDIN_DEFAULT_LIVE_MAX_ATTEMPTS,
} from "./linkedin-publisher-config.mjs";
export {
  LinkedInConfigurationError,
  LinkedInAuthenticationError,
  LinkedInTransportError,
  LinkedInTimeoutError,
  LinkedInClientError,
  LinkedInRateLimitError,
  LinkedInImageUploadError,
  LinkedInPostCreationError,
} from "./linkedin-publisher-errors.mjs";

// DC-003-I028 — Social Analytics: turns a Publisher Result (I025/I027)
// into an immutable, time-series Social Analytics Snapshot recording what
// happened after publication. Never publishes/edits/deletes/promotes a
// post — observes only. See "Social Analytics (DC-003-I028)" in the
// README.
export { createSocialAnalyticsSnapshot } from "./social-analytics-snapshot.mjs";
export { assertValidSocialAnalyticsStoreAdapter } from "./social-analytics-store-adapter.mjs";
export { createLocalJsonSocialAnalyticsStoreAdapter } from "./local-json-social-analytics-store-adapter.mjs";
export { createSocialAnalyticsStore } from "./social-analytics-store.mjs";
export {
  InvalidSocialAnalyticsSnapshotInputError,
  SocialAnalyticsSnapshotValidationError,
  InvalidSocialAnalyticsStoreAdapterError,
  InvalidSocialAnalyticsSnapshotIdentifierError,
  SocialAnalyticsSnapshotAlreadyExistsError,
  SocialAnalyticsSnapshotNotFoundError,
  CorruptedSocialAnalyticsSnapshotError,
  SocialAnalyticsPersistenceError,
  InvalidSocialAnalyticsAdapterError,
} from "./social-analytics-errors.mjs";
export { assertValidSocialAnalyticsAdapter } from "./social-analytics-adapter.mjs";
export { collectSocialAnalytics } from "./social-analytics-service.mjs";
export {
  UnsupportedAnalyticsProviderError,
  MissingProviderPostReferenceError,
  IneligiblePublisherResultForAnalyticsError,
  SocialAnalyticsCollectionFailedError,
} from "./social-analytics-service-errors.mjs";

// DC-003-I028 — Instagram Insights Adapter
export { createInstagramInsightsAdapter } from "./instagram-insights-adapter.mjs";
export { createMockInstagramInsightsAdapter } from "./instagram-mock-insights-adapter.mjs";
export {
  loadInstagramAnalyticsConfig,
  resolveLiveMaxAttempts as resolveInstagramAnalyticsLiveMaxAttempts,
  DEFAULT_LIVE_MAX_ATTEMPTS as INSTAGRAM_ANALYTICS_DEFAULT_LIVE_MAX_ATTEMPTS,
} from "./instagram-analytics-config.mjs";
export {
  InstagramAnalyticsConfigurationError,
  InstagramAnalyticsAuthenticationError,
  InstagramAnalyticsTransportError,
  InstagramAnalyticsTimeoutError,
  InstagramAnalyticsClientError,
  InstagramAnalyticsRateLimitError,
  InstagramInsightsRequestError,
  InstagramInsightsMalformedResponseError,
} from "./instagram-analytics-errors.mjs";

// DC-003-I028 — LinkedIn Post Analytics Adapter
export { createLinkedInPostAnalyticsAdapter } from "./linkedin-post-analytics-adapter.mjs";
export { createMockLinkedInPostAnalyticsAdapter } from "./linkedin-mock-post-analytics-adapter.mjs";
export {
  loadLinkedInAnalyticsConfig,
  resolveLiveMaxAttempts as resolveLinkedInAnalyticsLiveMaxAttempts,
  DEFAULT_LIVE_MAX_ATTEMPTS as LINKEDIN_ANALYTICS_DEFAULT_LIVE_MAX_ATTEMPTS,
} from "./linkedin-analytics-config.mjs";
export {
  LinkedInAnalyticsConfigurationError,
  LinkedInMemberAnalyticsNotEnabledError,
  LinkedInAnalyticsAuthenticationError,
  LinkedInAnalyticsTransportError,
  LinkedInAnalyticsTimeoutError,
  LinkedInAnalyticsClientError,
  LinkedInAnalyticsRateLimitError,
  LinkedInAnalyticsRequestError,
  LinkedInAnalyticsMalformedResponseError,
} from "./linkedin-analytics-errors.mjs";

// DC-003-I029 — Engineering Work Management: structured Strategy Office
// <-> Delivery Office engineering objects (Work Order, Delivery Report),
// replacing informal markdown briefs/delivery summaries. No networking,
// no Claude/ChatGPT/MCP/n8n integration — defines the engineering
// language a future Bridge Layer will exchange. See "Engineering Work
// Management (DC-003-I029)" in the README.
export { createEngineeringWorkOrder } from "./engineering-work-order.mjs";
export { assertValidEngineeringWorkOrderStoreAdapter } from "./engineering-work-order-store-adapter.mjs";
export { createLocalJsonEngineeringWorkOrderStoreAdapter } from "./local-json-engineering-work-order-store-adapter.mjs";
export { createEngineeringWorkOrderStore } from "./engineering-work-order-store.mjs";
export {
  InvalidEngineeringWorkOrderInputError,
  EngineeringWorkOrderValidationError,
  InvalidEngineeringWorkOrderStoreAdapterError,
  InvalidEngineeringWorkOrderIdentifierError,
  EngineeringWorkOrderAlreadyExistsError,
  EngineeringWorkOrderNotFoundError,
  CorruptedEngineeringWorkOrderError,
  EngineeringWorkOrderPersistenceError,
} from "./engineering-work-order-errors.mjs";

export { createEngineeringDeliveryReport } from "./engineering-delivery-report.mjs";
export { assertValidEngineeringDeliveryReportStoreAdapter } from "./engineering-delivery-report-store-adapter.mjs";
export { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "./local-json-engineering-delivery-report-store-adapter.mjs";
export { createEngineeringDeliveryReportStore } from "./engineering-delivery-report-store.mjs";
export {
  InvalidEngineeringDeliveryReportInputError,
  EngineeringDeliveryReportValidationError,
  InvalidEngineeringDeliveryReportStoreAdapterError,
  InvalidEngineeringDeliveryReportIdentifierError,
  EngineeringDeliveryReportAlreadyExistsError,
  EngineeringDeliveryReportNotFoundError,
  CorruptedEngineeringDeliveryReportError,
  EngineeringDeliveryReportPersistenceError,
} from "./engineering-delivery-report-errors.mjs";

export { createEngineeringWorkManagementService } from "./engineering-work-management-service.mjs";
export { InvalidEngineeringWorkManagementDependenciesError } from "./engineering-work-management-errors.mjs";

// DC-003-I029.1 — Bridge Transport: moves Engineering Work Orders out and
// Engineering Delivery Reports in. Transport only — no approvals, no
// engineering decisions, no prompt generation, no networking. Mock-only;
// the clean extension point for a future real transport provider. See
// "Bridge Transport (DC-003-I029.1)" in the README.
export { createBridgeTransportRecord } from "./bridge-transport-record.mjs";
export { assertValidBridgeTransportStoreAdapter } from "./bridge-transport-store-adapter.mjs";
export { createLocalJsonBridgeTransportStoreAdapter } from "./local-json-bridge-transport-store-adapter.mjs";
export { createBridgeTransportStore } from "./bridge-transport-store.mjs";
export { createMockBridgeTransportAdapter } from "./bridge-transport-mock-adapter.mjs";
export { exportWorkOrder, importDeliveryReport, getQueue, getHistory } from "./bridge-transport-service.mjs";
export {
  InvalidBridgeTransportRecordInputError,
  BridgeTransportRecordValidationError,
  InvalidBridgeTransportStoreAdapterError,
  InvalidBridgeTransportRecordIdentifierError,
  BridgeTransportRecordAlreadyExistsError,
  BridgeTransportRecordNotFoundError,
  CorruptedBridgeTransportRecordError,
  BridgeTransportPersistenceError,
  BridgeTransportSendError,
  BridgeTransportCorruptionError,
  DuplicateBridgeTransportError,
  InvalidBridgeTransportDependenciesError,
} from "./bridge-transport-errors.mjs";

// DC-003-I029.2 — Automated Delivery Office: the first real Bridge
// Transport provider. Executes one approved Engineering Work Order
// through a Delivery Office Runner Adapter (mock by default; a real
// Claude Code CLI subprocess adapter only when explicitly constructed and
// gated behind `--live-runner`), collects independent git evidence, and
// records one Engineering Delivery Report through I029.1's own Bridge
// Transport Service, unmodified. Never approves its own work — Strategy
// Office review remains entirely manual. See "Automated Delivery Office
// (DC-003-I029.2)" in the README.
export { readGitState, readUpstreamCommit, computeChangedFiles, defaultRunGit } from "./repository-git-evidence.mjs";
export { createExecutionPolicy, resolveEffectivePolicy } from "./execution-policy.mjs";
export { createDeliveryExecutionLock } from "./delivery-execution-lock.mjs";
export { assertValidDeliveryOfficeRunnerAdapter, assertValidRunnerResult, RUNNER_RESULT_STATUSES } from "./delivery-office-runner-adapter.mjs";
export { createMockDeliveryOfficeRunnerAdapter } from "./delivery-office-mock-runner-adapter.mjs";
export {
  createClaudeCodeDeliveryRunnerAdapter,
  buildDeliveryInstruction,
  buildClaudeArgs,
  parseClaudeSelfReport,
  CLAUDE_SELF_REPORT_JSON_SCHEMA,
} from "./claude-code-delivery-runner-adapter.mjs";
export { loadDeliveryOfficeRunnerConfig, describeAuthenticationAvailability } from "./delivery-office-runner-config.mjs";
export { createAutomatedDeliveryOfficeService } from "./automated-delivery-office-service.mjs";
export {
  InvalidExecutionLockIdentifierError,
  ExecutionLockAlreadyHeldError,
  ExecutionLockNotHeldError,
  ExecutionLockOwnershipError,
  ExecutionLockPersistenceError,
  InvalidDeliveryOfficeRunnerAdapterError,
  InvalidExecutionPolicyError,
  WorkOrderNotEligibleError,
  DuplicateDeliveryError,
  RunnerExecutionFailedError,
  MalformedRunnerResultError,
  InvalidAutomatedDeliveryOfficeDependenciesError,
} from "./delivery-office-errors.mjs";

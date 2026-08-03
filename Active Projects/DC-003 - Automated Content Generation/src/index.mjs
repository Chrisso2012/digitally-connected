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
  LlmMalformedResponseError,
  LlmProviderRejectedError,
} from "./llm-provider-errors.mjs";

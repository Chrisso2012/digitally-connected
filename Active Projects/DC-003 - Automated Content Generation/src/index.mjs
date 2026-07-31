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
export { loadRendererConfig } from "./renderer-config.mjs";
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

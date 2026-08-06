// DC-003-I030 — shared error taxonomy for every Content Source Adapter
// (mock or live, present or future — google-docs-source-adapter.mjs today,
// a future markdown/git/wordpress/notion adapter later). Mirrors
// llm-provider-errors.mjs's own category split (authentication / not-found
// / rate-limit / transport / configuration), generalised beyond one
// provider — content-ingestion-service.mjs and every CLI catch clause
// depend only on THESE names, never on an adapter-specific error type, so
// a future adapter needs no changes anywhere outside its own file.

export class ContentSourceConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContentSourceConfigurationError";
  }
}

export class InvalidContentSourceAdapterError extends Error {
  constructor() {
    super('A Content Source Adapter must be shaped { name: string, fetch({ sourceReference }): Promise<{ title, body, metadata, sourceIdentifier }> }');
    this.name = "InvalidContentSourceAdapterError";
  }
}

export class MalformedContentSourceResultError extends Error {
  constructor(sourceReference, reason) {
    super(`Content Source Adapter returned a malformed result for "${sourceReference}" — ${reason}`);
    this.name = "MalformedContentSourceResultError";
    this.sourceReference = sourceReference;
  }
}

export class ContentSourceNotFoundError extends Error {
  constructor(sourceReference) {
    super(`Source "${sourceReference}" was not found, or is not accessible to the configured credentials`);
    this.name = "ContentSourceNotFoundError";
    this.sourceReference = sourceReference;
  }
}

export class ContentSourceAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContentSourceAuthenticationError";
  }
}

export class ContentSourceRateLimitError extends Error {
  constructor(message, retryAfterMs = null) {
    super(message);
    this.name = "ContentSourceRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class ContentSourceTransportError extends Error {
  constructor(message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "ContentSourceTransportError";
  }
}

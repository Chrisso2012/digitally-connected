// DC-003-I031 — errors specific to the Editorial Analysis Provider
// contract (editorial-analysis-provider.mjs) and prompt builder
// (editorial-package-prompt-builder.mjs). Transport/provider-call-level
// failures (authentication, rate limit, timeout, malformed transport
// response) reuse DC-003-I019's own llm-provider-errors.mjs classes
// directly, unmodified — those are already provider-agnostic (no
// carousel-specific content anywhere in that file) and apply identically
// here; duplicating them would only add drift risk.

export class InvalidEditorialAnalysisProviderError extends Error {
  constructor() {
    super("An Editorial Analysis Provider must be shaped { name: string, analyzeContent(prompt, context): Promise<string> }");
    this.name = "InvalidEditorialAnalysisProviderError";
  }
}

export class MalformedEditorialAnalysisResultError extends Error {
  constructor(reason) {
    super(`Editorial Analysis Provider returned a malformed result — ${reason}`);
    this.name = "MalformedEditorialAnalysisResultError";
  }
}

export class EditorialPromptBuilderError extends Error {
  constructor(message, missingFields = []) {
    super(message);
    this.name = "EditorialPromptBuilderError";
    this.missingFields = missingFields;
  }
}

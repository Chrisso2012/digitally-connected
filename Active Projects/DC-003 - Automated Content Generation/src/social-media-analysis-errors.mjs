// DC-003-I032 — errors specific to the Social Media Provider contract
// (social-media-provider.mjs) and prompt builder
// (social-media-package-prompt-builder.mjs). Mirrors
// editorial-analysis-errors.mjs's own precedent exactly. Transport/
// provider-call-level failures reuse DC-003-I019's own
// llm-provider-errors.mjs classes directly, unmodified — see this
// milestone's README "AI Processing" for why.

export class InvalidSocialMediaProviderError extends Error {
  constructor() {
    super("A Social Media Provider must be shaped { name: string, generateSocialMedia(prompt, context): Promise<string> }");
    this.name = "InvalidSocialMediaProviderError";
  }
}

export class MalformedSocialMediaResultError extends Error {
  // DC-003-I032.3 — `field` (optional, null for a whole-result shape
  // failure like "result is not an object") names exactly which field
  // assertValidSocialMediaResult() rejected, a dot/bracket path
  // (e.g. "carousel", "carousel.slides[2].statistic"), structured rather
  // than left to string-parsing this error's own message — lets a caller
  // (social-media-package-generator.mjs) attach safe, field-scoped
  // structural diagnostics without guessing which field actually failed.
  // Mirrors MalformedEditorialAnalysisResultError's own `field` param
  // (editorial-analysis-errors.mjs, DC-003-I031.5) exactly.
  constructor(reason, field = null) {
    super(`Social Media Provider returned a malformed result — ${reason}`);
    this.name = "MalformedSocialMediaResultError";
    this.field = field;
  }
}

export class SocialMediaPromptBuilderError extends Error {
  constructor(message, missingFields = []) {
    super(message);
    this.name = "SocialMediaPromptBuilderError";
    this.missingFields = missingFields;
  }
}

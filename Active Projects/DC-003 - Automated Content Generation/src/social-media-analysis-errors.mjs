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
  constructor(reason) {
    super(`Social Media Provider returned a malformed result — ${reason}`);
    this.name = "MalformedSocialMediaResultError";
  }
}

export class SocialMediaPromptBuilderError extends Error {
  constructor(message, missingFields = []) {
    super(message);
    this.name = "SocialMediaPromptBuilderError";
    this.missingFields = missingFields;
  }
}

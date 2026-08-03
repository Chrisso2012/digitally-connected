// DC-003-I004 — Carousel Content Generator (orchestrator).
//
// The only module that wires the others together:
//
//   Topic Package → Prompt Builder → LLM Provider → Carousel Content
//   Validator → (retry on failure) → immutable Carousel Content Object
//
// Each responsibility stays in its own module (prompt-builder, provider,
// validator, retry) — this file only sequences them. No rendering, no
// Templated API calls, no n8n integration, no filesystem writes.
//
// DC-003-I019 addition: a provider error whose `.retryable` property is
// exactly `false` now propagates immediately, bypassing this function's
// own retry loop, instead of being silently retried up to `maxAttempts`
// times. Before this, EVERY provider exception was caught uniformly and
// retried — harmless for the mock provider (which never throws in
// practice), but a real problem for a real provider: an authentication
// failure or a misconfiguration would have been retried against a live
// endpoint up to 3 times by default, wasting real requests on a failure
// guaranteed to recur identically (exactly the class of mistake the
// DC-003-I006 live-verification incident already taught this codebase to
// avoid). `retryable` is deliberately a generic, provider-agnostic
// property check (`cause?.retryable === false`), not an `instanceof`
// check against any specific provider's error classes — this file stays
// completely unaware of what provider it's talking to, matching this
// module's own "the only module that wires the others together" scope.
// It mirrors the `retryable` field DC-003-I010's InvocationResponse.error
// already established as this codebase's own vocabulary for exactly this
// signal — not a new concept.

import { randomUUID } from "node:crypto";
import { buildCarouselPrompt, PROMPT_VERSION } from "./carousel-prompt-builder.mjs";
import { createMockProvider } from "./carousel-mock-provider.mjs";
import { validateGeneratedCarousel } from "./carousel-content-validator.mjs";
import { createValidator } from "./validator.mjs";
import { withRetry } from "./retry.mjs";
import { loadVersions } from "./config-loader.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { CarouselGenerationFailedError } from "./carousel-generator-errors.mjs";

function generateCarouselContentId() {
  return "cc_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Generates a Carousel Content Object from an already-loaded, already-ready
 * Topic Package (i.e. the output of loadTopicPackage()/prepareTopicPackage()
 * from I003 — this function does not re-run schema or readiness checks on
 * the Topic Package itself).
 *
 * options.provider — an object with { name, generateCarousel(prompt, context) }.
 *   Defaults to the mock provider. Swapping providers requires no change
 *   here or to any caller — see README "Provider abstraction".
 * options.maxAttempts — retry ceiling, default 3.
 * options.validator — inject a pre-built validator (from createValidator())
 *   instead of constructing a new one.
 * options.schemaVersion — override the carousel_content schema version read
 *   from config/versions.json (used by tests).
 * options.rootDir — passed through when reading config/versions.json.
 * options.now — override the clock (used by tests); defaults to
 *   () => new Date().toISOString().
 * options.carouselContentId — override the generated ID (used by tests).
 *
 * Throws PromptBuilderError immediately if the Topic Package has no usable
 * content to prompt from (retrying would never help). Propagates a
 * provider error immediately (bypassing retry) if it carries
 * `retryable: false` — see this module's header comment. Throws
 * CarouselGenerationFailedError if every retry attempt fails validation
 * (or exhausts on retryable provider errors).
 */
export async function generateCarouselFromTopicPackage(topicPackage, options = {}) {
  const provider = options.provider ?? createMockProvider();
  const maxAttempts = options.maxAttempts ?? 3;
  const validator = options.validator ?? createValidator(options);
  const now = options.now ?? (() => new Date().toISOString());
  const schemaVersion =
    options.schemaVersion ?? loadVersions(options).schema_versions?.carousel_content;
  const carouselContentId = options.carouselContentId ?? generateCarouselContentId();

  // Built once, outside the retry loop: if the Topic Package itself has no
  // usable content, retrying with the same input would never help.
  const prompt = buildCarouselPrompt(topicPackage);

  const outcome = await withRetry(
    async () => {
      let raw;
      try {
        raw = await provider.generateCarousel(prompt, { topicPackage });
      } catch (cause) {
        if (cause?.retryable === false) {
          throw cause; // non-retryable — propagate immediately, see header comment
        }
        return { ok: false, stage: "provider", message: `Provider "${provider.name}" threw: ${cause.message}`, details: [] };
      }

      const metadata = {
        carousel_content_id: carouselContentId,
        topic_id: topicPackage.topic_id,
        generated_at: now(),
        llm_model: provider.name,
        prompt_version: PROMPT_VERSION,
        schema_version: schemaVersion,
      };

      return validateGeneratedCarousel(raw, metadata, { validator });
    },
    { maxAttempts }
  );

  if (!outcome.ok) {
    throw new CarouselGenerationFailedError(outcome.attempts, maxAttempts);
  }

  return deepFreezeClone(outcome.result.carouselContent);
}
